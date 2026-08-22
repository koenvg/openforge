use std::path::Path;

use super::PtyError;

mod lifecycle;
mod provider_adapter;
mod spawn;

pub(super) use lifecycle::PtySessionKind;
#[cfg(test)]
pub(super) use lifecycle::{frozen_seconds, PtySession, NEXT_INSTANCE_ID};
pub(super) use lifecycle::{
    AgentSpawnGenerations, LastOutputTimes, LifecycleLockLease, LifecycleLockRegistry,
    PtyOutputBuffers, PtySessions,
};

fn invalid_workspace_cwd(cwd: &Path, reason: impl ToString) -> PtyError {
    PtyError::InvalidWorkspaceCwd {
        path: cwd.display().to_string(),
        reason: reason.to_string(),
    }
}
