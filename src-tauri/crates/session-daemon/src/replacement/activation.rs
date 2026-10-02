//! Owns the paused checkpoint and descriptors through an in-place exec attempt.
use super::{checkpoint, descriptors, images, Job, Resources};
use crate::host::{Host, HostPause};
use crate::pause_deadline::PauseDeadline;
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_host::CapacityKind;
use openforge_session_protocol::{Error, OperationId};
use std::{
    fs::File,
    os::{fd::AsRawFd, unix::process::CommandExt},
    sync::{atomic::AtomicUsize, Arc},
    time::{Duration, Instant},
};

pub(crate) struct Activation {
    file: File,
    retained: Vec<i32>,
    image: images::Image,
    operation: OperationId,
    checkpoint_bytes: usize,
    deadline: PauseDeadline,
    paused_at: Instant,
    _spare_descriptors: Vec<File>,
    _pause: HostPause,
}

impl Activation {
    pub(super) fn capture(
        host: &Host,
        runtime: &RuntimeDirectory,
        resources: &Resources,
        current: &images::Image,
        jobs: &[Job],
        operation: OperationId,
        pause_workers: Arc<AtomicUsize>,
    ) -> Result<Self, Error> {
        host.backend.preflight_checkpoint()?;
        let paused_at = Instant::now();
        let deadline = PauseDeadline::new(pause_workers);
        let (host, pause) = host.checkpoint(&deadline)?;
        // Reserve initialization headroom while refusal can still reopen the old owner.
        // Exec closes these CLOEXEC descriptors before rebuilding reader/writer/runtime wrappers.
        let spare = File::open("/dev/null")
            .map_err(|_| Error::CapacityExceeded(CapacityKind::FileDescriptors))?;
        let mut spare_descriptors = Vec::new();
        for _ in 0..crate::backend::RESTORE_FD_RESERVE {
            spare_descriptors.push(
                spare
                    .try_clone()
                    .map_err(|_| Error::CapacityExceeded(CapacityKind::FileDescriptors))?,
            );
        }
        let manager = checkpoint::Snapshot {
            current: current.clone(),
            jobs: jobs.to_vec(),
        };
        let root = runtime
            .path()
            .parent()
            .ok_or(Error::InvalidRequest)?
            .to_path_buf();
        let credentials = runtime.credentials().clone();
        let roots = descriptors::Roots::capture(resources)?;
        let port = resources
            .agent
            .local_addr()
            .map_err(|_| Error::RecoveryUnavailable)?
            .port();
        let directory = runtime.path().to_path_buf();
        let worker_operation = operation.clone();
        let worker_deadline = deadline.clone();
        let (file, checkpoint_bytes, image, mut retained) = deadline.run(move || {
            worker_deadline.stage("header")?;
            let runtime = RuntimeDirectory::reopen(&root, &credentials)?;
            let header = checkpoint::Header::capture(
                &runtime,
                roots,
                port,
                &host,
                &manager,
                worker_operation,
            )?;
            host.verify_credentials(&header.agent_runtime, &worker_deadline)?;
            let image = header.target.clone();
            let recovery = header.recovery.clone();
            let retained = header.descriptors();
            worker_deadline.stage("encode")?;
            let bytes = checkpoint::encode(header, &checkpoint::Body { host, manager })?;
            images::verify_paused(&image, &bytes, &worker_deadline, "target-probe")?;
            images::verify_paused(&recovery, &bytes, &worker_deadline, "recovery-probe")?;
            let file = checkpoint::create(&directory, &bytes, &worker_deadline)?;
            worker_deadline.check()?;
            Ok((file, bytes.len(), image, retained))
        })?;
        retained.push(file.as_raw_fd());
        descriptors::validate_list(&retained)?;
        Ok(Self {
            file,
            retained,
            image,
            operation,
            checkpoint_bytes,
            deadline,
            paused_at,
            _spare_descriptors: spare_descriptors,
            _pause: pause,
        })
    }

    pub(super) fn operation(&self) -> &OperationId {
        &self.operation
    }

    pub fn reply_budget(&self) -> Result<Duration, Error> {
        self.deadline.remaining()
    }

    /// Returns only on failure, with descriptor flags rolled back. The coordinator
    /// releases this owner before image cleanup so old I/O resumes within the budget.
    pub(super) fn execute(&self) -> Error {
        #[cfg(feature = "replacement-fixtures")]
        if !crate::pause_deadline::stage_delay("pre-exec").is_zero() {
            let deadline = self.deadline.clone();
            if let Err(error) = self.deadline.run(move || deadline.stage("pre-exec")) {
                return error;
            }
        }
        if let Err(error) = self.deadline.check() {
            return error;
        }
        let _inheritance = match descriptors::Inheritance::prepare(&self.retained) {
            Ok(inheritance) => inheritance,
            Err(error) => return error,
        };
        #[cfg(feature = "replacement-fixtures")]
        if self
            .image
            .version
            .contains("/openforge-session-daemon-fixture-exec-fails@")
        {
            use std::os::unix::fs::PermissionsExt;
            if std::fs::set_permissions(&self.image.path, std::fs::Permissions::from_mode(0o400))
                .is_err()
            {
                return Error::RecoveryUnavailable;
            }
        }
        eprintln!(
            "session handoff metrics: {},{},{}",
            self.checkpoint_bytes,
            self.retained.len(),
            self.paused_at.elapsed().as_millis()
        );
        if let Err(error) = self.deadline.check() {
            return error;
        }
        let error = std::process::Command::new(&self.image.path)
            .arg("--resume")
            .arg(self.file.as_raw_fd().to_string())
            .env_clear()
            .exec();
        Error::Transport(error.to_string())
    }
}
