//! Deterministic echo-terminal adapter for the shared behavior contract. This is not
//! a shell interpreter or terminal conformance substitute. It has no OS processes.

use super::*;
use base64::Engine;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
mod controls;
pub(super) use controls::controlled_host;

#[derive(Default, Clone)]
pub(super) struct DeterministicBackend {
    sessions: Arc<Mutex<HashMap<String, MemorySession>>>,
    next: Arc<std::sync::atomic::AtomicU64>,
    spawn_pause: Arc<Mutex<Option<SpawnPause>>>,
}

struct MemorySession {
    instance: PtyInstanceId,
    sequence: u64,
    transcript: Vec<u8>,
    input: Vec<u8>,
    columns: u16,
    rows: u16,
    output: tokio::sync::broadcast::Sender<BackendOutput>,
}

pub(super) fn host(installation: InstallationId) -> InProcessHost<DeterministicBackend> {
    InProcessHost::new(
        DeterministicBackend::default(),
        installation,
        Arc::new(Mutex::new(HostState::new())),
    )
}

struct SpawnPause {
    reached: tokio::sync::oneshot::Sender<()>,
    release: tokio::sync::oneshot::Receiver<()>,
}

pub(super) fn paused_host(
    installation: InstallationId,
) -> (
    InProcessHost<DeterministicBackend>,
    tokio::sync::oneshot::Receiver<()>,
    tokio::sync::oneshot::Sender<()>,
) {
    let (reached_tx, reached) = tokio::sync::oneshot::channel();
    let (release, release_rx) = tokio::sync::oneshot::channel();
    let backend = DeterministicBackend {
        spawn_pause: Arc::new(Mutex::new(Some(SpawnPause {
            reached: reached_tx,
            release: release_rx,
        }))),
        ..Default::default()
    };
    (
        InProcessHost::new(
            backend,
            installation,
            Arc::new(Mutex::new(HostState::new())),
        ),
        reached,
        release,
    )
}

impl HostBackend for DeterministicBackend {
    async fn set_terminal_color_profile(
        &self,
        _profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        Ok(())
    }

    async fn inventory(&self) -> Result<Vec<BackendSession>, HostError> {
        Ok(self
            .sessions
            .lock()
            .await
            .iter()
            .map(|(key, session)| BackendSession {
                instance: session.instance,
                session_key: key.clone(),
                state: HostedSessionState::Live,
            })
            .collect())
    }

    async fn spawn_prepared(&self, request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        let instance =
            PtyInstanceId::new(self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1)?;
        let session = MemorySession {
            instance,
            sequence: 1,
            transcript: b"host-ready\r\n".to_vec(),
            input: Vec::new(),
            columns: request.columns,
            rows: request.rows,
            output: tokio::sync::broadcast::channel(256).0,
        };
        if let Some(previous) = self
            .sessions
            .lock()
            .await
            .insert(request.owner.session_key(), session)
        {
            let _ = previous.output.send(BackendOutput::Exited);
        }
        let pause = self.spawn_pause.lock().await.take();
        if let Some(pause) = pause {
            let _ = pause.reached.send(());
            let _ = pause.release.await;
        }
        Ok(instance)
    }

    async fn terminate_exact(&self, target: &HostedSession) -> Result<(), HostError> {
        let mut sessions = self.sessions.lock().await;
        match sessions.get(&target.session_key) {
            Some(session) if session.instance != target.pty.instance => {
                return Err(HostError::StalePty)
            }
            None if target.state != HostedSessionState::Exited => return Err(HostError::StalePty),
            _ => {
                if let Some(session) = sessions.remove(&target.session_key) {
                    let _ = session.output.send(BackendOutput::Exited);
                }
            }
        }
        Ok(())
    }

    async fn attach(&self, target: &HostedSession) -> Result<BackendAttachment, HostError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(&target.session_key)
            .filter(|session| session.instance == target.pty.instance)
            .ok_or(HostError::StalePty)?;
        Ok(BackendAttachment {
            snapshot: crate::pty_manager::TerminalViewSnapshot {
                instance_id: session.instance.value(),
                watermark: session.sequence,
                data: String::new(),
                compatibility_data: base64::engine::general_purpose::STANDARD
                    .encode(&session.transcript),
                continuation_data: String::new(),
            },
            output: Box::new(MemoryOutput(session.output.subscribe())),
        })
    }

    async fn operate(&self, target: &HostedSession, action: &IoAction) -> Result<(), HostError> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(&target.session_key)
            .filter(|session| session.instance == target.pty.instance)
            .ok_or(HostError::StalePty)?;
        match action {
            IoAction::Resize { columns, rows } => {
                session.columns = *columns;
                session.rows = *rows;
            }
            IoAction::Write(data) => {
                session.input.extend(data);
                while let Some(end) = session.input.iter().position(|byte| *byte == b'\n') {
                    let line: Vec<_> = session.input.drain(..=end).collect();
                    let line = &line[..line.len() - 1];
                    let data = if line == b"size" {
                        format!("{} {}\r\n", session.rows, session.columns).into_bytes()
                    } else {
                        [b"host:", line, b"\r\n"].concat()
                    };
                    session.transcript.extend(&data);
                    session.sequence += 1;
                    let _ = session.output.send(BackendOutput::Output {
                        start_sequence: session.sequence,
                        sequence: session.sequence,
                        data,
                    });
                }
            }
        }
        Ok(())
    }
}

struct MemoryOutput(tokio::sync::broadcast::Receiver<BackendOutput>);
impl BackendOutputStream for MemoryOutput {
    fn recv(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendOutput> + Send + '_>> {
        Box::pin(async move {
            self.0
                .recv()
                .await
                .unwrap_or(BackendOutput::RecoveryRequired)
        })
    }
}
