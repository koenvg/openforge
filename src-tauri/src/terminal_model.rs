#[path = "terminal_model/shadow.rs"]
mod shadow;

#[cfg(test)]
pub(crate) use shadow::SHADOW_BUFFERED_BYTES_CAPACITY;
pub(crate) use shadow::{ShadowMode, ShadowTerminalFeeder, ShadowTerminalSession};

use libghostty_vt::{
    fmt::{Format, Formatter, FormatterOptions},
    snapshot::Decoder,
    terminal::{
        ConformanceLevel, DeviceAttributeFeature, DeviceAttributes, DeviceType,
        PrimaryDeviceAttributes, SecondaryDeviceAttributes, TertiaryDeviceAttributes,
    },
    Terminal,
};
use std::{cell::RefCell, collections::VecDeque, rc::Rc};

const DEFAULT_SCROLLBACK_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_CONTINUATION_BYTES: usize = 65 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalModelOptions {
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) max_scrollback_bytes: usize,
    pub(crate) max_continuation_bytes: usize,
}

impl TerminalModelOptions {
    pub(crate) fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            max_scrollback_bytes: DEFAULT_SCROLLBACK_BYTES,
            max_continuation_bytes: DEFAULT_CONTINUATION_BYTES,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum TerminalModelError {
    #[error("ghostty terminal model error: {0}")]
    Ghostty(#[from] libghostty_vt::Error),
    #[error("ghostty produced an empty canonical snapshot")]
    EmptySnapshot,
}

pub(crate) trait TerminalModel {
    fn feed(&mut self, bytes: &[u8]) -> Result<(), TerminalModelError>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), TerminalModelError>;
    fn encode_snapshot(&self) -> Result<Vec<u8>, TerminalModelError>;
    fn format_portable_vt(&self) -> Result<Vec<u8>, TerminalModelError>;
    fn take_protocol_replies(&mut self) -> Vec<Vec<u8>>;
}

type ProtocolReplies = Rc<RefCell<VecDeque<Vec<u8>>>>;

pub(crate) struct GhosttyTerminalModel {
    terminal: Terminal<'static, 'static>,
    protocol_replies: ProtocolReplies,
}

impl GhosttyTerminalModel {
    pub(crate) fn new(options: TerminalModelOptions) -> Result<Self, TerminalModelError> {
        let mut terminal = Terminal::new(options.cols, options.rows)?;
        terminal
            .set_scrollback_max_bytes(Some(options.max_scrollback_bytes))?
            .set_continuation_max_bytes(options.max_continuation_bytes)?;
        Self::from_terminal(terminal)
    }

    pub(crate) fn decode_snapshot(snapshot: &[u8]) -> Result<Self, TerminalModelError> {
        let decoder = Decoder::new_buf(snapshot)?;
        let mut terminal = decoder.decode()?;
        terminal.set_continuation_max_bytes(DEFAULT_CONTINUATION_BYTES)?;
        Self::from_terminal(terminal)
    }

    fn from_terminal(mut terminal: Terminal<'static, 'static>) -> Result<Self, TerminalModelError> {
        let protocol_replies = Rc::new(RefCell::new(VecDeque::new()));
        let callback_replies = Rc::clone(&protocol_replies);
        terminal.on_pty_write(move |_terminal, bytes| {
            callback_replies.borrow_mut().push_back(bytes.to_vec());
        })?;
        terminal.on_device_attributes(|_terminal| {
            Some(DeviceAttributes {
                primary: PrimaryDeviceAttributes::new(
                    ConformanceLevel::VT220,
                    &[
                        DeviceAttributeFeature::SELECTIVE_ERASE,
                        DeviceAttributeFeature::ANSI_COLOR,
                    ],
                ),
                secondary: SecondaryDeviceAttributes {
                    device_type: DeviceType::VT220,
                    firmware_version: 1,
                    rom_cartridge: 0,
                },
                tertiary: TertiaryDeviceAttributes::default(),
            })
        })?;
        terminal.on_xtversion(|_terminal| Some("OpenForge shadow terminal"))?;
        Ok(Self {
            terminal,
            protocol_replies,
        })
    }
}

impl TerminalModel for GhosttyTerminalModel {
    fn feed(&mut self, bytes: &[u8]) -> Result<(), TerminalModelError> {
        self.terminal.vt_write(bytes);
        Ok(())
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), TerminalModelError> {
        self.terminal.resize(cols, rows, 0, 0)?;
        Ok(())
    }

