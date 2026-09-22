//! Single-owner image replacement. Preparation serves concurrently; commit alone quiesces.
mod checkpoint;
mod descriptors;
mod images;
mod probe;
mod resume;
#[cfg(test)]
mod tests;
mod version;
use crate::host::{Host, HostPause};
pub(crate) use descriptors::Resources;
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_protocol::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::File,
    io::Read,
    os::{fd::AsRawFd, unix::process::CommandExt},
    path::{Path, PathBuf},
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
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    current: images::Image,
    jobs: Vec<Job>,
}
impl Snapshot {
    fn target(&self, operation: &OperationId) -> Result<&images::Image, Error> {
        self.jobs
            .iter()
            .find(|job| &job.operation == operation && job.state == ReplacementState::Executing)
            .and_then(|job| job.target.as_ref())
            .ok_or(Error::InvalidRequest)
    }
    fn validate(&self, operation: &OperationId, directory: &Path) -> Result<(), Error> {
        if self.jobs.len() > MAX_JOBS {
            return Err(Error::Capacity);
        }
        image_shape(&self.current, directory)?;
        let mut ids = BTreeSet::new();
        let mut active = 0;
        for job in &self.jobs {
            if !ids.insert(job.operation.as_str())
                || !job.requested.is_absolute()
                || job.requested.as_os_str().len() > 4096
                || job.source_version.is_empty()
                || job.source_version.len() > 256
            {
                return Err(Error::InvalidRequest);
            }
            if let Some(image) = &job.target {
                image_shape(image, directory)?;
            }
            let actual = if job.state == ReplacementState::Activated {
                &job.target.as_ref().ok_or(Error::InvalidRequest)?.version
            } else {
                &job.source_version
            };
            if &job.actual_version != actual {
                return Err(Error::InvalidRequest);
            }
            match job.state {
                ReplacementState::Preparing | ReplacementState::Prepared => {
                    return Err(Error::InvalidRequest)
                }
                ReplacementState::Executing => {
                    active += 1;
                    if &job.operation != operation || job.target.is_none() {
                        return Err(Error::InvalidRequest);
                    }
                }
                _ => {}
            }
        }
        if active != 1 {
            return Err(Error::InvalidRequest);
        }
        Ok(())
    }
}
fn image_shape(image: &images::Image, directory: &Path) -> Result<(), Error> {
    if image.path.parent() != Some(directory)
        || image.version.is_empty()
        || image.version.len() > 256
        || image.sha256.len() != 64
        || !image.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(Error::InvalidRequest);
    }
    Ok(())
}
struct Pending {
    index: usize,
    started: Instant,
    worker: std::thread::JoinHandle<Result<images::Image, Error>>,
}
pub(crate) struct Manager {
    current: Option<images::Image>,
    running_version: String,
    jobs: Vec<Job>,
    pending: Option<Pending>,
    directory: PathBuf,
}
pub(crate) struct Dispatch {
    pub response: Response,
    pub activation: Option<Activation>,
}
pub(crate) struct Activation {
    file: File,
    retained: Vec<i32>,
    image: images::Image,
    operation: OperationId,
    _spare_descriptors: Vec<File>,
    _pause: HostPause,
}
impl Manager {
    pub fn new(runtime: &RuntimeDirectory) -> Self {
        // Keep ordinary production activation disabled until the live safety gates pass.
        let current = if cfg!(all(
            target_os = "macos",
            target_arch = "aarch64",
            feature = "replacement-fixtures"
        )) {
            match images::bootstrap(runtime.path()) {
                Ok(image) => Some(image),
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
            current,
            running_version: version::current().unwrap_or_else(|_| IMAGE_VERSION.into()),
            jobs: Vec::new(),
            pending: None,
            directory: runtime.path().join("images"),
        }
    }
    pub fn poll(&mut self) {
        let Some(pending) = &self.pending else {
            return;
        };
        if !pending.worker.is_finished() {
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
    fn busy(&self) -> bool {
        self.pending.is_some()
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
                            match self.capture(host, runtime, resources, operation.clone()) {
                                Ok(prepared) => activation = Some(prepared),
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
        let worker = std::thread::Builder::new()
            .name("image-preflight".into())
            .spawn(move || images::prepare(&directory, &current, &requested))
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
    fn capture(
        &self,
        host: &Host,
        runtime: &RuntimeDirectory,
        resources: &Resources,
        operation: OperationId,
    ) -> Result<Activation, Error> {
        let (host, pause) = host.checkpoint()?;
        // Reserve initialization headroom while refusal can still reopen the old owner.
        // Exec closes these CLOEXEC descriptors before rebuilding reader/writer/runtime wrappers.
        let spare = File::open("/dev/null").map_err(|_| Error::Capacity)?;
        let mut spare_descriptors = Vec::new();
        for _ in 0..64 {
            spare_descriptors.push(spare.try_clone().map_err(|_| Error::Capacity)?);
        }
        let manager = Snapshot {
            current: self.current.clone().ok_or(Error::UnsupportedReplacement)?,
            jobs: self.jobs.clone(),
        };
        let header =
            checkpoint::Header::capture(runtime, resources, &host, &manager, operation.clone())?;
        let image = header.target.clone();
        let recovery = header.recovery.clone();
        let mut retained = header.descriptors();
        let bytes = checkpoint::encode(header, &checkpoint::Body { host, manager })?;
        images::verify(&image, Some(&bytes))?;
        images::verify(&recovery, Some(&bytes))?;
        let file = checkpoint::create(runtime.path(), &bytes)?;
        retained.push(file.as_raw_fd());
        descriptors::validate_list(&retained)?;
        Ok(Activation {
            file,
            retained,
            image,
            operation,
            _spare_descriptors: spare_descriptors,
            _pause: pause,
        })
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
            running_version: version::current()?,
            jobs: snapshot.jobs,
            pending: None,
            directory,
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
impl Activation {
    pub fn execute(self, manager: &mut Manager) {
        let result = (|| {
            let _inheritance = descriptors::Inheritance::prepare(&self.retained)?;
            #[cfg(feature = "replacement-fixtures")]
            if self
                .image
                .version
                .contains("/openforge-session-daemon-fixture-exec-fails@")
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&self.image.path, std::fs::Permissions::from_mode(0o400))
                    .map_err(|_| Error::RecoveryUnavailable)?;
            }
            let error = std::process::Command::new(&self.image.path)
                .arg("--resume")
                .arg(self.file.as_raw_fd().to_string())
                .env_clear()
                .exec();
            Err::<(), Error>(Error::Transport(error.to_string()))
        })();
        if result.is_err() {
            manager.fail(&self.operation, ReplacementStage::Exec);
        }
        // On failed exec, flag rollback precedes dropping the checkpoint and reopening gates.
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
