//! Domain admission is tied to a recorded child, not a command-line flag.
use crate::{
    authorization, bundle, files, journal, process_identity::ProcessIdentity, InstallTransaction,
    Phase,
};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::PathBuf, time::Duration};

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
        if record.phase != Phase::LaunchStarted {
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
            || record.phase != Phase::LaunchStarted
        {
            return Err("stale sidecar admission".into());
        }
        let parent = self
            .destination
            .parent()
            .ok_or("missing installation parent")?;
        let name = self
            .destination
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("invalid installation name")?;
        let binding = files::read_private(
            &parent.join(format!(".{name}.openforge-update.lock")),
            16 * 1024,
        )?;
        let expected = serde_json::to_vec(&(
            self.root.canonicalize().map_err(message)?,
            &self.installation,
        ))
        .map_err(message)?;
        if binding != expected {
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
        serde_json::from_slice(&read_admission()?).map_err(|_| "invalid sidecar admission")?;
    admission.verify_current_process()?;
    Ok(true)
}

fn read_admission() -> Result<Vec<u8>, String> {
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: metadata is writable stat storage; stdin is only inspected, not taken.
    if unsafe { libc::fstat(libc::STDIN_FILENO, metadata.as_mut_ptr()) } != 0 {
        return Err("missing sidecar admission pipe".into());
    }
    // SAFETY: successful fstat initialized the entire structure.
    let kind = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;
    if kind == libc::S_IFSOCK {
        // Node uses an inherited Unix socketpair for stdio. Never accept TCP.
        let mut address = std::mem::MaybeUninit::<libc::sockaddr_storage>::zeroed();
        let mut size = std::mem::size_of::<libc::sockaddr_storage>()
            .try_into()
            .map_err(message)?;
        // SAFETY: address and size are writable, correctly sized storage.
        if unsafe { libc::getsockname(libc::STDIN_FILENO, address.as_mut_ptr().cast(), &mut size) }
            != 0
        {
            return Err("invalid sidecar admission socket".into());
        }
        // SAFETY: successful getsockname initialized the address family.
        if i32::from(unsafe { address.assume_init() }.ss_family) != libc::AF_UNIX {
            return Err("sidecar admission requires a local inherited stream".into());
        }
    } else if kind != libc::S_IFIFO {
        return Err("sidecar admission requires an inherited pipe".into());
    }
    let mut bytes = Vec::new();
    crate::handoff_input::HandoffInput::with_timeout(Duration::from_secs(30))
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(message)?;
    if bytes.is_empty() {
        return Err("missing authenticated sidecar admission".into());
    }
    if bytes.len() > 16 * 1024 {
        return Err("sidecar admission exceeds size limit".into());
    }
    Ok(bytes)
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
