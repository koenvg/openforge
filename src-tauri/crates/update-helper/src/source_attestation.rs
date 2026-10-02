//! Original source evidence is captured in native memory before domain startup.
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::OnceLock};

static BIRTH: OnceLock<Birth> = OnceLock::new();
static SERVER_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const CONTEXT: &[u8] = b"openforge-original-source-v1\0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Birth {
    pub app: crate::process_identity::ProcessIdentity,
    pub sidecar: crate::process_identity::ProcessIdentity,
    pub destination: PathBuf,
    pub roots: crate::authorization::LaunchContext,
    pub bundle_hash: String,
    pub app_image: Vec<u8>,
    pub sidecar_image: Vec<u8>,
    pub boot_session: String,
    pub startup_nonce: String,
}

/// Whether this Sidecar retained native original-source evidence at startup.
#[must_use]
pub fn source_attestation_available() -> bool {
    SERVER_READY.load(std::sync::atomic::Ordering::Acquire)
        && BIRTH
            .get()
            .is_some_and(|birth| birth.sidecar.pid() == std::process::id())
}

/// Answer a fresh, trusted host challenge. Disk files never populate startup evidence.
/// # Errors
/// Refuses sources without native startup evidence or a changed lifetime/image.
pub fn source_attestation(
    request: &serde_json::Value,
    token: &str,
) -> Result<serde_json::Value, String> {
    let birth = BIRTH
        .get()
        .ok_or("missing original source startup evidence")?;
    let request: Binding =
        serde_json::from_value(request.clone()).map_err(|_| "invalid source challenge")?;
    request.validate()?;
    birth.verify_live()?;
    let payload = serde_json::to_string(&Proof {
        version: 1,
        birth: birth.clone(),
        binding: request,
    })
    .map_err(|e| e.to_string())?;
    let key = ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        &crate::authorization::decode_mac(token)?,
    );
    let tag = ring::hmac::sign(&key, &[CONTEXT, payload.as_bytes()].concat());
    Ok(
        serde_json::json!({"payload":payload,"mac":tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>()}),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    pub challenge: String,
    pub installation: String,
    pub operation: String,
    pub manifest_sha256: String,
    pub recovery_root: PathBuf,
    pub controller: Option<openforge_session_protocol::Controller>,
}
impl Binding {
    fn validate(&self) -> Result<(), String> {
        crate::authorization::decode_mac(&self.challenge)?;
        crate::authorization::decode_mac(&self.manifest_sha256)?;
        crate::authorization::identity(&self.installation)?;
        crate::authorization::identity(&self.operation)?;
        if !self.recovery_root.is_absolute() {
            return Err("invalid source recovery root".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Proof {
    pub version: u32,
    pub birth: Birth,
    pub binding: Binding,
}

impl Birth {
    fn verify_live(&self) -> Result<(), String> {
        self.app.verify(self.app.pid())?;
        self.sidecar.verify(self.sidecar.pid())?;
        if crate::process_identity::ProcessIdentity::child_of(self.sidecar.pid(), self.app.pid())?
            != self.sidecar
        {
            return Err("source Sidecar ownership changed".into());
        }
        #[cfg(target_os = "macos")]
        if boot_session()? != self.boot_session
            || process_path(self.app.pid())? != self.destination.join("Contents/MacOS/Open Forge")
            || process_path(self.sidecar.pid())?
                != self.destination.join("Contents/MacOS/openforge-sidecar")
        {
            return Err("original source boot session or executable path changed".into());
        }
        #[cfg(target_os = "macos")]
        for (identity, image) in [
            (self.app, &self.app_image),
            (self.sidecar, &self.sidecar_image),
        ] {
            if crate::native_image::running_hash(
                identity
                    .pid()
                    .try_into()
                    .map_err(|_| "invalid source pid")?,
            )?
            .as_ref()
                != Some(image)
            {
                return Err("original source loaded image changed".into());
            }
        }
        #[cfg(not(target_os = "macos"))]
        return Err("original source attestation requires macOS arm64".into());
        #[cfg(target_os = "macos")]
        Ok(())
    }
}

/// Capture both original lifetimes and loaded images before Sidecar domain initialization.
/// # Errors
/// Refuses unsupported platforms, unsealed sources, foreign parents and changed identities.
pub fn initialize_source_attestation(
    user_data: &std::path::Path,
    app_data: &std::path::Path,
    daemon_root: &std::path::Path,
    token: &str,
) -> Result<(), String> {
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (user_data, app_data, daemon_root, token);
        return Err("original source attestation requires macOS arm64".into());
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        if !crate::parent_exit_guard_armed() {
            return Err("source parent-exit guard is not armed".into());
        }
        let sidecar_path = process_path(std::process::id())?;
        let destination = sidecar_path
            .parent()
            .and_then(std::path::Path::parent)
            .and_then(std::path::Path::parent)
            .ok_or("invalid source bundle")?
            .to_path_buf();
        if sidecar_path != destination.join("Contents/MacOS/openforge-sidecar") {
            return Err("source Sidecar is not packaged".into());
        }
        // SAFETY: getppid has no arguments or memory preconditions.
        let app_pid =
            u32::try_from(unsafe { libc::getppid() }).map_err(|_| "invalid source app pid")?;
        let app = crate::process_identity::ProcessIdentity::observe(app_pid)?;
        let sidecar =
            crate::process_identity::ProcessIdentity::child_of(std::process::id(), app_pid)?;
        if process_path(app_pid)? != destination.join("Contents/MacOS/Open Forge") {
            return Err("source parent is not the installed app".into());
        }
        let roots = crate::authorization::LaunchContext {
            electron_user_data: user_data.canonicalize().map_err(message)?,
            app_data: app_data.canonicalize().map_err(message)?,
            daemon_root: daemon_root.canonicalize().map_err(message)?,
        };
        roots.validate(&destination, &destination)?;
        crate::native_image::verify_integrity(&destination)?;
        crate::native_image::verify(app_pid, &destination.join("Contents/MacOS/Open Forge"))?;
        crate::native_image::verify(sidecar.pid(), &sidecar_path)?;
        let mut nonce = [0_u8; 32];
        use ring::rand::SecureRandom;
        ring::rand::SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| "cannot generate source startup nonce")?;
        let birth = Birth {
            app,
            sidecar,
            destination: destination.clone(),
            roots,
            startup_nonce: nonce.iter().map(|b| format!("{b:02x}")).collect(),
            bundle_hash: crate::bundle::measure_daemon_source(&destination)?,
            app_image: crate::native_image::running_hash(app_pid.try_into().map_err(message)?)?
                .ok_or("source app exited")?,
            sidecar_image: crate::native_image::running_hash(
                sidecar.pid().try_into().map_err(message)?,
            )?
            .ok_or("source Sidecar exited")?,
            boot_session: boot_session()?,
        };
        birth.verify_live()?;
        crate::authorization::decode_mac(token)?;
        BIRTH
            .set(birth.clone())
            .map_err(|_| "original source evidence was already captured")?;
        crate::source_server::start(birth, token.to_owned())?;
        SERVER_READY.store(true, std::sync::atomic::Ordering::Release);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn process_path(pid: u32) -> Result<PathBuf, String> {
    let mut bytes = [0_u8; 4096];
    // SAFETY: bytes is writable storage of the advertised length; this is a read-only kernel query.
    let count = unsafe {
        libc::proc_pidpath(
            pid.try_into().map_err(message)?,
            bytes.as_mut_ptr().cast(),
            bytes.len().try_into().map_err(message)?,
        )
    };
    if count <= 0 {
        return Err("cannot identify loaded source path".into());
    }
    use std::os::unix::ffi::OsStringExt;
    let len = bytes
        .iter()
        .position(|b| *b == 0)
        .ok_or("invalid loaded source path")?;
    Ok(PathBuf::from(std::ffi::OsString::from_vec(
        bytes[..len].to_vec(),
    )))
}

#[cfg(target_os = "macos")]
pub(crate) fn boot_session() -> Result<String, String> {
    let mut bytes = [0_u8; 128];
    let mut size = bytes.len();
    // SAFETY: the name is NUL-terminated; bytes and size are valid writable storage. No value is set.
    if unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || size == 0
        || size > bytes.len()
    {
        return Err("cannot identify source boot session".into());
    }
    let value = std::str::from_utf8(&bytes[..size])
        .map_err(message)?
        .trim_end_matches('\0');
    uuid::Uuid::parse_str(value).map_err(message)?;
    Ok(value.into())
}
fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Authority {
    key: String,
    sidecar_pid: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Envelope {
    pub payload: String,
    pub mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Evidence {
    pub proof: Proof,
    pub app_exit_observed: bool,
    pub sidecar_exit_observed: bool,
}
impl Authority {
    pub fn authenticate(
        self,
        binding: &Binding,
        authority: &crate::authorization::Authorization,
        parent: u32,
    ) -> Result<Evidence, String> {
        let key = ring::hmac::Key::new(
            ring::hmac::HMAC_SHA256,
            &crate::authorization::decode_mac(&self.key)?,
        );
        crate::process_identity::ProcessIdentity::child_of(self.sidecar_pid, parent)?;
        crate::native_image::verify(
            self.sidecar_pid,
            &authority
                .installed_bundle_path
                .join("Contents/MacOS/openforge-sidecar"),
        )?;
        let envelope = crate::source_server::observe(
            authority.launch.as_ref().ok_or("missing source roots")?,
            self.sidecar_pid,
            &self.key,
            binding,
        )?;
        ring::hmac::verify(
            &key,
            &[CONTEXT, envelope.payload.as_bytes()].concat(),
            &crate::authorization::decode_mac(&envelope.mac)?,
        )
        .map_err(|_| "invalid original source authentication")?;
        let proof: Proof = serde_json::from_str(&envelope.payload)
            .map_err(|_| "invalid original source evidence")?;
        if proof.version != 1
            || serde_json::to_value(&proof.binding).map_err(message)?
                != serde_json::to_value(binding).map_err(message)?
            || proof.birth.app.pid() != parent
            || proof.birth.sidecar.pid() != self.sidecar_pid
            || proof.birth.destination != authority.installed_bundle_path
            || Some(&proof.birth.roots) != authority.launch.as_ref()
            || authority.first_adoption.is_some()
            || authority.cold_install.is_some()
        {
            return Err("original source authority does not match the operation".into());
        }
        binding.validate()?;
        proof.birth.verify_live()?;
        if crate::bundle::measure_daemon_source(&proof.birth.destination)?
            != proof.birth.bundle_hash
        {
            return Err("original source bundle changed since startup".into());
        }
        Ok(Evidence {
            proof,
            app_exit_observed: false,
            sidecar_exit_observed: false,
        })
    }
}
impl Evidence {
    pub fn verify_live(&self) -> Result<(), String> {
        self.proof.birth.verify_live()
    }
    pub fn verify_binding(
        &self,
        record: &crate::journal::Record,
        root: &std::path::Path,
    ) -> Result<(), String> {
        let binding = &self.proof.binding;
        if binding.installation != record.installation
            || binding.operation != record.operation
            || binding.manifest_sha256 != record.target_hash
            || binding.recovery_root != root
            || self.proof.birth.destination != record.destination
            || self.proof.birth.bundle_hash != record.previous_hash
            || record
                .runtime
                .as_ref()
                .is_some_and(|runtime| binding.controller.as_ref() != Some(&runtime.controller))
        {
            return Err("original source evidence belongs to another operation or root".into());
        }
        Ok(())
    }
    pub fn verify_exits(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        if boot_session()? != self.proof.birth.boot_session {
            return Err("original source boot session is stale".into());
        }
        if !self.app_exit_observed
            || !self.sidecar_exit_observed
            || !self.proof.birth.app.pid_absent()?
            || !self.proof.birth.sidecar.pid_absent()?
        {
            return Err("original source exit authority is unknown".into());
        }
        Ok(())
    }
}

pub(crate) struct Watch {
    app: crate::host_exit::HostExit,
    sidecar: crate::host_exit::HostExit,
}
impl Watch {
    pub fn verify_live(
        &self,
        transaction: &crate::InstallTransaction,
        operation: &str,
    ) -> Result<(), String> {
        if self.app.poll_exit()? || self.sidecar.poll_exit()? {
            return Err("original source was lost during preparation".into());
        }
        transaction
            .require(operation)?
            .source
            .ok_or("missing original source evidence")?
            .verify_live()
    }
    pub fn new(source: &Evidence) -> Result<Self, String> {
        let result = Self {
            app: crate::host_exit::HostExit::watch_process(source.proof.birth.app)?,
            sidecar: crate::host_exit::HostExit::watch_process(source.proof.birth.sidecar)?,
        };
        source.verify_live()?;
        Ok(result)
    }
    pub fn confirm_sidecar_exit(
        &self,
        transaction: &mut crate::InstallTransaction,
        operation: &str,
    ) -> Result<(), String> {
        let mut record = transaction.require(operation)?;
        let source = record
            .source
            .as_mut()
            .ok_or("missing original source evidence")?;
        if self.app.poll_exit()? {
            return Err("original app exited before arming".into());
        }
        source
            .proof
            .birth
            .app
            .verify(source.proof.birth.app.pid())?;
        #[cfg(target_os = "macos")]
        if crate::native_image::running_hash(
            source.proof.birth.app.pid().try_into().map_err(message)?,
        )?
        .as_ref()
            != Some(&source.proof.birth.app_image)
            || boot_session()? != source.proof.birth.boot_session
        {
            return Err("original source app lifetime changed".into());
        }
        if !self.sidecar.poll_exit()? {
            return Err("exact original Sidecar exit was not observed".into());
        }
        source.sidecar_exit_observed = true;
        crate::journal::write(&transaction.root, &record)
    }
    pub fn confirm_app_exit(
        &self,
        transaction: &mut crate::InstallTransaction,
        operation: &str,
    ) -> Result<(), String> {
        let mut record = transaction.require(operation)?;
        let source = record
            .source
            .as_mut()
            .ok_or("missing original source evidence")?;
        if !source.sidecar_exit_observed || !self.app.poll_exit()? {
            return Err("exact original app exit was not observed".into());
        }
        source.app_exit_observed = true;
        crate::journal::write(&transaction.root, &record)
    }
}
