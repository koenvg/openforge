//! Trusted native cold-install entry point. No caller-supplied approval or publisher fallback.
use crate::{authorization, bundle, files, native_image, InstallTransaction, Phase};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
};

/// Inspect, stage and ask the local operator to authorize an exact offline installation.
/// # Errors
/// Refuses unsealed builds, running owners, pending updates, cancellation and changed bytes.
pub fn run_cold_install(
    source: &Path,
    destination: &Path,
    profile: &Path,
    daemon_root: &Path,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("cold installation requires macOS".into());
    }
    let source = source.canonicalize().map_err(message)?;
    // Verify code before creating transaction state or asking for artifact authority.
    native_image::verify_integrity(&source)?;
    native_image::verify(
        std::process::id(),
        &source.join("Contents/MacOS/openforge-update-helper"),
    )?;
    verify_seal(&source)?;
    let target_hash = bundle::measure(&source)?;
    let helper_hash = format!(
        "{:x}",
        Sha256::digest(
            fs::read(source.join("Contents/MacOS/openforge-update-helper")).map_err(message)?
        )
    );
    let destination = canonical_destination(destination)?;
    if source == destination {
        return Err("cold candidate must be outside the installed bundle".into());
    }
    let installer =
        crate::cold_processes::VerifiedInstaller::matching_current(&source, &helper_hash)?
            .ok_or("executing cold installer differs from target helper")?;
    installer.assert_stopped(&destination)?;
    let source_hash = bundle::cold_source_sha256(&destination)?;
    let profile = canonical_destination(profile)?;
    let daemon_root = canonical_destination(daemon_root)?;
    if [&profile, &daemon_root]
        .iter()
        .any(|path| path.starts_with(&source) || path.starts_with(&destination))
    {
        return Err("cold-install state must be outside application bundles".into());
    }
    owned_directory(&profile)?;
    owned_directory(&daemon_root)?;
    let updates = profile.join("updates");
    files::private_directory(&updates)?;
    let root = updates.join("native");
    if root.starts_with(&source)
        || root.starts_with(&destination)
        || daemon_root.starts_with(&source)
        || daemon_root.starts_with(&destination)
    {
        return Err("cold-install state must be outside application bundles".into());
    }
    let reservation = crate::runtime_update::ColdRuntime::reserve(&daemon_root)?;
    installer.assert_stopped(&daemon_root)?;
    let identity = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(&profile, reservation.installation.as_str())).map_err(message)?
        )
    );
    let ownership = InstallTransaction::reserve(&root, &identity, &destination)?;
    if ownership.record()?.is_some_and(|record| {
        !matches!(
            record.phase,
            Phase::Committed | Phase::ColdCommitted | Phase::RolledBack
        )
    }) {
        return Err(
            "an installation is pending; use cold recovery instead of a new approval".into(),
        );
    }
    let staging = updates.join("staged");
    files::private_directory(&staging)?;
    let operation = uuid::Uuid::new_v4().to_string();
    let staged = staging.join(format!("bundle-{operation}.app"));
    let copy = Command::new("/usr/bin/ditto")
        .arg(&source)
        .arg(&staged)
        .env_clear()
        .output()
        .map_err(message)?;
    if !copy.status.success() {
        return Err("cannot stage cold application".into());
    }
    if bundle::measure(&staged)? != target_hash {
        return Err("cold candidate changed during staging".into());
    }
    verify_seal(&staged)?;
    let detail = format!("Install this exact LOCAL build?\n\nInstallation: {}\nProfile: {}\nTerminal Runtime: {}\nOperation: {operation}\nNew build SHA-256: {target_hash}\nCurrent app SHA-256: {source_hash}\n\nThis is not publisher verification. All OpenForge processes must be stopped. Sessions will not be preserved. App data is retained. Installation recovery will never restore an older app after publication.", destination.display(), profile.display(), daemon_root.display());
    if !confirm(&detail)? {
        fs::remove_dir_all(&staged).map_err(message)?;
        return Err(
            "cold installation was cancelled; installed app and CLI were not changed".into(),
        );
    }
    // Commit the approved roots only after the operator confirms the exact build.
    let mut transaction = ownership.bind()?;
    // Keep the verified installer independently of the replaceable bundle for recovery.
    let retained_helper = root.join(format!("cold-installer-{operation}"));
    fs::copy(
        staged.join("Contents/MacOS/openforge-update-helper"),
        &retained_helper,
    )
    .map_err(message)?;
    if format!(
        "{:x}",
        Sha256::digest(fs::read(&retained_helper).map_err(message)?)
    ) != helper_hash
    {
        return Err("cold recovery helper changed during retention".into());
    }
    fs::set_permissions(&retained_helper, fs::Permissions::from_mode(0o700)).map_err(message)?;
    fs::File::open(&retained_helper)
        .and_then(|file| file.sync_all())
        .map_err(message)?;
    files::sync_directory(&root)?;
    let authority_root = updates.join("cold-authority");
    files::private_directory(&authority_root)?;
    let payload = json!({
        "version":1, "installationId":identity, "operationId":operation,
        "installedBundlePath":destination, "source":"local-build", "manifestSha256":target_hash,
        "bundlePath":staged, "coldInstall":{"installedManifestSha256":source_hash,"daemonRoot":daemon_root,"electronUserData":profile,"daemonInstallation":reservation.installation.as_str(),"helperSha256":helper_hash}
    }).to_string();
    write_authority(&authority_root, &operation, &payload)?;
    transaction.prepare(&authority_root, &staging, &operation)?;
    drop(reservation);
    transaction.install_cold(&operation)?;
    println!(
        "{}",
        json!({"status":"cold-installed","operation":operation,"destination":destination,"targetSha256":target_hash,"recoveryHelper":retained_helper})
    );
    Ok(())
}

