//! One-session, single-threaded feasibility owner, never a production host.
#[path = "live_native.rs"]
mod native;
#[path = "live_preflight.rs"]
mod preflight;
#[allow(dead_code, unused_imports)]
#[path = "../../../../../src-tauri/src/terminal_model.rs"]
mod terminal_model;

use libghostty_vt::{
    fmt::{Format, Formatter, FormatterOptions},
    snapshot::Decoder,
};
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    mem::ManuallyDrop,
    os::{
        fd::{FromRawFd, IntoRawFd},
        unix::{
            fs::{FileExt, OpenOptionsExt},
            process::CommandExt,
        },
    },
    path::PathBuf,
    process::Command,
};
use terminal_model::{GhosttyTerminalModel, TerminalModel, TerminalModelOptions};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const LIMIT: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Activation {
    Pending {
        requested_version: u8,
    },
    Active {
        requested_version: u8,
    },
    Failed {
        requested_version: u8,
        stage: FailureStage,
    },
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum FailureStage {
    Exec,
    Initialization,
    Version,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Checkpoint {
    format: u32,
    host: u32,
    state_fd: i32,
    pty: native::Pty,
    cursor: u64,
    writes: u64,
    replies: u64,
    recoveries: u32,
    recovery_image: PathBuf,
    fail_resume: bool,
    forget_state: bool,
    activation: Option<Activation>,
    model: Vec<u8>,
}

fn checkpoint_file(fd: i32) -> Result<ManuallyDrop<File>> {
    // SAFETY: fcntl validates the integer before we construct the non-owning view.
    if fd < 3 || unsafe { libc::fcntl(fd, libc::F_GETFD) } < 0 {
        return Err("invalid checkpoint descriptor".into());
    }
    // SAFETY: fd is live. ManuallyDrop prevents closing it on controlled fallback.
    Ok(ManuallyDrop::new(unsafe { File::from_raw_fd(fd) }))
}

fn save(state: &Checkpoint) -> Result<()> {
    let bytes = serde_json::to_vec(state)?;
    if bytes.len() > LIMIT {
        return Err("checkpoint budget exceeded".into());
    }
    let file = checkpoint_file(state.state_fd)?;
    file.write_all_at(&bytes, 0)?;
    file.set_len(bytes.len() as u64)?;
    Ok(())
}

fn restore(fd: i32) -> Result<Checkpoint> {
    let file = checkpoint_file(fd)?;
    let length = usize::try_from(file.metadata()?.len())?;
    if length > LIMIT {
        return Err("checkpoint budget exceeded".into());
    }
    let mut bytes = vec![0; length];
    file.read_exact_at(&mut bytes, 0)?;
    let state: Checkpoint = serde_json::from_slice(&bytes)?;
    if state.format != preflight::STATE_FORMAT
        || state.host != std::process::id()
        || state.state_fd != fd
        || state.pty.fd < 3
        || state.pty.fd == fd
    {
        return Err("incompatible checkpoint".into());
    }
    state.pty.geometry()?;
    Ok(state)
}

fn publish(value: serde_json::Value) -> Result<()> {
    let mut out = io::stdout().lock();
    writeln!(out, "{value}")?;
    out.flush()?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn unhex(text: &str) -> Result<Vec<u8>> {
    if !text.is_ascii() || !text.len().is_multiple_of(2) {
        return Err("invalid hex".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| Ok(u8::from_str_radix(&text[i..i + 2], 16)?))
        .collect()
}

fn inventory(version: u8, state: &mut Checkpoint, model: &GhosttyTerminalModel) -> Result<()> {
    state.pty.reap()?;
    let size = state.pty.geometry()?;
    // Inspect a binary clone instead of reparsing the entire scrollback. After
    // partial-parser restore the codec temporarily refuses another checkpoint;
    // only this presentation diagnostic may then use portable VT. Owner recovery
    // always decodes the binary checkpoint, never this diagnostic terminal.
    let presentation = match model.encode_snapshot() {
        Ok(snapshot) => Decoder::new_buf(&snapshot)?.decode()?,
        Err(terminal_model::TerminalModelError::ContinuationUnavailable) => {
            let mut terminal = libghostty_vt::Terminal::new(size.ws_col, size.ws_row)?;
            terminal.vt_write(&model.format_portable_vt()?);
            terminal
        }
        Err(error) => return Err(error.into()),
    };
    let mut formatter = Formatter::new(
        &presentation,
        FormatterOptions::new().with_format(Format::Plain),
    )?;
    let text = formatter.format_alloc(None)?;
    publish(serde_json::json!({
        "host": state.host, "version": version, "recoveries": state.recoveries,
        "stateFd": state.state_fd, "rows": size.ws_row, "cols": size.ws_col,
        "architecture": std::env::consts::ARCH,
        "activation": state.activation,
        "writes": state.writes, "replies": state.replies,
        "checkpointBytes": checkpoint_file(state.state_fd)?.metadata()?.len(),
        "text": String::from_utf8_lossy(text.as_ref()),
        "children": [{"pid": state.pty.pid, "fd": state.pty.fd,
                      "cursor": state.cursor, "reaped": state.pty.reaped, "status": state.pty.status}]
    }))
}

fn command_line() -> Result<String> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = 0_u8;
        // SAFETY: one initialized byte is writable; fd 0 is the private control pipe.
        let count = unsafe { libc::read(0, (&mut byte as *mut u8).cast(), 1) };
        if count < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error.into());
        }
        if count == 0 || byte == b'\n' {
            break;
        }
        if bytes.len() == 8192 {
            return Err("command budget exceeded".into());
        }
        bytes.push(byte);
    }
    Ok(String::from_utf8(bytes)?)
}

