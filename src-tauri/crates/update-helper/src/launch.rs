use crate::{
    authorization, bundle, journal, process_identity::ProcessIdentity, InstallTransaction, Phase,
};
use std::process::{Child, Command, Stdio};

impl InstallTransaction {
    /// Launch only the authorized entry point and record its kernel birth identity.
    /// Target boot must verify that identity before starting a domain backend.
    /// # Errors
    /// Refuses stale phases, changed authorization/bundle/data roots, failed exec
    /// and an unrecorded child. A failure never removes the domain rollback fence.
    pub fn launch(&mut self, operation: &str) -> Result<Child, String> {
        let record = self.require(operation)?;
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        let launch = authority
            .launch
            .as_ref()
            .ok_or("missing authorized launch context")?;
        launch.validate(&self.destination, &authority.bundle_path)?;
        self.begin_launch(operation)?;
        self.spawn_target(operation, launch)
    }

    fn spawn_target(
        &mut self,
        operation: &str,
        launch: &authorization::LaunchContext,
    ) -> Result<Child, String> {
        let mut record = self.require(operation)?;
        record.launch_attempt = record
            .launch_attempt
            .checked_add(1)
            .ok_or("update launch attempt exhausted")?;
        record.launched = None;
        record.sidecar = None;
        record.launch_gate = Some(crate::launch_gate::Gate::new()?);
        journal::write(&self.root, &record)?;
        let mut command = Command::new(
            self.destination
                .join("Contents/MacOS/openforge-update-helper"),
        );
        configure_environment(&mut command, launch);
        command
            .arg(crate::launch_gate::APP_BOOTSTRAP_ARGUMENT)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(feature = "test-fixtures")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let log = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(self.root.join(if record.launch_attempt == 1 {
                    "target-launch.log".into()
                } else {
                    format!("target-launch-{}.log", record.launch_attempt)
                }))
                .map_err(|e| e.to_string())?;
            command.stderr(log);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("target launch failed; retain installed app for recovery: {e}"))?;
        let recorded = (|| {
            #[cfg(feature = "test-fixtures")]
            pause_launch(&self.root, &child, "launch-record")?;
            crate::launch_gate::release(self, operation, &mut child)
        })();
        if let Err(error) = recorded {
            // This is the exact child we just spawned, never a guessed/reused PID.
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(child)
    }

    /// Verify a recovery requester without giving it target startup authority.
    /// The executable protocol supplies the requester from its actual parent.
    /// # Errors
    /// Refuses incompatible code, unknown owners, another live app/Sidecar, or changed authority.
    pub fn prepare_relaunch(&self, operation: &str, caller_pid: u32) -> Result<(), String> {
        let record = self.require(operation)?;
        if !record.phase.may_own_domain() {
            return Err("update has not launched".into());
        }
        let caller = ProcessIdentity::observe(caller_pid)?;
        let app = record.launched.as_ref();
        match app {
            Some(app) if app.running()? && app != &caller => {
                return Err("target process is still running".into());
            }
            None if !abandoned_unreleased_gate(&record)? => {
                return Err("missing authenticated target process".into());
            }
            _ => {}
        }
        crate::native_image::verify(
            caller_pid,
            &self.destination.join("Contents/MacOS/Open Forge"),
        )?;
        if let Some(sidecar) = &record.sidecar {
            if sidecar.running()? {
                if app != Some(&caller)
                    || &ProcessIdentity::child_of(sidecar.pid(), caller_pid)? != sidecar
                {
                    return Err("another admitted Sidecar is still running".into());
                }
                crate::native_image::verify(
                    sidecar.pid(),
                    &self.destination.join("Contents/MacOS/openforge-sidecar"),
                )?;
            }
        }
        self.relaunch_context(&record)?;
        Ok(())
    }

    fn relaunch_context(
        &self,
        record: &journal::Record,
    ) -> Result<authorization::LaunchContext, String> {
        let authority = authorization::read(
            &record.authorization,
            &record.operation,
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
            runtime.verify_running(&launch.daemon_root, &record.operation)?;
        }
        Ok(launch)
    }

