//! Bounded PDF bytes, separate from metadata-only file previews.
mod project;
mod read_bytes;
mod secure_open;
pub(crate) use project::read_project_document;
mod task;
pub(crate) use task::read_task_document;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub(crate) const MAX_DOCUMENT_PREVIEW_BYTES: u64 = 16_777_216;
const READ_DEADLINE: Duration = Duration::from_secs(15);
const TIMEOUT: &str = "DOCUMENT_PREVIEW_TIMEOUT: document read timed out";
static READER: LazyLock<DocumentReader> = LazyLock::new(|| DocumentReader::new(READ_DEADLINE));

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum DocumentPreviewRead {
    Ready {
        mime_type: &'static str,
        encoding: &'static str,
        data: String,
        size: u64,
        revision: String,
        /// Unix milliseconds, matching existing filesystem modification timestamps.
        modified_at: Option<u64>,
    },
    Unavailable {
        reason: &'static str,
        size: u64,
        max_bytes: u64,
    },
}

/// Retain through workspace revalidation and response construction.
#[derive(Debug)]
pub(crate) struct DocumentResponse {
    pub(crate) document: DocumentPreviewRead,
    root: secure_open::RootGuard,
    _permit: OwnedSemaphorePermit,
}

impl DocumentResponse {
    pub(crate) fn verify_root(&self) -> Result<(), String> {
        self.root.verify()
    }
}

struct DocumentReader {
    admission: Arc<Semaphore>,
    deadline: Duration,
    #[cfg(test)]
    hook: Option<Arc<dyn Fn(ReadStage) + Send + Sync>>,
}

impl DocumentReader {
    fn new(deadline: Duration) -> Self {
        Self {
            admission: Arc::new(Semaphore::new(2)),
            deadline,
            #[cfg(test)]
            hook: None,
        }
    }

    async fn read(&self, root: PathBuf, path: String) -> Result<DocumentResponse, String> {
        let permit = Arc::clone(&self.admission)
            .try_acquire_owned()
            .map_err(|_| {
                "DOCUMENT_PREVIEW_BUSY: two document reads are already active".to_string()
            })?;
        let operation = Arc::new(Operation {
            cancelled: AtomicBool::new(false),
            deadline: Instant::now() + self.deadline,
            #[cfg(test)]
            hook: self.hook.clone(),
        });
        // Dropping the caller requests cancellation but never releases the I/O slot.
        let _cancel_on_drop = CancelOnDrop(Arc::clone(&operation));
        let work = tokio::task::spawn_blocking(move || {
            let (document, root) = read_bytes::read(&root, &path, &operation)?;
            operation.checkpoint()?;
            Ok(DocumentResponse {
                document,
                root,
                _permit: permit,
            })
        });
        tokio::time::timeout(self.deadline, work)
            .await
            .map_err(|_| TIMEOUT.to_string())?
            .map_err(|_| "DOCUMENT_PREVIEW_IO: document reader failed".to_string())?
    }

    #[cfg(test)]
    fn with_hook(mut self, hook: Arc<dyn Fn(ReadStage) + Send + Sync>) -> Self {
        self.hook = Some(hook);
        self
    }
}

struct Operation {
    cancelled: AtomicBool,
    deadline: Instant,
    #[cfg(test)]
    hook: Option<Arc<dyn Fn(ReadStage) + Send + Sync>>,
}

impl Operation {
    fn checkpoint(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) || Instant::now() >= self.deadline {
            return Err(TIMEOUT.into());
        }
        Ok(())
    }

    #[cfg(test)]
    fn observe(&self, stage: ReadStage) {
        if let Some(hook) = &self.hook {
            hook(stage);
        }
    }
}

struct CancelOnDrop(Arc<Operation>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancelled.store(true, Ordering::Release);
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadStage {
    BeforeRead,
    BeforeComponent(usize),
}

#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod race_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod workspace_tests;
