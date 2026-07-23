use std::path::Path;

use super::PtyError;

mod lifecycle;
mod provider_adapter;
mod spawn;

#[cfg(test)]
pub(super) use lifecycle::{frozen_seconds, PtySession, PtySessionKind, NEXT_INSTANCE_ID};
pub(super) use lifecycle::{AgentSpawnGenerations, LastOutputTimes, PtyOutputBuffers, PtySessions};

fn invalid_workspace_cwd(cwd: &Path, reason: impl ToString) -> PtyError {
    PtyError::InvalidWorkspaceCwd {
        path: cwd.display().to_string(),
        reason: reason.to_string(),
    }
}
