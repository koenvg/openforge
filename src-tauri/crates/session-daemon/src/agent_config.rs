//! Per-allocation credentials live only in private daemon files and memory.
use openforge_session_client::runtime::io_error;
use openforge_session_protocol::{AgentConfig, Error, PtyIdentity, ShellCommand};
use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt, path::PathBuf};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct AgentRuntime {
    pub directory: PathBuf,
    pub port: u16,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CredentialCheckpoint {
    pub config: AgentConfig,
    path: PathBuf,
}

impl CredentialCheckpoint {
    pub fn validate(&self, runtime: &AgentRuntime) -> Result<(), Error> {
        let name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("agent-"))
            .and_then(|name| name.strip_suffix(".json"));
        if self.path.parent() != Some(runtime.directory.as_path())
            || !name.is_some_and(|name| uuid::Uuid::parse_str(name).is_ok())
            || self.config.port != runtime.port
        {
            return Err(Error::Unauthorized);
        }
        verify_file(&self.path, &self.config)
    }
}

pub(crate) struct AgentCredential {
    pub config: AgentConfig,
    path: PathBuf,
    cleanup: bool,
}
impl AgentRuntime {
    pub fn prepare(
        &self,
        request: &mut ShellCommand,
        pty: PtyIdentity,
    ) -> Result<Option<AgentCredential>, Error> {
        // Never inherit the Electron/Sidecar controller credential into a terminal.
        request.command.env.remove("OPENFORGE_BACKEND_TOKEN");
        request.command.env.remove("OPENFORGE_AGENT_TOKEN");
        request.command.env.insert(
            "OPENFORGE_PTY_INSTANCE_ID".into(),
            pty.instance.value().to_string(),
        );
        if openforge_session_host::scoped_agent_digest(&request.owner.session_key()).is_some() {
            // The Sidecar issued a narrower scoped credential. Do not replace it
            // with a daemon credential that grants Task gateway access.
            request.command.env.remove("OPENFORGE_TASK_ID");
            return Ok(None);
        }
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
        let credential = AgentCredential {
            config,
            path,
            cleanup: true,
        };
        serde_json::to_writer(&mut file, &credential.config).map_err(|_| Error::InvalidRequest)?;
        file.sync_all().map_err(io_error)?;
        request.command.env.insert(
            "OPENFORGE_AGENT_CONFIG".into(),
            credential.path.to_string_lossy().into_owned(),
        );
        request
            .command
            .env
            .insert("OPENFORGE_TASK_ID".into(), request.owner.task_id().into());
        Ok(Some(credential))
    }
}
impl AgentCredential {
    pub fn checkpoint(&self) -> Result<CredentialCheckpoint, Error> {
        verify_file(&self.path, &self.config)?;
        Ok(CredentialCheckpoint {
            config: self.config.clone(),
            path: self.path.clone(),
        })
    }
    pub fn restore(saved: CredentialCheckpoint, runtime: &AgentRuntime) -> Result<Self, Error> {
        saved.validate(runtime)?;
        Ok(Self {
            config: saved.config,
            path: saved.path,
            cleanup: false,
        })
    }
    pub fn activate(&mut self) {
        self.cleanup = true;
    }
}

fn verify_file(path: &std::path::Path, expected: &AgentConfig) -> Result<(), Error> {
    use std::{io::Read, os::unix::fs::MetadataExt};
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    // SAFETY: geteuid reads the current process identity and takes no pointers.
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.len() > 8192
    {
        return Err(Error::Unauthorized);
    }
    let mut bytes = Vec::new();
    file.take(8193).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() > 8192 {
        return Err(Error::Capacity);
    }
    let actual: AgentConfig = serde_json::from_slice(&bytes).map_err(|_| Error::Unauthorized)?;
    if serde_json::to_value(actual).map_err(|_| Error::InvalidRequest)?
        != serde_json::to_value(expected).map_err(|_| Error::InvalidRequest)?
    {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

impl Drop for AgentCredential {
    fn drop(&mut self) {
        if !self.cleanup {
            return;
        }
        if std::fs::remove_file(&self.path).is_err() {
            eprintln!("agent credential cleanup failed");
        }
    }
}
