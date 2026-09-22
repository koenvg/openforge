//! Runtime ownership and pinned assets across an authorized app replacement.
use crate::authorization::Authorization;
use openforge_session_client::{
    releases::{ReleaseStore, StagedRelease},
    runtime::RuntimeDirectory,
    MaintenanceClient,
};
use openforge_session_protocol::{Controller, OperationId, ReplacementState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};

/// A missing socket is not proof that the installation has no live PTY owner.
/// Hold both launch and lifetime locks while preparing a cold replacement.
pub(crate) struct ColdRuntime {
    _launch: File,
    _owner: File,
}

impl ColdRuntime {
    pub fn reserve(root: &Path) -> Result<Self, String> {
        let runtime = RuntimeDirectory::open(root).map_err(message)?;
        let launch = runtime.claim_launch().map_err(message)?;
        let owner = runtime.claim().map_err(message)?;
        Ok(Self {
            _launch: launch,
            _owner: owner,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimePlan {
    pub controller: Controller,
    pub pid: u32,
    pub source_version: String,
    pub target_version: Option<String>,
    pub release_id: String,
    pub daemon_sha256: String,
}

impl RuntimePlan {
    pub fn verify_ready(
        &self,
        root: &Path,
        operation: &str,
        controller: Option<Controller>,
    ) -> Result<(), String> {
        let controller = controller.ok_or("missing replacement Sidecar controller")?;
        if controller.installation != self.controller.installation
            || controller.lifetime != self.controller.lifetime
            || controller.generation.value() <= self.controller.generation.value()
        {
            return Err(
                "replacement Sidecar did not reconcile the preserved daemon lifetime".into(),
            );
        }
        let client = MaintenanceClient::attach(root, controller).map_err(message)?;
        let capabilities = client.capabilities().map_err(message)?;
        let status = client.status(&operation_id(operation)?).map_err(message)?;
        let expected = self
            .target_version
            .as_ref()
            .ok_or("missing prepared runtime identity")?;
        if capabilities.pid != self.pid
            || &capabilities.image_version != expected
            || status.state != ReplacementState::Activated
            || status.from_version != self.source_version
            || status.target_version.as_ref() != Some(expected)
            || &status.actual_version != expected
        {
            return Err("running runtime does not match the authenticated update receipt".into());
        }
        Ok(())
    }
}

pub(crate) struct RuntimeUpdate {
    client: MaintenanceClient,
    store: ReleaseStore,
    release: StagedRelease,
    pub plan: RuntimePlan,
}

impl RuntimeUpdate {
    /// The caller authenticates the complete app grant before staging or running target code.
    pub fn stage(authority: &Authorization, controller: Controller) -> Result<Self, String> {
        let root = &authority
            .launch
            .as_ref()
            .ok_or("missing runtime root")?
            .daemon_root;
        let runtime = RuntimeDirectory::open_existing(root).map_err(message)?;
        let client = MaintenanceClient::attach(root, controller.clone()).map_err(message)?;
        let capabilities = client.capabilities().map_err(message)?;
        if !capabilities.supports_replacement {
            return Err("live daemon replacement is unsupported".into());
        }
        let store = ReleaseStore::open(&runtime).map_err(message)?;
        let release = store
            .stage(&authority.bundle_path.join("Contents/MacOS/session-runtime"))
            .map_err(message)?;
        let daemon_sha256 = digest(
            &authority
                .bundle_path
                .join("Contents/MacOS/openforge-session-daemon"),
        )?;
        if digest(&release.executable())? != daemon_sha256 {
            return Err("runtime daemon differs from the authorized app".into());
        }
        verify_cli(
            &authority
                .bundle_path
                .join("Contents/Resources/openforge-cli"),
            &release.directory().join("openforge-cli"),
        )?;
        // Conservative durable pins survive helper death. Existing session and fallback
        // pins remain intact; cleanup cannot remove releases while the daemon is alive.
        store
            .retain(&release, &format!("update-{}", authority.operation_id))
            .map_err(message)?;
        let plan = RuntimePlan {
            controller,
            pid: capabilities.pid,
            source_version: capabilities.image_version,
            target_version: None,
            release_id: release.id().into(),
            daemon_sha256,
        };
        Ok(Self {
            client,
            store,
            release,
            plan,
        })
    }

    /// Persist the intent plan before this call; target-version evidence follows only
    /// after the daemon independently verifies target bytes and executable identity.
    pub fn prepare(&mut self, operation: &str) -> Result<(), String> {
        let status = self
            .client
            .prepare(operation_id(operation)?, &self.release.executable())
            .map_err(message)?;
        if status.state != ReplacementState::Prepared
            || status.from_version != self.plan.source_version
            || status.actual_version != self.plan.source_version
        {
            return Err("running daemon changed during update preflight".into());
        }
        self.plan.target_version = Some(
            status
                .target_version
                .ok_or("missing prepared runtime identity")?,
        );
        Ok(())
    }

    pub fn cancel(&self, operation: &str) -> Result<(), String> {
        let operation = operation_id(operation)?;
        match self.client.status(&operation) {
            Ok(status)
                if matches!(
                    status.state,
                    ReplacementState::Aborted | ReplacementState::Failed { .. }
                ) =>
            {
                Ok(())
            }
            Ok(_) => self.client.abort(operation).map_err(message),
            Err(error) => Err(message(error)),
        }
    }

    pub fn activate(&self, operation: &str) -> Result<(), String> {
        let verified = self
            .store
            .stage(self.release.directory())
            .map_err(message)?;
        if verified.id() != self.plan.release_id
            || digest(&verified.executable())? != self.plan.daemon_sha256
        {
            return Err("pinned runtime changed before activation".into());
        }
        let expected = self
            .plan
            .target_version
            .as_ref()
            .ok_or("runtime was not prepared")?;
        let status = self
            .client
            .activate(operation_id(operation)?)
            .map_err(message)?;
        if status.state != ReplacementState::Activated
            || &status.actual_version != expected
            || status.target_version.as_ref() != Some(expected)
        {
            return Err("runtime activation did not confirm the prepared image".into());
        }
        self.store
            .retain(&self.release, &format!("session-{}", self.release.id()))
            .map_err(message)
    }
}

fn operation_id(value: &str) -> Result<OperationId, String> {
    OperationId::parse(value).map_err(message)
}

fn verify_cli(source: &Path, retained: &Path) -> Result<(), String> {
    let names = |root: &Path| -> Result<BTreeSet<std::ffi::OsString>, String> {
        std::fs::read_dir(root)
            .map_err(message)?
            .map(|entry| {
                let entry = entry.map_err(message)?;
                if !entry.file_type().map_err(message)?.is_file() {
                    return Err("unsupported CLI asset".into());
                }
                Ok(entry.file_name())
            })
            .collect()
    };
    let source_names = names(source)?;
    if source_names != names(retained)? {
        return Err("pinned CLI asset inventory differs from the authorized app".into());
    }
    for name in source_names {
        if digest(&source.join(&name))? != digest(&retained.join(name))? {
            return Err("pinned CLI asset changed".into());
        }
    }
    Ok(())
}

fn digest(path: &Path) -> Result<String, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(message)?;
    let metadata = file.metadata().map_err(message)?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.mode() & 0o7022 != 0 {
        return Err("unsafe runtime artifact".into());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0;
    loop {
        let count = file.read(&mut buffer).map_err(message)?;
        if count == 0 {
            break;
        }
        total += count;
        if total > 128 * 1024 * 1024 {
            return Err("runtime artifact exceeds size limit".into());
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