/// Resume only the previously authorized build. This never issues fresh authority.
/// # Errors
/// Refuses foreign state, unsupported phases, a different helper and changed artifacts.
pub fn run_cold_recovery(destination: &Path, profile: &Path) -> Result<(), String> {
    let destination = canonical_destination(destination)?;
    let root = profile
        .canonicalize()
        .map_err(message)?
        .join("updates/native");
    let parent = destination.parent().ok_or("missing destination parent")?;
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("invalid destination")?;
    let binding = files::read_private(
        &parent.join(format!(".{name}.openforge-update.lock")),
        16 * 1024,
    )?;
    let (bound_root, identity): (PathBuf, String) =
        serde_json::from_slice(&binding).map_err(message)?;
    if bound_root != root {
        return Err("cold recovery belongs to another installation root".into());
    }
    let mut transaction = InstallTransaction::open(&root, &identity, &destination)?;
    let record = transaction
        .record()?
        .ok_or("no cold-install operation to recover")?;
    let authority = authorization::read(
        &record.authorization,
        &record.operation,
        &identity,
        &destination,
        &record.staging,
    )?;
    if authority.cold_install.is_none() {
        return Err("cold recovery cannot resume a live update".into());
    }
    let expected_helper = &authority
        .cold_install
        .as_ref()
        .ok_or("missing cold authority")?
        .helper_sha256;
    if format!(
        "{:x}",
        Sha256::digest(fs::read(std::env::current_exe().map_err(message)?).map_err(message)?)
    ) != *expected_helper
    {
        return Err("cold recovery helper differs from the approved artifact".into());
    }
    let target = if bundle::cold_source_sha256(&destination)? == record.target_hash {
        &destination
    } else {
        &authority.bundle_path
    };
    if bundle::measure(target)? != record.target_hash {
        return Err("cold recovery target changed".into());
    }
    native_image::verify(
        std::process::id(),
        &target.join("Contents/MacOS/openforge-update-helper"),
    )?;
    verify_seal(target)?;
    transaction.install_cold(&record.operation)?;
    println!(
        "{}",
        json!({"status":"cold-installed","operation":record.operation,"destination":destination,"targetSha256":record.target_hash})
    );
    Ok(())
}