    fn encode_snapshot(&self) -> Result<Vec<u8>, TerminalModelError> {
        self.terminal
            .encode_snapshot_alloc(None)?
            .map(|bytes| bytes.as_ref().to_vec())
            .ok_or(TerminalModelError::EmptySnapshot)
    }

    fn format_portable_vt(&self) -> Result<Vec<u8>, TerminalModelError> {
        let options = FormatterOptions::new()
            .with_format(Format::Vt)
            .with_palette(true)
            .with_modes(true)
            .with_scrolling_region(true)
            .with_tabstops(true)
            .with_pwd(true)
            .with_keyboard(true)
            .with_cursor(true)
            .with_style(true)
            .with_hyperlink(true)
            .with_protection(true)
            .with_kitty_keyboard(true)
            .with_charsets(true);
        let mut formatter = Formatter::new(&self.terminal, options)?;
        Ok(formatter.format_alloc(None)?.as_ref().to_vec())
    }

    fn take_protocol_replies(&mut self) -> Vec<Vec<u8>> {
        self.protocol_replies.borrow_mut().drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{GhosttyTerminalModel, TerminalModel, TerminalModelOptions};

    #[test]
    fn snapshot_round_trip_preserves_split_parser_state() {
        let mut model = GhosttyTerminalModel::new(TerminalModelOptions::new(20, 4))
            .expect("terminal model should initialize");
        model
            .feed(b"before\r\n\x1b[31")
            .expect("split escape prefix should feed");

        let snapshot = model
            .encode_snapshot()
            .expect("unfinished parser state should be snapshotable");
        let mut restored =
            GhosttyTerminalModel::decode_snapshot(&snapshot).expect("snapshot should restore");
        restored
            .feed(b"mred\x1b[0m")
            .expect("split escape suffix should feed");

        let portable = restored
            .format_portable_vt()
            .expect("restored model should format as VT");
        assert!(portable
            .windows(b"before".len())
            .any(|part| part == b"before"));
        assert!(portable.windows(b"red".len()).any(|part| part == b"red"));
    }

    #[test]
    fn protocol_replies_are_captured_once() {
        let mut model = GhosttyTerminalModel::new(TerminalModelOptions::new(80, 24))
            .expect("terminal model should initialize");
        model
            .feed(b"\x1b[6n\x1b[c\x1b[>c\x1b[=c\x1b[>q")
            .expect("cursor position query should feed");

        let replies = model.take_protocol_replies();
        assert_eq!(replies.len(), 5);
        assert!(replies[0].starts_with(b"\x1b["));
        assert!(model.take_protocol_replies().is_empty());
    }

    #[test]
    fn compatibility_fixtures_are_independent_of_read_chunking() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../packages/terminal-runtime/fixtures/terminal-model-recordings.v1.json",
        ))
        .expect("recorded Terminal Model fixture corpus should be valid JSON");
        let recordings = corpus["recordings"]
            .as_array()
            .expect("fixture corpus recordings should be an array");

        for recording in recordings {
            let name = recording["id"]
                .as_str()
                .expect("fixture id should be a string");
            let fixture = recording["chunks"]
                .as_array()
                .expect("fixture chunks should be an array")
                .iter()
                .flat_map(|chunk| {
                    chunk
                        .as_str()
                        .expect("fixture chunk should be a string")
                        .as_bytes()
                })
                .copied()
                .collect::<Vec<_>>();
            let mut whole = GhosttyTerminalModel::new(TerminalModelOptions::new(80, 24))
                .expect("whole fixture model should initialize");
            whole.feed(&fixture).expect("whole fixture should feed");

            let mut chunked = GhosttyTerminalModel::new(TerminalModelOptions::new(80, 24))
                .expect("chunked fixture model should initialize");
            for byte in &fixture {
                chunked
                    .feed(std::slice::from_ref(byte))
                    .expect("single-byte fixture chunk should feed");
            }

            assert_eq!(
                whole
                    .encode_snapshot()
                    .expect("whole snapshot should encode"),
                chunked
                    .encode_snapshot()
                    .expect("chunked snapshot should encode"),
                "fixture {name} changed across read chunking",
            );
        }
    }
}
