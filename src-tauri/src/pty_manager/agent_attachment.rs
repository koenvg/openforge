//! Consumer attachment facade. Neither adapter owns the underlying process.
use super::attachment::{
    AgentTerminalAttachmentError as Error, AgentTerminalEvent as Event,
    LocalAgentTerminalAttachment,
};
use super::{
    daemon_attachment::DaemonAgentAttachment, daemon_shells::DaemonShells,
    session::TerminalSessions,
};
use tokio::sync::broadcast;

pub(crate) struct AgentTerminalAttachment(Backend);
enum Backend {
    Local(LocalAgentTerminalAttachment),
    Daemon(Box<DaemonAgentAttachment>),
}

impl AgentTerminalAttachment {
    pub(super) fn new(
        task_id: String,
        instance_id: u64,
        replay: Vec<u8>,
        protocol_error_pending: bool,
        events: broadcast::Receiver<Event>,
        terminal_sessions: TerminalSessions,
    ) -> Self {
        Self(Backend::Local(LocalAgentTerminalAttachment::new(
            task_id,
            instance_id,
            replay,
            protocol_error_pending,
            events,
            terminal_sessions,
        )))
    }

    pub(super) async fn daemon(bridge: DaemonShells) -> Result<Self, Error> {
        Ok(Self(Backend::Daemon(Box::new(
            DaemonAgentAttachment::attach(bridge).await?,
        ))))
    }

    pub(crate) fn instance_id(&self) -> u64 {
        match &self.0 {
            Backend::Local(attachment) => attachment.instance_id(),
            Backend::Daemon(attachment) => attachment.instance_id(),
        }
    }

    pub(crate) fn has_protocol_error(&self) -> bool {
        match &self.0 {
            Backend::Local(attachment) => attachment.has_protocol_error(),
            Backend::Daemon(attachment) => attachment.has_protocol_error(),
        }
    }

    pub(crate) fn replay(&self) -> &[u8] {
        match &self.0 {
            Backend::Local(attachment) => attachment.replay(),
            Backend::Daemon(attachment) => attachment.replay(),
        }
    }

    pub(crate) async fn recv(&mut self) -> Result<Event, Error> {
        match &mut self.0 {
            Backend::Local(attachment) => attachment.recv().await,
            Backend::Daemon(attachment) => attachment.recv().await,
        }
    }

    pub(crate) async fn write_input(&self, input: &[u8]) -> Result<(), Error> {
        match &self.0 {
            Backend::Local(attachment) => attachment.write_input(input).await,
            Backend::Daemon(attachment) => attachment.write_input(input).await,
        }
    }

    pub(crate) async fn resize(&self, columns: u16, rows: u16) -> Result<(), Error> {
        match &self.0 {
            Backend::Local(attachment) => attachment.resize(columns, rows).await,
            Backend::Daemon(attachment) => attachment.resize(columns, rows).await,
        }
    }
}