/// Run the packaged ordinary-startup check using the Sidecar's configured data root.
/// # Errors
/// Refuses foreign roots, incomplete cold operations and changed artifact or runtime identities.
pub fn run_cold_startup(destination: &Path, profile: &Path) -> Result<(), String> {
    let daemon_root = if let Some(root) = std::env::var_os("OPENFORGE_SESSION_DAEMON_ROOT") {
        PathBuf::from(root)
    } else {
        let app_data = match std::env::var_os("OPENFORGE_APP_DATA_DIR")
            .filter(|value| !value.is_empty())
        {
            Some(path) => PathBuf::from(path),
            None => {
                let identity: serde_json::Value =
                    serde_json::from_str(include_str!("../../../../openforge-data-identity.json"))
                        .map_err(message)?;
                let identifier = identity["dataIdentity"]["appDataIdentifier"]
                    .as_str()
                    .ok_or("missing application data identity")?;
                PathBuf::from(std::env::var_os("HOME").ok_or("missing home directory")?)
                    .join("Library/Application Support")
                    .join(identifier)
            }
        };
        app_data.join("session-daemon")
    };
    crate::assert_cold_launch_roots(destination, profile, &daemon_root)
}
fn write_authority(root: &Path, operation: &str, payload: &str) -> Result<(), String> {
    let key_path = root.join("authorization.key");
    match fs::symlink_metadata(&key_path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut key = [0_u8; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "cannot create cold authority key")?;
            files::write_new(&key_path, &key)?;
        }
        Err(error) => return Err(message(error)),
    }
    let key = files::read_private(&key_path, 32)?;
    if key.len() != 32 {
        return Err("invalid cold authority key".into());
    }
    let tag = hmac::sign(
        &hmac::Key::new(hmac::HMAC_SHA256, &key),
        &[
            b"openforge-update-authorization-v1\0".as_slice(),
            payload.as_bytes(),
        ]
        .concat(),
    );
    let mac: String = tag
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    files::write_new(
        &root.join(format!("{operation}.json")),
        &serde_json::to_vec(&json!({"payload":payload,"mac":mac})).map_err(message)?,
    )
}

fn confirm(detail: &str) -> Result<bool, String> {
    let script = "on run argv\ndisplay dialog (item 1 of argv) with title \"Cold install OpenForge\" buttons {\"Cancel\", \"Install this build\"} default button \"Cancel\" cancel button \"Cancel\"\nreturn button returned of result\nend run";
    let result = Command::new("/usr/bin/osascript")
        .args(["-e", script, "--", detail])
        .output()
        .map_err(message)?;
    if !result.status.success() {
        return Ok(false);
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim() == "Install this build")
}

fn verify_seal(bundle: &Path) -> Result<(), String> {
    let result = Command::new("/usr/bin/codesign")
        .args(["--verify", "--strict", "--deep"])
        .arg(bundle)
        .env_clear()
        .output()
        .map_err(message)?;
    if !result.status.success() {
        return Err(format!(
            "invalid complete-app code signature: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

fn owned_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("cold-install data root must be absolute".into());
    }
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(message)?;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(message)?;
        }
        Err(error) => return Err(message(error)),
    }
    let metadata = fs::symlink_metadata(path).map_err(message)?;
    // SAFETY: geteuid has no arguments or memory preconditions.
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o7022 != 0
    {
        return Err("unsafe cold-install data directory".into());
    }
    Ok(())
}

fn canonical_destination(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("cold destination must be absolute".into());
    }
    let parent = path
        .parent()
        .ok_or("missing destination parent")?
        .canonicalize()
        .map_err(message)?;
    Ok(parent.join(path.file_name().ok_or("missing destination name")?))
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
