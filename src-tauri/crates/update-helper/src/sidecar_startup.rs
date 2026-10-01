//! Domain admission is tied to a recorded child, not a command-line flag.
use crate::{
    authorization, bundle, files, journal, process_identity::ProcessIdentity, InstallTransaction,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const SIDECAR_STARTUP_ARGUMENT: &str = "--openforge-update-startup";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SidecarAdmission {
    root: PathBuf,
    installation: String,
    operation: String,
    destination: PathBuf,
}

impl InstallTransaction {
    /// Register the authenticated target app's exact child before domain startup.
    /// caller_pid comes from the helper's kernel-observed parent, not its payload.
    /// # Errors
    /// Rejects foreign parents, stale operations, live competing children and changed bytes.
    pub fn register_sidecar(
        &mut self,
        operation: &str,
        caller_pid: u32,
        sidecar_pid: u32,
    ) -> Result<SidecarAdmission, String> {
        self.verify_launch(operation, caller_pid)?;
        let mut record = self.require(operation)?;
        if !record.phase.awaiting_commit() {
            return Err("sidecar admission requires an uncommitted launch".into());
        }
        let child = ProcessIdentity::child_of(sidecar_pid, caller_pid)?;
        if let Some(previous) = record.sidecar {
            if previous != child && previous.running()? {
                return Err("another admitted sidecar is still running".into());
            }
        }
        record.sidecar = Some(child);
        journal::write(&self.root, &record)?;
        Ok(SidecarAdmission {
            root: self.root.clone(),
            installation: self.installation.clone(),
            operation: operation.into(),
            destination: self.destination.clone(),
        })
    }
}

impl SidecarAdmission {
    /// Verify this process and its still-live parent without creating updater state.
    /// # Errors
    /// Rejects replay, wrong roots, unregistered processes and changed installed bytes.
    pub fn verify_current_process(&self) -> Result<(), String> {
        files::check_private_directory(&self.root)?;
        let record = journal::read(&self.root)?.ok_or("missing sidecar launch record")?;
        if record.installation != self.installation
            || record.operation != self.operation
            || record.destination != self.destination
            || !record.phase.awaiting_commit()
        {
            return Err("stale sidecar admission".into());
        }
        if !crate::startup::binding_matches(&self.root, &self.installation, &self.destination)? {
            return Err("sidecar admission belongs to another recovery root".into());
        }
        record
            .sidecar
            .ok_or("sidecar was not admitted")?
            .verify(std::process::id())?;
        // SAFETY: getppid has no memory arguments or side effects.
        let parent_pid = u32::try_from(unsafe { libc::getppid() }).map_err(message)?;
        record
            .launched
            .ok_or("missing authenticated target process")?
            .verify(parent_pid)?;
        let executable = std::env::current_exe()
            .map_err(message)?
            .canonicalize()
            .map_err(message)?;
        if executable
            != self
                .destination
                .join("Contents/MacOS/openforge-sidecar")
                .canonicalize()
                .map_err(message)?
        {
            return Err("sidecar is not running the authorized executable".into());
        }
        let authority = authorization::read(
            &record.authorization,
            &self.operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        let launch = authority
            .launch
            .as_ref()
            .ok_or("missing authorized launch context")?;
        launch.validate(&self.destination, &authority.bundle_path)?;
        for (key, expected) in [
            ("OPENFORGE_APP_DATA_DIR", &launch.app_data),
            ("OPENFORGE_SESSION_DAEMON_ROOT", &launch.daemon_root),
            (
                "OPENFORGE_ELECTRON_USER_DATA_DIR",
                &launch.electron_user_data,
            ),
        ] {
            let actual = std::env::var_os(key).ok_or("missing authorized sidecar data root")?;
            if PathBuf::from(actual).canonicalize().map_err(message)?
                != expected.canonicalize().map_err(message)?
            {
                return Err("sidecar data root does not match launch authority".into());
            }
        }
        if std::env::var("OPENFORGE_RESTART_OPERATION").as_deref() != Ok(self.operation.as_str()) {
            return Err("sidecar operation does not match launch authority".into());
        }
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("authorized sidecar bundle changed".into());
        }
        crate::native_image::verify(
            std::process::id(),
            &self.destination.join("Contents/MacOS/openforge-sidecar"),
        )?;
        if let Some(runtime) = &record.runtime {
            runtime.verify_running(&launch.daemon_root, &self.operation)?;
        }
        let current = journal::read(&self.root)?.ok_or("missing sidecar launch record")?;
        if current.operation != record.operation
            || current.phase != record.phase
            || current.sidecar != record.sidecar
            || current.launched != record.launched
        {
            return Err("sidecar admission changed during verification".into());
        }
        Ok(())
    }
}

/// Call before any Sidecar database, logger, keychain or domain initialization.
/// Ordinary startup returns false. Update startup requires an inherited pipe and
/// a durable authenticated record for this process, even if a caller supplies the flag.
/// # Errors
/// Refuses missing, malformed, oversized, expired or unauthenticated admission.
pub fn authorize_sidecar_startup() -> Result<bool, String> {
    if !std::env::args_os().any(|arg| arg == SIDECAR_STARTUP_ARGUMENT) {
        return Ok(false);
    }
    let admission: SidecarAdmission =
        serde_json::from_slice(&crate::startup::read_admission("sidecar")?)
            .map_err(|_| "invalid sidecar admission")?;
    admission.verify_current_process()?;
    Ok(true)
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
