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
        let mut command = Command::new(self.destination.join("Contents/MacOS/Open Forge"));
        command
            .arg(format!("--openforge-restart-operation={operation}"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env(
                "OPENFORGE_ELECTRON_USER_DATA_DIR",
                &launch.electron_user_data,
            )
            .env("OPENFORGE_APP_DATA_DIR", &launch.app_data)
            .env("OPENFORGE_SESSION_DAEMON_ROOT", &launch.daemon_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for name in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("target launch failed; retain installed app for recovery: {e}"))?;
        let recorded = (|| {
            let identity = ProcessIdentity::child(&child)?;
            let mut record = self.require(operation)?;
            record.launched = Some(identity);
            journal::write(&self.root, &record)
        })();
        if let Err(error) = recorded {
            // This is the exact child we just spawned, never a guessed/reused PID.
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(child)
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
        if !matches!(record.phase, Phase::LaunchStarted | Phase::Committed) {
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
        if let Some(runtime) = record.runtime {
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
