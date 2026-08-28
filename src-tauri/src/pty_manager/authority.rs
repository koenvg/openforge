#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParsedStateOwner {
    #[cfg(test)]
    Xterm,
    Ghostty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QueryResponseOwner {
    Xterm,
    Ghostty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReplayOwner {
    #[cfg(test)]
    PtyByteBuffer,
    GhosttySnapshot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SnapshotOwner {
    #[cfg(test)]
    None,
    Ghostty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalAuthorityContract {
    pub(crate) parsed_state_owner: ParsedStateOwner,
    pub(crate) query_response_owner: QueryResponseOwner,
    pub(crate) replay_owner: ReplayOwner,
    pub(crate) snapshot_owner: SnapshotOwner,
}

impl TerminalAuthorityContract {
    #[cfg(test)]
    pub(crate) const fn xterm_authoritative() -> Self {
        Self {
            parsed_state_owner: ParsedStateOwner::Xterm,
            query_response_owner: QueryResponseOwner::Xterm,
            replay_owner: ReplayOwner::PtyByteBuffer,
            snapshot_owner: SnapshotOwner::None,
        }
    }

    pub(crate) const fn ghostty_authoritative() -> Self {
        Self {
            parsed_state_owner: ParsedStateOwner::Ghostty,
            query_response_owner: QueryResponseOwner::Ghostty,
            replay_owner: ReplayOwner::GhosttySnapshot,
            snapshot_owner: SnapshotOwner::Ghostty,
        }
    }
}
