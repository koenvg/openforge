#[path = "process_checkpoint.rs"]
mod checkpoint;
pub(crate) use checkpoint::ProcessCheckpoint;

#[cfg(test)]
#[path = "process_checkpoint_tests.rs"]
mod checkpoint_tests;
#[cfg(test)]
#[path = "process_reader_tests.rs"]
mod reader_tests;

use crate::input::InputWriter;
use crate::journal::SharedJournal;
use crate::managed_process::{
    terminate_managed_process_tree_with_root_reaper, ManagedProcessIdentity, RootReapMode,
};
use crate::process_native::{ChildHandle, Master};
use crate::quiescence::{Gate, Paused};
use crate::terminal_model::{
    TerminalModelEvent, TerminalModelEventSink, TerminalModelFeeder, TerminalModelOptions,
    TerminalModelSession,
};
use openforge_session_host::CapacityKind;
use openforge_session_protocol::*;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

pub struct Process {
    master: Master,
    child: ChildHandle,
    identity: ManagedProcessIdentity,
    writer: Arc<Mutex<InputWriter>>,
    model: Arc<TerminalModelSession>,
    reader: Arc<ReaderSignal>,
    reader_done: Arc<AtomicBool>,
    pty: PtyIdentity,
    root_exit: Option<(u32, Instant)>,
    session_key: String,
    reader_gate: Arc<Gate>,
    restore_pause: Option<Paused>,
    cleanup_on_drop: bool,
}

impl Process {
    #[cfg(test)]
    pub(crate) fn color_profile(&self) -> TerminalColorProfile {
        self.model.color_profile()
    }

