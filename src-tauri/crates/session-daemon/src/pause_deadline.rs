//! One pre-exec pause budget. Slow owned-snapshot work never owns the pause guards.
use openforge_session_host::CapacityKind;
use openforge_session_protocol::Error;
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

const MAX_PAUSE: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub(crate) struct PauseDeadline {
    expires: Instant,
    workers: Arc<AtomicUsize>,
}
impl PauseDeadline {
    pub fn new(workers: Arc<AtomicUsize>) -> Self {
        let budget = MAX_PAUSE;
        #[cfg(feature = "replacement-fixtures")]
        let budget = std::env::var("OPENFORGE_TEST_CHECKPOINT_DEADLINE_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (1..10_000).contains(value))
            .map(Duration::from_millis)
            .unwrap_or(budget);
        Self {
            expires: Instant::now() + budget,
            workers,
        }
    }
    pub fn instant(&self) -> Instant {
        self.expires
    }
    pub fn remaining(&self) -> Result<Duration, Error> {
        let remaining = self.expires.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            Err(Self::expired())
        } else {
            Ok(remaining)
        }
    }
    pub fn check(&self) -> Result<(), Error> {
        self.remaining().map(|_| ())
    }
    pub fn expired() -> Error {
        Error::CapacityExceeded(CapacityKind::CheckpointTime)
    }

    // A timeout drops the receiver, not a scoped thread that must be joined. Workers
    // own only snapshots or read-only model requests, never serving locks or gates.
    // Admission stays closed to further replacement while abandoned work is alive.
    pub fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.check()?;
        let (tx, rx) = mpsc::channel();
        let activity = WorkerActivity(Arc::clone(&self.workers));
        activity.0.fetch_add(1, Ordering::AcqRel);
        std::thread::Builder::new()
            .name("paused-checkpoint".into())
            .spawn(move || {
                let result = work();
                let _ = tx.send(result); // Late results, including files, are dropped here.
                drop(activity);
            })
            .map_err(|_| Error::Capacity)?;
        let result = rx
            .recv_timeout(self.remaining()?)
            .map_err(|_| Self::expired())?;
        self.check()?;
        result
    }
    pub fn stage(&self, stage: &str) -> Result<(), Error> {
        #[cfg(feature = "replacement-fixtures")]
        std::thread::sleep(stage_delay(stage));
        let _ = stage;
        self.check()
    }
}
#[cfg(feature = "replacement-fixtures")]
pub(crate) fn stage_delay(stage: &str) -> Duration {
    std::env::var("OPENFORGE_TEST_REPLACEMENT_SLOW_STAGES")
        .ok()
        .and_then(|stages| {
            stages.split(',').find_map(|entry| {
                let (name, milliseconds) = entry.split_once(':')?;
                (name == stage)
                    .then(|| milliseconds.parse::<u64>().ok())
                    .flatten()
            })
        })
        .map(|milliseconds| Duration::from_millis(milliseconds.min(30_000)))
        .unwrap_or_default()
}
struct WorkerActivity(Arc<AtomicUsize>);
impl Drop for WorkerActivity {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
