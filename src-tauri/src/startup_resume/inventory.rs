use crate::{backend_runtime::AppHandle, pty_manager::PtyManager};
use std::collections::HashSet;

/// Retained exits suppress history recovery, but only live allocations protect
/// persisted running sessions from the final interruption sweep.
#[derive(Default)]
pub(super) struct RecoveryInventory {
    retained_tasks: HashSet<String>,
    live_tasks: Vec<(String, u64)>,
}

impl RecoveryInventory {
    pub(super) async fn load(app: &AppHandle) -> Result<Self, String> {
        let Some(manager) = app.try_state::<PtyManager>() else {
            return Ok(Self::default());
        };
        let Some(bridge) = manager.daemon_shells.as_ref() else {
            return Ok(Self::default());
        };
        let sessions = bridge
            .agent_sessions()
            .await
            .map_err(|error| format!("Agent inventory reconciliation failed: {error}"))?;
        let retained_tasks = sessions
            .iter()
            .map(|session| session.session_key.clone())
            .collect();
        let live_tasks = sessions
            .iter()
            .filter(|session| session.exit_code.is_none())
            .map(|session| (session.session_key.clone(), session.pty.instance.value()))
            .collect();
        Ok(Self {
            retained_tasks,
            live_tasks,
        })
    }

    pub(super) fn retains(&self, task_id: &str) -> bool {
        self.retained_tasks.contains(task_id)
    }

    pub(super) fn live_tasks(&self) -> Vec<(&str, u64)> {
        self.live_tasks
            .iter()
            .map(|(task, instance)| (task.as_str(), *instance))
            .collect()
    }
}
