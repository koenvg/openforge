//! Fixture image validation never blocks serving, but its worker never outlives ownership.
use super::images::{self, Image};
use openforge_session_protocol::Error;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
};

pub(super) struct Bootstrap {
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<Image, Error>>>,
}
impl Bootstrap {
    pub fn start(runtime: &Path) -> Result<Self, Error> {
        let runtime = runtime.to_path_buf();
        let cancelled = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let worker_cancelled = Arc::clone(&cancelled);
        let worker_finished = Arc::clone(&finished);
        let worker = std::thread::Builder::new()
            .name("image-bootstrap".into())
            .spawn(move || {
                let result = images::bootstrap(&runtime, &worker_cancelled);
                // Publish completion before notifying: the serving loop must not miss this wake.
                worker_finished.store(true, Ordering::Release);
                crate::wake::daemon().notify();
                result
            })
            .map_err(|_| Error::Capacity)?;
        Ok(Self {
            cancelled,
            finished,
            worker: Some(worker),
        })
    }
    pub fn poll(&mut self) -> Option<Result<Image, Error>> {
        if !self.finished.load(Ordering::Acquire) {
            return None;
        }
        let worker = self.worker.take()?;
        Some(worker.join().unwrap_or(Err(Error::UnsupportedReplacement)))
    }
}
impl Drop for Bootstrap {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            // Joining keeps launch/lifetime authority alive until the owned probe is reaped.
            if let Ok(Ok(image)) = worker.join() {
                let _ = std::fs::remove_file(image.path);
            }
        }
    }
}
