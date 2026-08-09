use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Exclusive per-Task operations guarded by [`TaskClaims`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskOperation {
    StartImplementation,
    UpdateInitialPrompt,
    UpdateStatus,
    TerminalCompletion,
    HardDelete,
}

/// Registry of in-flight exclusive per-Task operations.
#[derive(Debug, Clone, Default)]
pub struct TaskClaims {
    active: Arc<Mutex<HashSet<(String, TaskOperation)>>>,
}

fn task_operations_conflict(active: TaskOperation, requested: TaskOperation) -> bool {
    active == requested
        || matches!(
            (active, requested),
            (TaskOperation::TerminalCompletion, _)
                | (_, TaskOperation::TerminalCompletion)
                | (TaskOperation::HardDelete, _)
                | (_, TaskOperation::HardDelete)
                | (
                    TaskOperation::StartImplementation,
                    TaskOperation::UpdateInitialPrompt
                )
                | (
                    TaskOperation::UpdateInitialPrompt,
                    TaskOperation::StartImplementation
                )
                | (
                    TaskOperation::StartImplementation,
                    TaskOperation::UpdateStatus
                )
                | (
                    TaskOperation::UpdateStatus,
                    TaskOperation::StartImplementation
                )
        )
}

pub struct TaskClaim {
    key: (String, TaskOperation),
    active: Arc<Mutex<HashSet<(String, TaskOperation)>>>,
}

impl TaskClaims {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn try_claim(&self, task_id: &str, operation: TaskOperation) -> Option<TaskClaim> {
        let mut active = self.active.lock().ok()?;
        if active.iter().any(|(active_task_id, active_operation)| {
            active_task_id == task_id && task_operations_conflict(*active_operation, operation)
        }) {
            return None;
        }
        let key = (task_id.to_string(), operation);
        active.insert(key.clone());
        Some(TaskClaim {
            key,
            active: Arc::clone(&self.active),
        })
    }
}

impl Drop for TaskClaim {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_completion_claim_conflicts_with_other_task_operations() {
        let claims = TaskClaims::new();
        let _completion = claims
            .try_claim("T-1", TaskOperation::TerminalCompletion)
            .expect("terminal completion claim");

        for operation in [
            TaskOperation::TerminalCompletion,
            TaskOperation::StartImplementation,
            TaskOperation::UpdateInitialPrompt,
            TaskOperation::UpdateStatus,
            TaskOperation::HardDelete,
        ] {
            assert!(claims.try_claim("T-1", operation).is_none());
        }
        assert!(claims
            .try_claim("T-2", TaskOperation::StartImplementation)
            .is_some());
    }
}