    /// Retry only the authorized installed app after every recorded process exits.
    /// # Errors
    /// Refuses live/unknown owners, changed authority or bytes, and any rollback.
    pub fn relaunch(&mut self, operation: &str) -> Result<Child, String> {
        let mut record = self.require(operation)?;
        if !record.phase.may_own_domain() {
            return Err("update has not launched".into());
        }
        if record.launched.is_none() {
            // An unrecorded process is not presumed dead. An abandoned gate proves
            // that no authority to exec the app could have been released.
            if !abandoned_unreleased_gate(&record)? {
                return Err("missing authenticated target process".into());
            }
        } else if self.launched_process_running(operation)? {
            return Err("target process is still running".into());
        }
        let launch = self.relaunch_context(&record)?;
        if record.phase == Phase::Committed {
            record.phase = Phase::RelaunchStarted;
            journal::write(&self.root, &record)?;
        }
        self.spawn_target(operation, &launch)
    }

    /// Observe recorded app and Sidecar birth identities without signalling them.
    /// # Errors
    /// Missing app identity is unknown, never proof that a target exited.
    pub fn launched_process_running(&self, operation: &str) -> Result<bool, String> {
        let record = self.require(operation)?;
        let app = record
            .launched
            .ok_or("missing authenticated target process")?;
        Ok(app.running()?
            || record
                .sidecar
                .map(|child| child.running())
                .transpose()?
                .unwrap_or(false))
    }

    /// Verify the caller's launch authority before Sidecar/database access.
    /// The executable protocol obtains caller_pid from its kernel-observed parent,
    /// never from the handoff payload, environment or a renderer request.
    /// # Errors
    /// Refuses missing/stale process identity, wrong operations, unsafe roots and
    /// changed authorization or installed bytes. A recorded PID alone is not proof.
    pub fn verify_launch(&self, operation: &str, caller_pid: u32) -> Result<(), String> {
        let record = self.require(operation)?;
        if !record.phase.may_own_domain() {
            return Err("update has not launched".into());
        }
        record
            .launched
            .ok_or("missing authenticated target process")?
            .verify(caller_pid)?;
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        authority
            .launch
            .as_ref()
            .ok_or("missing authorized launch context")?
            .validate(&self.destination, &authority.bundle_path)?;
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("authorized installed bundle changed".into());
        }
        crate::native_image::verify(
            caller_pid,
            &self.destination.join("Contents/MacOS/Open Forge"),
        )?;
        if let Some(runtime) = record
            .runtime
            .as_ref()
            .filter(|_| record.phase.awaiting_commit())
        {
            runtime.verify_running(
                &authority
                    .launch
                    .as_ref()
                    .ok_or("missing authorized launch context")?
                    .daemon_root,
                operation,
            )?;
        }
        Ok(())
    }
}

fn abandoned_unreleased_gate(record: &journal::Record) -> Result<bool, String> {
    if !record.phase.awaiting_commit() || record.launched.is_some() || record.sidecar.is_some() {
        return Ok(false);
    }
    let Some(gate) = &record.launch_gate else {
        return Ok(false);
    };
    if gate.challenge.is_some() {
        return Ok(false);
    }
    Ok(!gate.owner.running()?)
}

pub(crate) fn configure_environment(command: &mut Command, launch: &authorization::LaunchContext) {
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env(
            "OPENFORGE_ELECTRON_USER_DATA_DIR",
            &launch.electron_user_data,
        )
        .env("OPENFORGE_APP_DATA_DIR", &launch.app_data)
        .env("OPENFORGE_SESSION_DAEMON_ROOT", &launch.daemon_root);
    for name in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}

#[cfg(feature = "test-fixtures")]
pub(crate) fn pause_launch(
    root: &std::path::Path,
    child: &Child,
    boundary: &str,
) -> Result<(), String> {
    if !root.join(format!("pause-before-{boundary}")).exists() {
        return Ok(());
    }
    std::fs::write(
        root.join(format!("{boundary}-paused")),
        child.id().to_string(),
    )
    .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !root.join(format!("resume-{boundary}")).exists() {
        if std::time::Instant::now() >= deadline {
            return Err(format!("fixture {boundary} pause expired"));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}