fn serve(version: u8, state: &mut Checkpoint, model: &mut GhosttyTerminalModel) -> Result<()> {
    inventory(version, state, model)?;
    loop {
        let line = command_line()?;
        let args: Vec<_> = line.split_whitespace().collect();
        match args.as_slice() {
            [] | ["STOP"] => break,
            ["INFO"] => inventory(version, state, model)?,
            ["READ", "0"] => {
                let bytes = state.pty.read()?;
                model.feed(&bytes)?;
                for reply in model.take_protocol_replies() {
                    native::write(state.pty.fd, &reply)?;
                    state.replies += 1;
                }
                publish(serde_json::json!({"cursor":state.cursor, "hex":hex(&bytes)}))?;
                state.cursor += bytes.len() as u64;
            }
            ["WRITE", "0", encoded] => {
                native::write(state.pty.fd, &unhex(encoded)?)?;
                state.writes += 1;
                publish(serde_json::json!({"ok":true}))?;
            }
            ["SIZE", "0", rows, cols] => {
                let rows = rows.parse::<u16>()?;
                let cols = cols.parse::<u16>()?;
                if rows == 0 || cols == 0 {
                    return Err("zero geometry".into());
                }
                state.pty.resize(rows, cols)?;
                model.resize(cols, rows)?;
                publish(serde_json::json!({"ok":true}))?;
            }
            ["REEXEC", target, fault @ ..] if fault.is_empty() || fault == ["FAIL"] => {
                let (target_version, recovery_image) = match preflight::validate(target, version) {
                    Ok(images) => images,
                    Err(error) => {
                        publish(serde_json::json!({"refused":error.to_string()}))?;
                        continue;
                    }
                };
                // All accepted input and replies have been written synchronously.
                state.pty.reap()?;
                state.model = match model.encode_snapshot() {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        publish(serde_json::json!({"refused":error.to_string()}))?;
                        continue;
                    }
                };
                state.recovery_image = recovery_image;
                state.fail_resume = !fault.is_empty();
                state.activation = Some(Activation::Pending {
                    requested_version: target_version,
                });
                save(state)?;
                native::allowlist(state.pty.fd, state.state_fd)?;
                publish(serde_json::json!({"prepared":true}))?;
                match command_line()?.trim() {
                    "ABORT" => {
                        inventory(version, state, model)?;
                        continue;
                    }
                    "GO" => {}
                    _ => return Err("invalid checkpoint barrier".into()),
                }
                let error = Command::new(target)
                    .arg("resume")
                    .arg(state.state_fd.to_string())
                    .exec();
                state.activation = Some(Activation::Failed {
                    requested_version: target_version,
                    stage: FailureStage::Exec,
                });
                publish(serde_json::json!({
                    "execError":error.raw_os_error(), "activation":state.activation,
                }))?;
            }
            _ => return Err("invalid fixture command".into()),
        }
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
#[error("service: {service}; cleanup: {cleanup}")]
struct ServiceAndCleanupError {
    service: Box<dyn std::error::Error>,
    cleanup: Box<dyn std::error::Error>,
}

fn finish(service: Result<()>, cleanup: Result<()>) -> Result<()> {
    match (service, cleanup) {
        (Err(service), Err(cleanup)) => Err(Box::new(ServiceAndCleanupError { service, cleanup })),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

pub fn run(version: u8) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err("macOS evidence only".into());
    }
    let args: Vec<_> = env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--check-image") {
        return preflight::describe(version);
    }
    let (mut state, mut model) = match args.get(1).map(String::as_str) {
        Some("start") => {
            let model = GhosttyTerminalModel::new(TerminalModelOptions::new(20, 4))?;
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open("model-checkpoint")?;
            fs::remove_file("model-checkpoint")?;
            let state_fd = file.into_raw_fd();
            let pty = native::Pty::spawn(args.get(2).ok_or("missing fixture")?)?;
            let state = Checkpoint {
                format: preflight::STATE_FORMAT,
                host: std::process::id(),
                state_fd,
                pty,
                cursor: 0,
                writes: 0,
                replies: 0,
                recoveries: 0,
                recovery_image: env::current_exe()?,
                fail_resume: false,
                forget_state: args.get(3).is_some_and(|arg| arg == "forget-state"),
                activation: None,
                model: Vec::new(),
            };
            (state, model)
        }
        Some("resume") => {
            let fd = args.get(2).ok_or("missing descriptor")?.parse::<i32>()?;
            let mut state = restore(fd)?;
            let failure = match state.activation {
                Some(Activation::Pending { requested_version }) if version != requested_version => {
                    Some(FailureStage::Version)
                }
                _ if state.fail_resume => Some(FailureStage::Initialization),
                _ => None,
            };
            if let Some(stage) = failure {
                state.fail_resume = false;
                state.recoveries += 1;
                if let Some(Activation::Pending { requested_version }) = state.activation {
                    state.activation = Some(Activation::Failed {
                        requested_version,
                        stage,
                    });
                }
                save(&state)?;
                // No owning PTY wrapper, parser or reader has been installed yet.
                return Err(Command::new(&state.recovery_image)
                    .arg("resume")
                    .arg(fd.to_string())
                    .exec()
                    .into());
            }
            let model = if state.forget_state {
                // Negative control must fail continuation and primary-screen assertions.
                GhosttyTerminalModel::new(TerminalModelOptions::new(20, 4))?
            } else {
                GhosttyTerminalModel::decode_snapshot(&state.model)?
            };
            if let Some(Activation::Pending { requested_version }) = state.activation {
                state.activation = Some(Activation::Active { requested_version });
            }
            (state, model)
        }
        _ => return Err("expected start or resume".into()),
    };
    let result = serve(version, &mut state, &mut model);
    let cleanup = state.pty.stop();
    // SAFETY: final shutdown only; no replacement can run after serve returns.
    unsafe {
        libc::close(state.state_fd);
    }
    finish(result, cleanup)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_and_cleanup_failures_are_both_preserved() {
        let service = io::Error::other("service failed");
        let cleanup = io::Error::other("reaping failed");
        let error = finish(Err(service.into()), Err(cleanup.into())).unwrap_err();
        let combined = error.downcast_ref::<ServiceAndCleanupError>().unwrap();
        assert_eq!(combined.service.to_string(), "service failed");
        assert_eq!(combined.cleanup.to_string(), "reaping failed");
        assert!(error.to_string().contains("service failed"));
        assert!(error.to_string().contains("reaping failed"));
    }
}
