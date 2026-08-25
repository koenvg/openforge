#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParsedStateOwner {
    Xterm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QueryResponseOwner {
    Xterm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReplayOwner {
    PtyByteBuffer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SnapshotOwner {
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DiagnosticModelCapabilities {
    pub(crate) may_observe_pty_bytes: bool,
    pub(crate) may_send_query_responses: bool,
    pub(crate) may_provide_replay: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalAuthorityContract {
    pub(crate) parsed_state_owner: ParsedStateOwner,
    pub(crate) query_response_owner: QueryResponseOwner,
    pub(crate) replay_owner: ReplayOwner,
    pub(crate) snapshot_owner: SnapshotOwner,
    pub(crate) diagnostic_model: DiagnosticModelCapabilities,
}

impl TerminalAuthorityContract {
    pub(crate) const fn xterm_authoritative() -> Self {
        Self {
            parsed_state_owner: ParsedStateOwner::Xterm,
            query_response_owner: QueryResponseOwner::Xterm,
            replay_owner: ReplayOwner::PtyByteBuffer,
            snapshot_owner: SnapshotOwner::None,
            diagnostic_model: DiagnosticModelCapabilities {
                may_observe_pty_bytes: true,
                may_send_query_responses: false,
                may_provide_replay: false,
            },
        }
    }
}
