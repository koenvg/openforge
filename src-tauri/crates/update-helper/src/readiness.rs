//! Commit evidence comes from live authenticated processes, not a renderer assertion.
use crate::{
    authorization, native_image, process_identity::ProcessIdentity, InstallTransaction, Phase,
};
use openforge_session_client::MaintenanceClient;
use openforge_session_protocol::Controller;

impl InstallTransaction {
    /// Check the launched app, admitted Sidecar and current target daemon independently.
    /// `caller_pid` must come from the native helper's observed parent.
    /// # Errors
    /// Refuses missing/dead/substituted processes, stale controllers and wrong runtime images.
    pub fn verify_readiness(
        &self,
        operation: &str,
        caller_pid: u32,
        controller: Option<Controller>,
    ) -> Result<(), String> {
        self.verify_launch(operation, caller_pid)?;
        let record = self.require(operation)?;
        let sidecar = record.sidecar.ok_or("missing admitted Sidecar")?;
        if ProcessIdentity::child_of(sidecar.pid(), caller_pid)? != sidecar {
            return Err("admitted Sidecar identity changed".into());
        }
        native_image::verify(
            sidecar.pid(),
            &self.destination.join("Contents/MacOS/openforge-sidecar"),
        )?;
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        let root = &authority
            .launch
            .as_ref()
            .ok_or("missing runtime root")?
            .daemon_root;
        let controller = controller.ok_or("missing replacement Sidecar controller")?;
        let client =
            MaintenanceClient::attach(root, controller.clone()).map_err(|e| e.to_string())?;
        let capabilities = client.capabilities().map_err(|e| e.to_string())?;
        let daemon = ProcessIdentity::observe(capabilities.pid)?;
        if let Some(runtime) = record.runtime {
            runtime.verify_ready(root, operation, Some(controller))?;
        } else {
            if record.cold_installation.as_ref() != Some(&controller.installation) {
                return Err("cold runtime installation changed".into());
            }
            // A cold daemon must have been started by this admitted Sidecar.
            ProcessIdentity::child_of(capabilities.pid, sidecar.pid())?;
        }
        native_image::verify(
            capabilities.pid,
            &self
                .destination
                .join("Contents/MacOS/openforge-session-daemon"),
        )?;
        daemon.verify(capabilities.pid)?;
        sidecar.verify(sidecar.pid())?;
        record
            .launched
            .ok_or("missing authenticated target process")?
            .verify(caller_pid)
    }

    /// Commit only from the live target after native readiness and host restoration checks.
    /// A committed retry still checks authorization and bytes, but need not relaunch processes.
    /// # Errors
    /// Refuses an unready target or a stale/tampered transaction.
    pub fn commit_from_process(
        &mut self,
        operation: &str,
        caller_pid: u32,
        controller: Option<Controller>,
    ) -> Result<(), String> {
        if self.require(operation)?.phase != Phase::Committed {
            self.verify_readiness(operation, caller_pid, controller.clone())?;
        }
        self.commit_with_controller(operation, controller)
    }
}
