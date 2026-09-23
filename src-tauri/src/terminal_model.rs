#[path = "terminal_model/session.rs"]
mod session;

#[allow(
    unused_imports,
    reason = "Checkpoint export is consumed by the daemon's shared-source build"
)]
pub(crate) use session::TerminalModelCheckpoint;
pub(crate) use session::{
    TerminalModelEvent, TerminalModelEventSink, TerminalModelFeeder, TerminalModelSession,
};
#[cfg(test)]
pub(crate) use session::{
    TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY, TERMINAL_MODEL_QUEUE_SATURATION_TEST_BYTES,
};

use libghostty_vt::{
    fmt::{Format, Formatter, FormatterOptions},
    snapshot::Decoder,
    style::{Palette, RgbColor},
    terminal::{
        ConformanceLevel, DeviceAttributeFeature, DeviceAttributes, DeviceType,
        PrimaryDeviceAttributes, SecondaryDeviceAttributes, TertiaryDeviceAttributes,
    },
    Terminal,
};
use openforge_session_host::{TerminalColorProfile, TerminalRgbColor};
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::{Arc, Condvar, Mutex};
use std::{cell::RefCell, collections::VecDeque, rc::Rc};

const DEFAULT_SCROLLBACK_BYTES: usize = 8 * 1024 * 1024;
// Ghostty grows continuation storage lazily but retains its peak allocation.
// Keep that peak within the replay carried by portable snapshots.
const MAX_SNAPSHOT_CONTINUATION_BYTES: usize = 256 * 1024;

#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct TerminalModelQueueSaturationGate {
    queue_saturation_signaled: Arc<AtomicBool>,
    first_command_release: Arc<(Mutex<bool>, Condvar)>,
}

#[cfg(test)]
impl TerminalModelQueueSaturationGate {
    pub(crate) fn new() -> Self {
        Self {
            queue_saturation_signaled: Arc::new(AtomicBool::new(false)),
            first_command_release: Arc::new((Mutex::new(false), Condvar::new())),
        }
    }

    pub(crate) fn is_queue_saturated(&self) -> bool {
        self.queue_saturation_signaled.load(Ordering::Acquire)
    }

    pub(crate) fn release_first_command(&self) {
        let (released, wake) = &*self.first_command_release;
        *released
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        wake.notify_all();
    }

    fn mark_queue_saturated(&self) {
        self.queue_saturation_signaled
            .store(true, Ordering::Release);
    }

    fn block_first_command(&self) {
        let (released, wake) = &*self.first_command_release;
        let guard = released
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drop(
            wake.wait_while(guard, |released| !*released)
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
    }
}

#[cfg(test)]
#[derive(Clone, Debug, Default)]
pub(crate) enum TerminalModelTestFault {
    #[default]
    None,
    CreateFailure,
    BlockFirstCommand(TerminalModelQueueSaturationGate),
    PanicOnFirstCommand,
    ColorProfileUpdateFailure,
}

#[cfg_attr(not(test), derive(Clone, Copy, Debug, PartialEq, Eq))]
#[cfg_attr(test, derive(Clone, Debug))]
pub(crate) struct TerminalModelOptions {
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) max_scrollback_bytes: usize,
    pub(crate) max_continuation_bytes: usize,
    pub(crate) color_profile: TerminalColorProfile,
    #[cfg(test)]
    pub(crate) test_fault: TerminalModelTestFault,
}

