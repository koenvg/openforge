use crate::terminal_task_completion::{
    TerminalTaskCompletionError, TerminalTaskCompletionOutcome, TerminalTaskCompletionRequest,
    TerminalTaskCompletionService, TerminalTaskRuntime,
};
use std::{future::Future, pin::Pin};

pub(crate) type CompanionTaskActionFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<TerminalTaskCompletionOutcome, TerminalTaskCompletionError>>
            + Send
            + 'a,
    >,
>;

/// Task-scoped mutation boundary used by the authenticated Companion router.
///
/// The implementation delegates to the shared terminal Task completion service,
/// so Companion and desktop Delete/Complete actions retain one lifecycle owner.
pub(crate) trait CompanionTaskActionService: Send + Sync {
    fn complete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a>;
    fn delete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a>;
}

impl<R: TerminalTaskRuntime> CompanionTaskActionService for TerminalTaskCompletionService<R> {
    fn complete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        Box::pin(async move {
            self.complete(TerminalTaskCompletionRequest::complete(task_id))
                .await
        })
    }

    fn delete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        Box::pin(async move {
            self.complete(TerminalTaskCompletionRequest::delete(task_id))
                .await
        })
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionTaskActionService;

#[cfg(test)]
impl CompanionTaskActionService for UnavailableCompanionTaskActionService {
    fn complete<'a>(&'a self, _task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        Box::pin(async {
            Err(TerminalTaskCompletionError::Persistence(
                "Companion Task actions are unavailable".to_string(),
            ))
        })
    }

    fn delete<'a>(&'a self, _task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        Box::pin(async {
            Err(TerminalTaskCompletionError::Persistence(
                "Companion Task actions are unavailable".to_string(),
            ))
        })
    }
}
