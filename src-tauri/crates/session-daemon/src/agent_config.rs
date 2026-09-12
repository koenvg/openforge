//! Per-allocation credentials live only in private daemon files and memory.
use openforge_session_client::runtime::io_error;
use openforge_session_protocol::{AgentConfig, Error, PtyIdentity, ShellCommand};
use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt, path::PathBuf};

#[derive(Clone)]
pub(crate) struct AgentRuntime {
    pub directory: PathBuf,
    pub port: u16,
}

pub(crate) struct AgentCredential {
    pub config: AgentConfig,
    path: PathBuf,
}
impl AgentRuntime {
    pub fn prepare(
        &self,
        request: &mut ShellCommand,
        pty: PtyIdentity,
    ) -> Result<AgentCredential, Error> {
        let config = AgentConfig {
            version: 1,
            port: self.port,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            pty,
            owner: request.owner.clone(),
        };
        let path = self
            .directory
            .join(format!("agent-{}.json", uuid::Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .map_err(io_error)?;
        let credential = AgentCredential { config, path };
        serde_json::to_writer(&mut file, &credential.config).map_err(|_| Error::InvalidRequest)?;
        file.sync_all().map_err(io_error)?;
        // Never inherit the Electron/Sidecar controller credential into a terminal.
        request.command.env.remove("OPENFORGE_BACKEND_TOKEN");
        request.command.env.remove("OPENFORGE_AGENT_TOKEN");
        request.command.env.insert(
            "OPENFORGE_AGENT_CONFIG".into(),
            credential.path.to_string_lossy().into_owned(),
        );
        request
            .command
            .env
            .insert("OPENFORGE_TASK_ID".into(), request.owner.task_id().into());
        request.command.env.insert(
            "OPENFORGE_PTY_INSTANCE_ID".into(),
            credential.config.pty.instance.value().to_string(),
        );
        Ok(credential)
    }
}
impl Drop for AgentCredential {
    fn drop(&mut self) {
        if std::fs::remove_file(&self.path).is_err() {
            eprintln!("agent credential cleanup failed");
        }
    }
}