impl TerminalModelOptions {
    pub(crate) fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            max_scrollback_bytes: DEFAULT_SCROLLBACK_BYTES,
            max_continuation_bytes: MAX_SNAPSHOT_CONTINUATION_BYTES,
            color_profile: TerminalColorProfile::default(),
            #[cfg(test)]
            test_fault: TerminalModelTestFault::None,
        }
    }

    pub(crate) fn with_color_profile(mut self, color_profile: TerminalColorProfile) -> Self {
        self.color_profile = color_profile;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_test_fault(mut self, test_fault: TerminalModelTestFault) -> Self {
        self.test_fault = test_fault;
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum TerminalModelError {
    #[error("ghostty terminal model error: {0}")]
    Ghostty(#[from] libghostty_vt::Error),
    #[error("terminal snapshot continuation is temporarily unavailable")]
    ContinuationUnavailable,
    #[error("ghostty produced an empty canonical snapshot")]
    EmptySnapshot,
    #[error("ghostty portable snapshot content did not match its state-prefixed output")]
    PortableSnapshotLayout,
}

pub(crate) trait TerminalModel {
    fn feed(&mut self, bytes: &[u8]) -> Result<(), TerminalModelError>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), TerminalModelError>;
    fn update_color_profile(
        &mut self,
        profile: TerminalColorProfile,
    ) -> Result<(), TerminalModelError>;
    fn encode_snapshot(&self) -> Result<Vec<u8>, TerminalModelError>;
    fn format_portable_vt(&self) -> Result<Vec<u8>, TerminalModelError>;
    fn take_protocol_replies(&mut self) -> Vec<Vec<u8>>;
}

type ProtocolReplies = Rc<RefCell<VecDeque<Vec<u8>>>>;

pub(crate) struct GhosttyTerminalModel {
    terminal: Terminal<'static, 'static>,
    protocol_replies: ProtocolReplies,
    color_profile: TerminalColorProfile,
}

impl GhosttyTerminalModel {
    pub(crate) fn new(options: TerminalModelOptions) -> Result<Self, TerminalModelError> {
        let mut terminal = Terminal::new(options.cols, options.rows)?;
        terminal
            .set_scrollback_max_bytes(Some(options.max_scrollback_bytes))?
            .set_continuation_max_bytes(options.max_continuation_bytes)?;
        apply_color_profile(&mut terminal, options.color_profile)?;
        Self::from_terminal(terminal, options.color_profile)
    }

    pub(crate) fn decode_snapshot(snapshot: &[u8]) -> Result<Self, TerminalModelError> {
        let decoder = Decoder::new_buf(snapshot)?;
        let mut terminal = decoder.decode()?;
        terminal.set_continuation_max_bytes(MAX_SNAPSHOT_CONTINUATION_BYTES)?;
        Self::from_terminal(terminal, TerminalColorProfile::default())
    }

    fn ensure_snapshot_continuation_available(&self) -> Result<(), TerminalModelError> {
        match self.terminal.continuation_buf(&mut []) {
            Err(libghostty_vt::Error::OutOfSpace { .. }) => Ok(()),
            Err(libghostty_vt::Error::InvalidValue) | Ok(None) => {
                Err(TerminalModelError::ContinuationUnavailable)
            }
            Err(error) => Err(error.into()),
            Ok(Some(_)) => Ok(()),
        }
    }

    fn parser_continuation(&self) -> Result<Vec<u8>, TerminalModelError> {
        let size = match self.terminal.continuation_buf(&mut []) {
            Err(libghostty_vt::Error::OutOfSpace { required }) => required,
            Err(libghostty_vt::Error::InvalidValue) | Ok(None) => {
                return Err(TerminalModelError::ContinuationUnavailable);
            }
            Err(error) => return Err(error.into()),
            Ok(Some(size)) => size,
        };
        if size == 0 {
            return Ok(Vec::new());
        }
        let mut continuation = vec![0; size];
        match self.terminal.continuation_buf(&mut continuation)? {
            Some(written) if written == size => Ok(continuation),
            _ => Err(TerminalModelError::ContinuationUnavailable),
        }
    }

    fn from_terminal(
        mut terminal: Terminal<'static, 'static>,
        color_profile: TerminalColorProfile,
    ) -> Result<Self, TerminalModelError> {
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
        terminal.on_xtversion(|_terminal| Some("OpenForge terminal model"))?;
        Ok(Self {
            terminal,
            protocol_replies,
            color_profile,
        })
    }

    pub(super) fn color_profile(&self) -> TerminalColorProfile {
        self.color_profile
    }
}

fn apply_color_profile(
    terminal: &mut Terminal<'_, '_>,
    profile: TerminalColorProfile,
) -> Result<(), TerminalModelError> {
    let palette = Palette(profile.xterm_palette().map(ghostty_rgb));
    terminal
        .set_default_fg_color(Some(ghostty_rgb(profile.foreground)))?
        .set_default_bg_color(Some(ghostty_rgb(profile.background)))?
        .set_default_cursor_color(Some(ghostty_rgb(profile.cursor)))?
        .set_default_color_palette(Some(palette))?;
    Ok(())
}

const fn ghostty_rgb(color: TerminalRgbColor) -> RgbColor {
    RgbColor {
        r: color.red,
        g: color.green,
        b: color.blue,
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

    fn update_color_profile(
        &mut self,
        profile: TerminalColorProfile,
    ) -> Result<(), TerminalModelError> {
        apply_color_profile(&mut self.terminal, profile)?;
        self.color_profile = profile;
        Ok(())
    }

    fn encode_snapshot(&self) -> Result<Vec<u8>, TerminalModelError> {
        self.ensure_snapshot_continuation_available()?;
        self.terminal
            .encode_snapshot_alloc(None)?
            .map(|bytes| bytes.as_ref().to_vec())
            .ok_or(TerminalModelError::EmptySnapshot)
    }

    fn format_portable_vt(&self) -> Result<Vec<u8>, TerminalModelError> {
        let options = |prefix| {
            FormatterOptions::new()
                .with_format(Format::Vt)
                .with_palette(prefix)
                .with_modes(prefix)
                .with_scrolling_region(true)
                .with_tabstops(prefix)
                .with_pwd(true)
                .with_keyboard(true)
                .with_cursor(true)
                .with_style(true)
                .with_hyperlink(true)
                .with_protection(true)
                .with_kitty_keyboard(true)
                .with_charsets(true)
        };
        let mut formatter = Formatter::new(&self.terminal, options(true))?;
        let full = formatter.format_alloc(None)?;
        let mut formatter = Formatter::new(&self.terminal, options(false))?;
        let content = formatter.format_alloc(None)?;

        // The pinned Ghostty formatter emits palette, modes and tab stops before
        // content, but leaves the cursor at the last tab stop. Its C API cannot
        // format state alone. Separate the prefix without parsing VT or dropping
        // custom tabs, and fail closed if an upstream formatter changes layout.
        let prefix = full
            .as_ref()
            .strip_suffix(content.as_ref())
            .ok_or(TerminalModelError::PortableSnapshotLayout)?;
        let mut snapshot = Vec::with_capacity(full.as_ref().len() + 3);
        snapshot.extend_from_slice(prefix);
        snapshot.extend_from_slice(b"\x1b[H");
        snapshot.extend_from_slice(content.as_ref());
        Ok(snapshot)
    }

    fn take_protocol_replies(&mut self) -> Vec<Vec<u8>> {
        self.protocol_replies.borrow_mut().drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{GhosttyTerminalModel, TerminalModel, TerminalModelOptions};

    #[test]
    fn default_continuation_memory_is_bounded_per_terminal() {
        let options = TerminalModelOptions::new(80, 24);

        assert_eq!(options.max_continuation_bytes, 256 * 1024);
    }
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
    fn portable_snapshot_keeps_editor_rows_and_cursor_together() {
        use libghostty_vt::fmt::{Format, Formatter, FormatterOptions};

        let mut original = GhosttyTerminalModel::new(TerminalModelOptions::new(24, 6))
            .expect("terminal should initialize");
        original
            .feed(b"\x1b[3g\x1b[5G\x1bH\x1b[13G\x1bH\x1b[HHEADER\r\n--------------------\r\nINPUT\r\n--------------------\r\nfooter\x1b[3;6H")
            .expect("editor should render");
        let snapshot = original
            .format_portable_vt()
            .expect("snapshot should format");
        let mut restored = GhosttyTerminalModel::new(TerminalModelOptions::new(24, 6))
            .expect("replacement terminal should initialize");
        restored.feed(&snapshot).expect("snapshot should replay");
        restored
            .feed(b"_AFTER\x1b[6n")
            .expect("typing should continue");

        let mut formatter = Formatter::new(
            &restored.terminal,
            FormatterOptions::new()
                .with_format(Format::Plain)
                .with_trim(true),
        )
        .expect("plain formatter should initialize");
        let text = formatter.format_alloc(None).expect("screen should format");
        assert_eq!(
            String::from_utf8_lossy(text.as_ref()).trim_end(),
            "HEADER\n--------------------\nINPUT_AFTER\n--------------------\nfooter",
        );
        drop(formatter);
        assert_eq!(
            restored.take_protocol_replies(),
            vec![b"\x1b[3;12R".to_vec()]
        );

        // Restoring the editor must not discard its non-default tab stops.
        restored
            .feed(b"\x1b[1;1H\t\x1b[6n")
            .expect("tab should advance");
        assert_eq!(
            restored.take_protocol_replies(),
            vec![b"\x1b[1;5R".to_vec()]
        );
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
    fn terminal_model_profile_answers_batched_colour_queries_once() {
        use openforge_session_host::{TerminalColorProfile, TerminalRgbColor};

        let mut profile = TerminalColorProfile {
            foreground: TerminalRgbColor::new(17, 34, 51),
            background: TerminalRgbColor::new(68, 85, 102),
            cursor: TerminalRgbColor::new(119, 136, 153),
            ..Default::default()
        };
        profile.ansi_colors[1] = TerminalRgbColor::new(170, 187, 204);
        let options = TerminalModelOptions::new(80, 24).with_color_profile(profile);
        let mut model = GhosttyTerminalModel::new(options)
            .expect("terminal model should initialize with a colour profile");

        model
            .feed(b"\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07\x1b]4;1;?\x07")
            .expect("batched colour queries should feed");

        let replies = model.take_protocol_replies();
        assert_eq!(replies.len(), 4);
        let replies = replies
            .iter()
            .map(|reply| String::from_utf8_lossy(reply))
            .collect::<Vec<_>>();
        assert!(replies[0].contains("rgb:1111/2222/3333"));
        assert!(replies[1].contains("rgb:4444/5555/6666"));
        assert!(replies[2].contains("rgb:7777/8888/9999"));
        assert!(replies[3].contains("4;1;rgb:aaaa/bbbb/cccc"));
        assert!(model.take_protocol_replies().is_empty());
    }

    #[test]
    fn codex_colour_query_probe_survives_live_switch_and_snapshot_recovery() {
        use openforge_session_host::{TerminalColorProfile, TerminalRgbColor};
        use std::collections::HashSet;

        fn query_batch() -> Vec<u8> {
            let mut queries = b"\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07".to_vec();
            for index in 0..16 {
                queries.extend_from_slice(format!("\x1b]4;{index};?\x07").as_bytes());
            }
            queries
        }

        fn query(model: &mut GhosttyTerminalModel, batch: &[u8]) -> Vec<Vec<u8>> {
            model.feed(batch).expect("Codex colour queries should feed");
            let replies = model.take_protocol_replies();
            assert_eq!(replies.len(), 19, "each query must receive one reply");
            let identifiers = ["10", "11", "12"]
                .into_iter()
                .map(str::to_string)
                .chain((0..16).map(|index| format!("4;{index}")))
                .collect::<Vec<_>>();
            for (index, identifier) in identifiers.iter().enumerate() {
                let expected = format!("\x1b]{identifier};rgb:");
                assert!(
                    replies[index]
                        .windows(expected.len())
                        .any(|part| part == expected.as_bytes()),
                    "reply {index} did not match query {identifier}"
                );
            }
            assert!(model.take_protocol_replies().is_empty());
            replies
        }

        fn luminance(color: TerminalRgbColor) -> f64 {
            let channel = |value: u8| {
                let value = f64::from(value) / 255.0;
                if value <= 0.04045 {
                    value / 12.92
                } else {
                    ((value + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * channel(color.red)
                + 0.7152 * channel(color.green)
                + 0.0722 * channel(color.blue)
        }

        let light = TerminalColorProfile::default();
        let contrast = (luminance(light.foreground).max(luminance(light.background)) + 0.05)
            / (luminance(light.foreground).min(luminance(light.background)) + 0.05);
        assert!(contrast >= 4.5, "light profile contrast was {contrast:.2}");
        let distinct = light
            .ansi_colors
            .into_iter()
            .map(|color| (color.red, color.green, color.blue))
            .collect::<HashSet<_>>();
        assert!(distinct.len() >= 12);
        let batch = query_batch();
        let mut model =
            GhosttyTerminalModel::new(TerminalModelOptions::new(80, 24).with_color_profile(light))
                .expect("terminal model should initialize");
        let light_replies = query(&mut model, &batch);

        let mut dark = light;
        dark.background = TerminalRgbColor::new(12, 14, 18);
        dark.foreground = TerminalRgbColor::new(238, 241, 245);
        dark.cursor = TerminalRgbColor::new(166, 180, 255);
        for (index, color) in dark.ansi_colors.iter_mut().enumerate() {
            let channel = u8::try_from(index).unwrap();
            *color = TerminalRgbColor::new(32 + channel * 7, 48 + channel * 5, 64 + channel * 3);
        }
        model
            .update_color_profile(dark)
            .expect("live profile switch should apply");
        let dark_replies = query(&mut model, &batch);
        assert_ne!(dark_replies, light_replies);

        let snapshot = model
            .format_portable_vt()
            .expect("authority snapshot should format");
        let mut recovered =
            GhosttyTerminalModel::new(TerminalModelOptions::new(80, 24).with_color_profile(dark))
                .expect("recovery model should initialize");
        recovered
            .feed(&snapshot)
            .expect("authority snapshot should recover");
        recovered.take_protocol_replies();
        assert_eq!(query(&mut recovered, &batch), dark_replies);
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
