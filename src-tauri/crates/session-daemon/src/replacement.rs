//! Single-owner image replacement. Preparation serves concurrently; commit alone quiesces.
mod activation;
mod bootstrap;
mod checkpoint;
mod descriptors;
#[cfg(feature = "replacement-fixtures")]
mod fixture_startup;
mod images;
mod probe;
mod resume;
#[cfg(test)]
mod tests;
mod version;
use crate::host::Host;
use crate::pause_deadline::PauseDeadline;
pub(crate) use activation::Activation;
use checkpoint::Snapshot;
pub(crate) use descriptors::Resources;
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_protocol::*;
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const IMAGE_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "/", env!("CARGO_BIN_NAME"));
const STATE_FORMAT: u32 = 1;
const MAX_JOBS: usize = 32;
// Preparation probes both the current image and the new copy. Account for
// their separately bounded loader startup; each responsive helper retains
// its own unchanged execution deadline.
#[cfg(target_os = "macos")]
fn preparation_timeout() -> Duration {
    Duration::from_secs(10) + probe::MAX_STARTUP_WAIT * 2
}
#[cfg(not(target_os = "macos"))]
fn preparation_timeout() -> Duration {
    Duration::from_secs(10)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Job {
    operation: OperationId,
    requested: PathBuf,
    source_version: String,
    actual_version: String,
    target: Option<images::Image>,
    state: ReplacementState,
}
struct Pending {
    index: usize,
    started: Instant,
    finished: Arc<AtomicBool>,
    worker: std::thread::JoinHandle<Result<images::Image, Error>>,
}
pub(crate) struct Manager {
    current: Option<images::Image>,
    bootstrap: Option<bootstrap::Bootstrap>,
    running_version: String,
    jobs: Vec<Job>,
    pending: Option<Pending>,
    directory: PathBuf,
    pause_workers: Arc<AtomicUsize>,
}
pub(crate) struct Dispatch {
    pub response: Response,
    pub activation: Option<Activation>,
}
impl Manager {
    pub fn new(runtime: &RuntimeDirectory) -> Self {
        // Production activation stays disabled. Only explicit fixtures bootstrap an image.
        let bootstrap = if cfg!(all(
            target_os = "macos",
            target_arch = "aarch64",
            feature = "replacement-fixtures"
        )) {
            match bootstrap::Bootstrap::start(runtime.path()) {
                Ok(worker) => Some(worker),
                Err(_) => {
                    eprintln!(
                        "live replacement unavailable; ordinary session serving remains enabled"
                    );
                    None
                }
            }
        } else {
            None
        };
        Self {
            current: None,
            bootstrap,
            running_version: version::current().unwrap_or_else(|_| IMAGE_VERSION.into()),
            jobs: Vec::new(),
            pending: None,
            pause_workers: Arc::new(AtomicUsize::new(0)),
            directory: runtime.path().join("images"),
        }
    }
    pub fn poll(&mut self) {
        if let Some(result) = self.bootstrap.as_mut().and_then(bootstrap::Bootstrap::poll) {
            match result {
                Ok(image) => self.current = Some(image),
                Err(_) => eprintln!(
                    "live replacement unavailable; ordinary session serving remains enabled"
                ),
            }
            self.bootstrap = None;
        }
        let Some(pending) = &self.pending else {
            return;
        };
        if !pending.finished.load(Ordering::Acquire) {
            if pending.started.elapsed() > preparation_timeout()
                && self.jobs[pending.index].state == ReplacementState::Preparing
            {
                self.jobs[pending.index].state = ReplacementState::Failed {
                    stage: ReplacementStage::Preflight,
                };
            }
            return;
        }
        let pending = self.pending.take().expect("pending worker was observed");
        let result = pending.worker.join();
        let job = &mut self.jobs[pending.index];
        match result {
            Ok(Ok(image)) if job.state == ReplacementState::Preparing => {
                job.target = Some(image);
                job.state = ReplacementState::Prepared;
            }
            _ => {
                if job.state == ReplacementState::Preparing {
                    job.state = ReplacementState::Failed {
                        stage: ReplacementStage::Preflight,
                    };
                }
                self.clean();
            }
        }
    }
    pub fn next_deadline(&self) -> Option<Instant> {
        let pending = self.pending.as_ref()?;
        (self.jobs[pending.index].state == ReplacementState::Preparing)
            .then(|| pending.started + preparation_timeout())
    }
    fn busy(&self) -> bool {
        self.pending.is_some()
            || self.pause_workers.load(Ordering::Acquire) != 0
            || self.jobs.iter().any(|job| {
                matches!(
                    job.state,
                    ReplacementState::Preparing
                        | ReplacementState::Prepared
                        | ReplacementState::Executing
                )
            })
    }
    fn clean(&self) {
        if let Some(current) = &self.current {
            if images::clean(&self.directory, &[&current.path]).is_err() {
                eprintln!("retained image cleanup deferred; further preparation will refuse until cleanup succeeds");
            }
        }
    }
    fn status(&self, operation: &OperationId) -> Result<ReplacementStatus, Error> {
        let job = self
            .jobs
            .iter()
            .find(|job| &job.operation == operation)
            .ok_or(Error::InvalidRequest)?;
        Ok(ReplacementStatus {
            operation: job.operation.clone(),
            state: job.state.clone(),
            from_version: job.source_version.clone(),
            target_version: job.target.as_ref().map(|image| image.version.clone()),
            actual_version: job.actual_version.clone(),
        })
    }
    fn fail(&mut self, operation: &OperationId, stage: ReplacementStage) {
        if let Some(job) = self.jobs.iter_mut().find(|job| &job.operation == operation) {
            job.state = ReplacementState::Failed { stage };
        }
        self.clean();
    }
    pub fn dispatch(
        &mut self,
        host: &mut Host,
        runtime: &RuntimeDirectory,
        resources: &Resources,
        command: Command,
    ) -> Result<Dispatch, Error> {
        let mut activation = None;
        let response = match command {
            Command::Capabilities => Response::Capabilities(Capabilities {
                supports_replacement: self.current.is_some(),
                image_version: self.running_version.clone(),
                pid: std::process::id(),
            }),
            Command::ReplacementStatus { operation } => {
                Response::Replacement(self.status(&operation)?)
            }
            Command::Replacement {
                controller,
                operation,
                phase,
            } => {
                host.validate_replacement_controller(&controller)?;
                if self.current.is_none() {
                    return Err(Error::UnsupportedReplacement);
                }
                match phase {
                    ReplacementPhase::Prepare { executable } => {
                        self.prepare(operation.clone(), executable)?
                    }
                    ReplacementPhase::Abort => self.abort(&operation)?,
                    ReplacementPhase::Commit => {
                        let state = self.status(&operation)?.state;
                        if state == ReplacementState::Prepared {
                            self.jobs
                                .iter_mut()
                                .find(|job| job.operation == operation)
                                .ok_or(Error::InvalidRequest)?
                                .state = ReplacementState::Executing;
                            match Activation::capture(
                                host,
                                runtime,
                                resources,
                                self.current.as_ref().ok_or(Error::UnsupportedReplacement)?,
                                &self.jobs,
                                operation.clone(),
                                Arc::clone(&self.pause_workers),
                            ) {
                                Ok(prepared) => activation = Some(prepared),
                                Err(Error::CapacityExceeded(kind)) => {
                                    eprintln!("session checkpoint capacity refused: {kind}");
                                    self.fail(&operation, ReplacementStage::Checkpoint);
                                }
                                Err(_) => self.fail(&operation, ReplacementStage::Checkpoint),
                            }
                        } else if matches!(state, ReplacementState::Preparing) {
                            return Err(Error::Capacity);
                        }
                    }
                }
                Response::Replacement(self.status(&operation)?)
            }
            Command::ShutdownEmpty { .. } if self.busy() => return Err(Error::Capacity),
            command => host.handle(command)?,
        };
        Ok(Dispatch {
            response,
            activation,
        })
    }
    fn prepare(&mut self, operation: OperationId, executable: PathBuf) -> Result<(), Error> {
        if let Some(job) = self.jobs.iter().find(|job| job.operation == operation) {
            return if job.requested == executable {
                Ok(())
            } else {
                Err(Error::OperationConflict)
            };
        }
        if !executable.is_absolute() || executable.as_os_str().len() > 4096 {
            return Err(Error::InvalidRequest);
        }
        if self.busy() || self.jobs.len() >= MAX_JOBS {
            return Err(Error::Capacity);
        }
        let current = self.current.clone().ok_or(Error::UnsupportedReplacement)?;
        let directory = self.directory.clone();
        let requested = executable.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let worker_finished = Arc::clone(&finished);
        let worker = std::thread::Builder::new()
            .name("image-preflight".into())
            .spawn(move || {
                let result = images::prepare(&directory, &current, &requested);
                worker_finished.store(true, Ordering::Release);
                crate::wake::daemon().notify();
                result
            })
            .map_err(|_| Error::Capacity)?;
        let index = self.jobs.len();
        self.jobs.push(Job {
            operation,
            requested: executable,
            source_version: self.running_version.clone(),
            actual_version: self.running_version.clone(),
            target: None,
            state: ReplacementState::Preparing,
        });
        self.pending = Some(Pending {
            index,
            finished,
            worker,
            started: Instant::now(),
        });
        Ok(())
    }
    fn abort(&mut self, operation: &OperationId) -> Result<(), Error> {
        let job = self
            .jobs
            .iter_mut()
            .find(|job| &job.operation == operation)
            .ok_or(Error::InvalidRequest)?;
        match job.state {
            ReplacementState::Preparing | ReplacementState::Prepared => {
                job.state = ReplacementState::Aborted
            }
            ReplacementState::Executing | ReplacementState::Activated => {
                return Err(Error::OperationConflict)
            }
            _ => {}
        }
        if self.pending.is_none() {
            self.clean();
        }
        Ok(())
    }
    pub fn execute(&mut self, activation: Activation) {
        let error = activation.execute();
        let stage = if error == PauseDeadline::expired() {
            ReplacementStage::Checkpoint
        } else {
            ReplacementStage::Exec
        };
        let operation = activation.operation().clone();
        // Inheritance rollback has finished. Reopen old I/O before filesystem cleanup.
        drop(activation);
        self.fail(&operation, stage);
    }
    fn restored(
        snapshot: Snapshot,
        operation: &OperationId,
        recovery: bool,
        directory: PathBuf,
    ) -> Result<Self, Error> {
        snapshot.validate(operation, &directory)?;
        let current = if recovery {
            snapshot.current.clone()
        } else {
            snapshot.target(operation)?.clone()
        };
        let mut manager = Self {
            current: Some(current),
            bootstrap: None,
            running_version: version::current()?,
            jobs: snapshot.jobs,
            pending: None,
            directory,
            pause_workers: Arc::new(AtomicUsize::new(0)),
        };
        let job = manager
            .jobs
            .iter_mut()
            .find(|job| &job.operation == operation)
            .ok_or(Error::InvalidRequest)?;
        job.state = if recovery {
            ReplacementState::Failed {
                stage: ReplacementStage::Initialization,
            }
        } else {
            ReplacementState::Activated
        };
        job.actual_version.clone_from(&manager.running_version);
        Ok(manager)
    }
}
pub(crate) fn run() -> Result<(), Error> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.first().and_then(|argument| argument.to_str()) {
        Some(mode @ ("--terminate-sessions" | "--recovery-status"))
            if args.len() == 2 || args.len() == 4 =>
        {
            let expected = if args.len() == 4 {
                Some((
                    args[2].to_str().ok_or(Error::InvalidRequest)?,
                    args[3].to_str().ok_or(Error::InvalidRequest)?,
                ))
            } else {
                None
            };
            crate::recovery_cli::run(
                std::path::Path::new(&args[1]),
                expected,
                mode == "--terminate-sessions",
            )
        }
        Some("--check-image") if args.len() == 1 => probe::describe(None),
        Some("--check-state") if args.len() == 1 => {
            #[cfg(feature = "replacement-fixtures")]
            if let Ok(milliseconds) = std::env::var("OPENFORGE_TEST_STATE_PROBE_DELAY_MS") {
                if let Ok(milliseconds) = milliseconds.parse::<u64>() {
                    std::thread::sleep(Duration::from_millis(milliseconds.min(30_000)));
                }
            }
            let mut bytes = Vec::new();
            std::io::stdin()
                .take(checkpoint::MAX_FILE as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| Error::RecoveryUnavailable)?;
            let (header, start) = checkpoint::header(&bytes)?;
            let body = checkpoint::body(&header, &bytes, start)?;
            header.validate_state(&body)?;
            probe::describe(Some(&bytes))
        }
        Some("--resume") if args.len() == 2 || (args.len() == 3 && args[2] == "recovery") => {
            let fd = args[1]
                .to_str()
                .and_then(|value| value.parse().ok())
                .ok_or(Error::InvalidRequest)?;
            resume::run(fd, args.len() == 3)
        }
        _ => crate::server::run(),
    }
}
