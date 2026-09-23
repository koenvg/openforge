//! Companion presentation over the existing daemon controller, not a second PTY owner.
use super::attachment::{
    AgentTerminalAttachmentError as Error, AgentTerminalEvent as Event, CompanionOutputSanitizer,
};
use super::daemon_shells::DaemonShells;
use base64::Engine;
use openforge_session_host::{HostAttachment, HostOutput, PtyHost};

pub(super) struct DaemonAgentAttachment {
    bridge: DaemonShells,
    output: tokio::sync::Mutex<HostAttachment>,
    sanitizer: CompanionOutputSanitizer,
    replay: Vec<u8>,
    protocol_error: bool,
    exited: bool,
    instance_id: u64,
}

impl DaemonAgentAttachment {
    pub(super) async fn attach(bridge: DaemonShells) -> Result<Self, Error> {
        let (client, session) = bridge.session_client().await.map_err(|_| Error::Closed)?
            .filter(|(_, session)| session.exit_code.is_none()
                && matches!(&session.owner, openforge_session_protocol::TerminalOwner::Agent { task_id } if task_id == &session.session_key))
            .ok_or(Error::NoActiveAgentTerminal)?;
        let instance_id = session.pty.instance.value();
        let bridge = bridge
            .pin(session.pty.instance.value())
            .await
            .map_err(|_| Error::StaleAttachment)?;
        let output = client
            .attach_recover(client.controller(), &session.pty, None)
            .await
            .map_err(|_| Error::Closed)?;
        // Exit can be recorded while recovery is in flight, before its event cursor.
        // Revalidate after recovery so that exit is not lost behind the snapshot.
        if !bridge
            .session()
            .await
            .map_err(|_| Error::StaleAttachment)?
            .is_some_and(|current| current.exit_code.is_none())
        {
            return Err(Error::NoActiveAgentTerminal);
        }
        let encoding = base64::engine::general_purpose::STANDARD;
        let snapshot = encoding
            .decode(&output.snapshot.data)
            .map_err(|_| Error::Closed)?;
        let continuation = encoding
            .decode(&output.snapshot.continuation_data)
            .map_err(|_| Error::Closed)?;
        let mut sanitizer = CompanionOutputSanitizer::default();
        let replay = sanitizer.push(&snapshot).and_then(|mut replay| {
            replay.extend(sanitizer.push(&continuation)?);
            Ok(replay)
        });
        let protocol_error = replay.is_err();
        Ok(Self {
            instance_id,
            bridge,
            output: tokio::sync::Mutex::new(output),
            sanitizer,
            replay: replay.unwrap_or_default(),
            protocol_error,
            exited: false,
        })
    }

    pub(crate) fn instance_id(&self) -> u64 {
        self.instance_id
    }

    pub(super) fn has_protocol_error(&self) -> bool {
        self.protocol_error
    }
    pub(super) fn replay(&self) -> &[u8] {
        &self.replay
    }

    pub(super) async fn recv(&mut self) -> Result<Event, Error> {
        if self.protocol_error {
            return Ok(Event::ProtocolError);
        }
        if self.exited {
            return Ok(Event::Exited);
        }
        loop {
            let event = self
                .output
                .get_mut()
                .recv()
                .await
                .map_err(|_| Error::StaleAttachment)?;
            let filtered = match event {
                HostOutput::Output { data, .. } => self.sanitizer.push(&data),
                HostOutput::Exited { .. } => {
                    self.exited = true;
                    self.sanitizer.finish()
                }
                // Never expose a suffix after a gap. The existing Companion reconnect
                // obtains a fresh snapshot and attachment without spawning a process.
                HostOutput::RecoveryRequired => return Err(Error::SlowConsumer),
            };
            match filtered {
                Ok(bytes) if !bytes.is_empty() => return Ok(Event::Output(bytes)),
                Ok(_) if self.exited => return Ok(Event::Exited),
                Ok(_) => {}
                Err(_) => {
                    self.protocol_error = true;
                    return Ok(Event::ProtocolError);
                }
            }
        }
    }

    pub(super) async fn write_input(&self, input: &[u8]) -> Result<(), Error> {
        std::str::from_utf8(input).map_err(|_| Error::InvalidUtf8)?;
        self.bridge
            .write(input.to_vec(), self.bridge.publisher())
            .await
            .map_err(|_| Error::WriteFailed)
    }

    pub(super) async fn resize(&self, columns: u16, rows: u16) -> Result<(), Error> {
        if columns == 0 || rows == 0 {
            return Err(Error::InvalidDimensions);
        }
        self.bridge
            .resize(columns, rows, self.bridge.publisher())
            .await
            .map_err(|_| Error::ResizeFailed)
    }
}
