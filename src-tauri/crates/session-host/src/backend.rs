use std::future::Future;

use super::*;

/// Private adapter boundary. Implementations own no domain policy; they launch prepared
/// commands and preserve the existing terminal authority and process cleanup behavior.
pub trait HostBackend: Send + Sync + Clone + 'static {
    fn inventory(&self) -> impl Future<Output = Result<Vec<BackendSession>, HostError>> + Send;
    fn set_terminal_color_profile(
        &self,
        profile: TerminalColorProfile,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
    fn spawn_prepared(
        &self,
        request: &SpawnRequest,
    ) -> impl Future<Output = Result<PtyInstanceId, HostError>> + Send;
    fn terminate_exact(
        &self,
        session: &HostedSession,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
    fn attach(
        &self,
        session: &HostedSession,
    ) -> impl Future<Output = Result<BackendAttachment, HostError>> + Send;
    fn operate(
        &self,
        session: &HostedSession,
        action: &IoAction,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
}

pub struct BackendSession {
    pub instance: PtyInstanceId,
    pub session_key: String,
    pub state: HostedSessionState,
}

pub struct BackendAttachment {
    pub snapshot: crate::TerminalViewSnapshot,
    pub output: Box<dyn BackendOutputStream>,
}

#[derive(Debug, Clone)]
pub enum BackendOutput {
    Output {
        start_sequence: u64,
        sequence: u64,
        data: Vec<u8>,
    },
    Exited,
    RecoveryRequired,
}

pub trait BackendOutputStream: Send {
    fn recv(&mut self) -> std::pin::Pin<Box<dyn Future<Output = BackendOutput> + Send + '_>>;
}