    pub fn spawn(
        command: &ShellCommand,
        pty: PtyIdentity,
        journal: SharedJournal,
        color_profile: TerminalColorProfile,
    ) -> Result<Self, Error> {
        let pair = native_pty_system()
            .openpty(size(command.columns, command.rows))
            .map_err(|error| {
                let kind = error
                    .chain()
                    .find_map(|cause| cause.downcast_ref::<std::io::Error>())
                    .and_then(|cause| cause.raw_os_error())
                    .and_then(classify_pty_resource_error);
                kind.map(Error::CapacityExceeded)
                    .unwrap_or_else(|| host_error(error))
            })?;
        let fd = pair
            .master
            .as_raw_fd()
            .ok_or_else(|| Error::Host("PTY descriptor unavailable".into()))?;
        // SAFETY: fd is owned by pair.master; fcntl changes flags, not ownership.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        // SAFETY: fd remains live and the nonblocking flag is valid for a PTY.
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(host_error(std::io::Error::last_os_error()));
        }
        let reader = crate::process_native::duplicate(fd)?;
        let reader_signal = ReaderSignal::new(false)?;
        let writer = Arc::new(Mutex::new(InputWriter::new(
            pair.master.take_writer().map_err(host_error)?,
        )));
        let mut options = TerminalModelOptions::new(command.columns, command.rows)
            .with_color_profile(color_profile);
        options.max_scrollback_bytes = 256 * 1024;
        let (model, feeder) = TerminalModelSession::start_with_event_sink(
            command.owner.session_key(),
            pty.instance.value(),
            options,
            event_sink(
                pty.clone(),
                journal,
                Arc::clone(&writer),
                Arc::clone(&reader_signal),
            ),
        )
        .map_err(host_error)?;
        let model = Arc::new(model);
        let mut builder = CommandBuilder::new(&command.command.program);
        builder.args(&command.command.args);
        builder.cwd(&command.command.cwd);
        builder.env_clear();
        builder.env("TERM", "xterm-256color");
        builder.env("TERM_PROGRAM", "OpenForge");
        for (key, value) in &command.command.env {
            builder.env(key, value);
        }
        let mut child = pair.slave.spawn_command(builder).map_err(host_error)?;
        drop(pair.slave);
        let pid = child
            .process_id()
            .ok_or_else(|| Error::Host("child has no PID".into()))?;
        let identity = match ManagedProcessIdentity::capture(pid) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Error::Host(error));
            }
        };
        let process = Self {
            master: Master::Spawned(pair.master),
            child: ChildHandle::Spawned(child),
            identity,
            writer,
            model,
            reader: reader_signal,
            reader_done: Arc::new(AtomicBool::new(false)),
            pty,
            root_exit: None,
            session_key: command.owner.session_key(),
            reader_gate: Arc::new(Gate::default()),
            restore_pause: None,
            cleanup_on_drop: true,
        };
        process.start_reader(reader, feeder)?;
        Ok(process)
    }

    fn start_reader(
        &self,
        mut reader: std::fs::File,
        feeder: TerminalModelFeeder,
    ) -> Result<(), Error> {
        let pid = self.pid();
        let signal = Arc::clone(&self.reader);
        let reader_done = Arc::clone(&self.reader_done);
        let barrier = Arc::clone(&self.model);
        let reader_writer = Arc::clone(&self.writer);
        let reader_gate = Arc::clone(&self.reader_gate);
        std::thread::Builder::new()
            .name(format!("session-read-{pid}"))
            .spawn(move || {
                let mut buffer = [0; 8192];
                while !signal.stopping() {
                    let Some(admission) = reader_gate.enter() else {
                        reader_gate.wait_until_open();
                        continue;
                    };
                    // An abandoned restore sets stopping before reopening its gate.
                    // Recheck after admission so that teardown cannot race one read/write.
                    if signal.stopping() {
                        break;
                    }
                    let input_pending = reader_writer.lock().is_ok_and(|mut writer| {
                        let _ = writer.progress();
                        writer.has_pending()
                    });
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(size) => feeder.feed(&buffer[..size]),
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            // Pause must not wait behind an idle PTY.
                            drop(admission);
                            let ready = crate::wake::wait(
                                reader.as_raw_fd(),
                                input_pending,
                                &signal.wake,
                                None,
                            );
                            if ready.is_err() {
                                break;
                            }
                            signal.wake.drain();
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
                // Cross the authority queue before publishing the final process exit.
                let _ = barrier.portable_snapshot();
                reader_done.store(true, Ordering::Release);
                crate::wake::daemon().notify();
            })
            .map_err(host_error)?;
        Ok(())
    }

    pub fn pid(&self) -> u32 {
        self.identity.root_pid as u32
    }

    pub fn poll_exit(&mut self) -> Result<Option<u32>, Error> {
        // Root liveness is independent of a descendant-held slave or reader progress.
        if self.root_exit.is_none() {
            if let Some(code) = self.child.try_wait()? {
                self.root_exit = Some((code, Instant::now()));
            }
        }
        Ok(self.root_exit.map(|(code, _)| code))
    }

    pub fn output_drained(&self) -> bool {
        if self
            .root_exit
            .is_some_and(|(_, observed)| observed.elapsed() >= OUTPUT_DRAIN_GRACE)
        {
            self.reader.stop();
        }
        // The reader crosses the bounded authority barrier before setting this flag.
        self.reader_done.load(Ordering::Acquire)
    }

    pub fn drain_deadline(&self) -> Option<Instant> {
        let (_, observed) = self.root_exit?;
        (!self.reader.stopping()).then_some(observed + OUTPUT_DRAIN_GRACE)
    }

    pub fn operate(&self, action: &IoAction) -> Result<(), Error> {
        match action {
            IoAction::Write(bytes) => {
                write_input(&self.writer, &self.reader, |writer| writer.submit(bytes))
            }
            IoAction::Resize { columns, rows } => {
                self.master.resize(size(*columns, *rows))?;
                self.model.resize(*columns, *rows);
                self.model
                    .portable_snapshot()
                    .map_err(|_| Error::OutcomeUnknown)?;
                Ok(())
            }
        }
    }

    pub fn update_color_profile(&self, profile: TerminalColorProfile) -> Result<(), Error> {
        self.model
            .update_color_profile(profile)
            .map_err(Error::Host)
    }

    pub fn recover(&self, cursor: u64) -> Result<Recovery, Error> {
        let snapshot = self
            .model
            .portable_snapshot()
            .map_err(|_| Error::RecoveryUnavailable)?;
        if snapshot.portable_vt.len()
            + snapshot.compatibility_replay.len()
            + snapshot.continuation.len()
            > 768 * 1024
        {
            return Err(Error::Capacity);
        }
        Ok(Recovery {
            pty: self.pty.clone(),
            watermark: snapshot.watermark,
            cursor,
            portable_vt: snapshot.portable_vt,
            compatibility_replay: snapshot.compatibility_replay,
            continuation: snapshot.continuation,
        })
    }

    pub fn terminate(&mut self) -> Result<(), Error> {
        std::thread::scope(|scope| scope.spawn(|| self.terminate_off_executor()).join())
            .map_err(|_| Error::OutcomeUnknown)?
    }

    fn terminate_off_executor(&mut self) -> Result<(), Error> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(host_error)?;
        runtime
            .block_on(terminate_managed_process_tree_with_root_reaper(
                &self.identity,
                Duration::from_millis(200),
                |mode| match mode {
                    RootReapMode::Poll => {
                        let _ = self.child.try_wait();
                    }
                    RootReapMode::Wait => {
                        let _ = self.child.wait();
                    }
                },
            ))
            .map_err(Error::Host)?;
        Ok(())
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // Used only for explicit scoped cleanup, failed spawn, or an already exited root.
        if self.cleanup_on_drop {
            if let Err(error) = self.terminate() {
                eprintln!("session cleanup failed: {error}");
            }
        }
        self.reader.stop();
    }
}

