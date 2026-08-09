use crate::task_start::{TaskStartError, TaskStartOutcome, TaskStartRequest, TaskStartService};
use std::{future::Future, pin::Pin};

pub(crate) trait CompanionTaskStarter: Send + Sync {
    fn start<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<TaskStartOutcome, TaskStartError>> + Send + 'a>>;
}

impl CompanionTaskStarter for TaskStartService {
    fn start<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<TaskStartOutcome, TaskStartError>> + Send + 'a>> {
        Box::pin(async move {
            self.start(TaskStartRequest::safe(task_id))
                .await
                .map(|execution| execution.outcome)
        })
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionTaskStarter;

#[cfg(test)]
impl CompanionTaskStarter for UnavailableCompanionTaskStarter {
    fn start<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<TaskStartOutcome, TaskStartError>> + Send + 'a>> {
        Box::pin(async { Err(TaskStartError::RuntimeUnavailable) })
    }
}
