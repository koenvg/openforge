//! A helper waits for durable, challenge-bound process authority before execing the app.
use crate::{
    authorization, bundle, files, handoff_input::HandoffInput, journal, native_image,
    process_identity::ProcessIdentity, startup, InstallTransaction,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read, Write},
    os::{
        fd::{AsFd, OwnedFd},
        unix::process::CommandExt,
    },
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};

/// Internal entry point; the argument never substitutes for native launch authority.
pub const APP_BOOTSTRAP_ARGUMENT: &str = "--openforge-update-bootstrap";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Gate {
    pub owner: ProcessIdentity,
    pub challenge: Option<String>,
}

impl Gate {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            owner: ProcessIdentity::observe(std::process::id())?,
            challenge: None,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Admission {
    root: PathBuf,
    installation: String,
    destination: PathBuf,
    operation: String,
}

pub(crate) fn release(
    transaction: &mut InstallTransaction,
    operation: &str,
    child: &mut Child,
) -> Result<(), String> {
    let stdout = child.stdout.take().ok_or("missing bootstrap output")?;
    let mut output = BufReader::new(HandoffInput::from_file(
        File::from(OwnedFd::from(stdout)),
        Duration::from_secs(60),
    ));
    let hello = frame(&mut output)?.ok_or("missing bootstrap challenge")?;
    let challenge = hello["challenge"]
        .as_str()
        .ok_or("invalid bootstrap challenge")?;
    if hello["version"] != 1
        || challenge.len() != 64
        || !challenge.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("invalid bootstrap challenge".into());
    }
    let identity = ProcessIdentity::child(child)?;
    native_image::verify(
        child.id(),
        &transaction
            .destination
            .join("Contents/MacOS/openforge-update-helper"),
    )?;
    let mut record = transaction.require(operation)?;
    let gate = record
        .launch_gate
        .as_mut()
        .ok_or("missing app launch gate")?;
    gate.owner.verify(std::process::id())?;
    gate.challenge = Some(challenge.into());
    record.launched = Some(identity);
    // The child cannot exec until this HMAC-covered nonce and birth are durable.
    journal::write(&transaction.root, &record)?;
    #[cfg(feature = "test-fixtures")]
    crate::launch::pause_launch(&transaction.root, child, "launch-release")?;
    let admission = Admission {
        root: transaction.root.clone(),
        installation: transaction.installation.clone(),
        destination: transaction.destination.clone(),
        operation: operation.into(),
    };
    {
        let mut input = child.stdin.take().ok_or("missing bootstrap input")?;
        input
            .write_all(&serde_json::to_vec(&admission).map_err(message)?)
            .map_err(message)?;
    }
    // The child retains a CLOEXEC control descriptor while remapping app stdio.
    // Exec failure is reported on that descriptor; successful exec closes it.
    if let Some(error) = frame(&mut output)? {
        return Err(error["error"]
            .as_str()
            .unwrap_or("invalid bootstrap response")
            .into());
    }
    identity.verify(child.id())
}

/// Enter only through a private inherited stream and a fresh journal-authenticated challenge.
/// The command-line argument alone cannot release the app.
/// # Errors
/// Refuses absent/stale process authority, foreign roots, changed images and failed exec.
/// # Examples
/// ```no_run
/// openforge_update_helper::run_app_bootstrap()?;
/// # Ok::<(), String>(())
/// ```
pub fn run_app_bootstrap() -> Result<(), String> {
    // try_clone_to_owned uses a CLOEXEC duplicate, retained even when exec remaps stdout.
    let mut control = File::from(
        std::io::stdout()
            .as_fd()
            .try_clone_to_owned()
            .map_err(message)?,
    );
    let result = bootstrap(&mut control);
    if let Err(error) = &result {
        let _ = writeln!(control, "{}", serde_json::json!({"error":error}));
    }
    result
}

fn bootstrap(control: &mut File) -> Result<(), String> {
    let mut nonce = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "cannot generate bootstrap challenge")?;
    let challenge: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    writeln!(
        control,
        "{}",
        serde_json::json!({"version":1,"challenge":challenge})
    )
    .map_err(message)?;
    let admission: Admission = serde_json::from_slice(&startup::read_admission("app bootstrap")?)
        .map_err(|_| "invalid app bootstrap admission")?;
    let launch = admission.authorize(&challenge)?;
    let mut command = Command::new(admission.destination.join("Contents/MacOS/Open Forge"));
    crate::launch::configure_environment(&mut command, &launch);
    command
        .arg(format!(
            "--openforge-restart-operation={}",
            admission.operation
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            std::io::stderr()
                .as_fd()
                .try_clone_to_owned()
                .map_err(message)?,
        ))
        .stderr(Stdio::inherit());
    Err(format!(
        "target launch failed; retain installed app for recovery: {}",
        command.exec()
    ))
}

impl Admission {
    fn authorize(&self, challenge: &str) -> Result<authorization::LaunchContext, String> {
        files::check_private_directory(&self.root)?;
        if !startup::binding_matches(&self.root, &self.installation, &self.destination)? {
            return Err("app bootstrap belongs to another recovery root".into());
        }
        let record = journal::read(&self.root)?.ok_or("missing app launch record")?;
        if record.installation != self.installation
            || record.operation != self.operation
            || record.destination != self.destination
            || !record.phase.awaiting_commit()
            || record.sidecar.is_some()
        {
            return Err("stale app bootstrap admission".into());
        }
        let gate = record
            .launch_gate
            .as_ref()
            .ok_or("missing app launch gate")?;
        if gate.challenge.as_deref() != Some(challenge) {
            return Err("stale app bootstrap challenge".into());
        }
        let identity = record
            .launched
            .as_ref()
            .ok_or("missing authenticated target process")?;
        identity.verify(std::process::id())?;
        gate.owner.verify(gate.owner.pid())?;
        if &ProcessIdentity::child_of(std::process::id(), gate.owner.pid())? != identity {
            return Err("app bootstrap parent changed".into());
        }
        native_image::verify(
            std::process::id(),
            &self
                .destination
                .join("Contents/MacOS/openforge-update-helper"),
        )?;
        let authority = authorization::read(
            &record.authorization,
            &self.operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        let launch = authority
            .launch
            .ok_or("missing authorized launch context")?;
        launch.validate(&self.destination, &authority.bundle_path)?;
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("authorized installed bundle changed".into());
        }
        if let Some(runtime) = &record.runtime {
            runtime.verify_running(&launch.daemon_root, &self.operation)?;
        }
        let current = journal::read(&self.root)?.ok_or("missing app launch record")?;
        if current.operation != record.operation
            || current.phase != record.phase
            || current.launched != record.launched
            || current.launch_gate != record.launch_gate
            || current.sidecar != record.sidecar
        {
            return Err("app bootstrap admission changed during verification".into());
        }
        Ok(launch)
    }
}

fn frame(input: &mut impl BufRead) -> Result<Option<serde_json::Value>, String> {
    let mut bytes = Vec::new();
    input
        .take(16 * 1024 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(message)?;
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() > 16 * 1024 || bytes.last() != Some(&b'\n') {
        return Err("invalid bootstrap frame".into());
    }
    serde_json::from_slice(&bytes).map(Some).map_err(message)
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