const OUTPUT_DRAIN_GRACE: Duration = Duration::from_millis(250);

pub(crate) struct ReaderSignal {
    stopping: AtomicBool,
    wake: crate::wake::Wake,
}
impl ReaderSignal {
    fn new(stopping: bool) -> Result<Arc<Self>, Error> {
        Ok(Arc::new(Self {
            stopping: AtomicBool::new(stopping),
            wake: crate::wake::Wake::new().map_err(host_error)?,
        }))
    }
    fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }
    fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        self.wake.notify();
    }
}

fn write_input(
    writer: &Mutex<InputWriter>,
    reader: &ReaderSignal,
    write: impl FnOnce(&mut InputWriter) -> Result<(), Error>,
) -> Result<(), Error> {
    let mut writer = writer.lock().map_err(|_| Error::OutcomeUnknown)?;
    let result = write(&mut writer);
    if writer.has_pending() {
        // The reader owns retrying the suffix once the PTY becomes writable.
        reader.wake.notify();
    }
    result
}

fn event_sink(
    pty: PtyIdentity,
    journal: SharedJournal,
    writer: Arc<Mutex<InputWriter>>,
    reader: Arc<ReaderSignal>,
) -> TerminalModelEventSink {
    Arc::new(move |event| match event {
        TerminalModelEvent::Output(frame) => journal.publish(Event::Output {
            pty: pty.clone(),
            sequence: frame.sequence,
            data: frame.bytes,
        }),
        TerminalModelEvent::ProtocolReply { bytes, .. } => {
            if write_input(&writer, &reader, |writer| writer.reply(&bytes)).is_err() {
                journal.publish(Event::RecoveryRequired { pty: pty.clone() });
            }
        }
        TerminalModelEvent::Disabled { .. } => {
            journal.publish(Event::RecoveryRequired { pty: pty.clone() });
        }
    })
}

fn size(columns: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols: columns,
        pixel_width: 0,
        pixel_height: 0,
    }
}
fn host_error(error: impl std::fmt::Display) -> Error {
    Error::Host(error.to_string())
}
fn classify_pty_resource_error(code: i32) -> Option<CapacityKind> {
    match code {
        libc::ENXIO | libc::ENOSPC => Some(CapacityKind::PtyDevices),
        libc::EMFILE | libc::ENFILE => Some(CapacityKind::FileDescriptors),
        libc::EAGAIN => Some(CapacityKind::ProcessSlots),
        libc::ENOMEM => Some(CapacityKind::MemoryHeadroom),
        _ => None,
    }
}

#[cfg(test)]
mod resource_tests {
    use super::*;
    use openforge_session_host::CapacityKind;

    #[test]
    fn os_pty_refusals_keep_resource_identity() {
        assert_eq!(
            classify_pty_resource_error(libc::ENXIO),
            Some(CapacityKind::PtyDevices)
        );
        assert_eq!(
            classify_pty_resource_error(libc::EMFILE),
            Some(CapacityKind::FileDescriptors)
        );
        assert_eq!(
            classify_pty_resource_error(libc::EAGAIN),
            Some(CapacityKind::ProcessSlots)
        );
        assert_eq!(classify_pty_resource_error(libc::EIO), None);
    }
}
