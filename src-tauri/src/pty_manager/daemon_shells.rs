//! Controlled shell/agent selection and command preparation for the daemon bridge.
//! Connection ownership and event forwarding live in `daemon_transport`.
pub(crate) use super::daemon_transport::CommandFence;
use super::daemon_transport::DaemonTransport;
#[cfg(test)]
use super::PtyManager;
use super::{PtyBufferState, TerminalViewSnapshot};
use crate::app_events::RuntimeEventPublisher;
use base64::Engine;
use openforge_session_client::Client;
use openforge_session_protocol::{Error, Session, ShellCommand};
use std::path::PathBuf;
use std::sync::Arc;

#[cfg(test)]
#[path = "daemon_completion_tests.rs"]
mod completion_tests;

#[derive(Clone)]
pub(crate) struct DaemonShells {
    transport: DaemonTransport,
    selection: Arc<Selection>,
    key: Option<String>,
    fence: Option<CommandFence>,
}

struct Selection {
    shell_key: String,
    agent_keys: std::collections::BTreeMap<String, String>,
}

impl Selection {
    fn owns(&self, key: &str) -> bool {
        selected_shell(&self.shell_key, key) || self.agent_keys.contains_key(key)
    }
}

#[cfg(test)]
impl PtyManager {
    pub(crate) fn enable_daemon_shell(&mut self, root: PathBuf, executable: PathBuf, key: String) {
        self.daemon_shells = Some(DaemonShells::new(root, executable, key));
    }
    pub(crate) fn enable_daemon_pi(&mut self, root: PathBuf, executable: PathBuf, key: String) {
        self.daemon_shells = Some(DaemonShells::with_selection(
            root,
            executable,
            String::new(),
            [(key, "pi".into())].into(),
        ));
    }
}

impl DaemonShells {
    pub(super) fn configure_completion(
        &self,
        discovery: crate::github_runtime::task_pr_discovery::LocalDiscovery,
    ) {
        self.transport.configure_completion(discovery);
    }
    #[cfg(test)]
    pub(crate) fn new(root: PathBuf, executable: PathBuf, key: String) -> Self {
        Self::with_selection(root, executable, key, Default::default())
    }

    fn with_selection(
        root: PathBuf,
        executable: PathBuf,
        key: String,
        agent_keys: std::collections::BTreeMap<String, String>,
    ) -> Self {
        let selection = Arc::new(Selection {
            shell_key: key,
            agent_keys,
        });
        let event_selection = Arc::clone(&selection);
        Self {
            transport: DaemonTransport::new(root, executable, move |key| event_selection.owns(key)),
            selection,
            key: None,
            fence: None,
        }
    }

    pub(super) fn from_environment() -> Option<Self> {
        if !cfg!(debug_assertions) || std::env::var("OPENFORGE_E2E").as_deref() != Ok("1") {
            return None;
        }
        let key = std::env::var("OPENFORGE_SESSION_DAEMON_SHELL_KEY").unwrap_or_default();
        let agent_keys = ["pi", "claude", "codex", "opencode", "grok"]
            .into_iter()
            .filter_map(|provider| {
                std::env::var(format!(
                    "OPENFORGE_SESSION_DAEMON_{}_KEY",
                    provider.to_uppercase()
                ))
                .ok()
                .filter(|key| !key.is_empty() && key != "*")
                .map(|key| (key, provider.to_string()))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        if key.is_empty() && agent_keys.is_empty() {
            return None;
        }
        Some(Self::with_selection(
            std::env::var_os("OPENFORGE_SESSION_DAEMON_ROOT")?.into(),
            std::env::var_os("OPENFORGE_SESSION_DAEMON_PATH")?.into(),
            key,
            agent_keys,
        ))
    }

    pub(super) fn configure_pr_discovery(
        &self,
        discovery: crate::github_runtime::task_pr_discovery::Discovery,
    ) {
        self.transport.configure_pr_discovery(discovery);
    }

    pub(crate) fn publisher(&self) -> RuntimeEventPublisher {
        self.transport.publisher()
    }

    pub(crate) fn owns(&self, key: &str) -> bool {
        self.selection.owns(key)
    }
    pub(crate) fn owns_agent(&self, key: &str) -> bool {
        self.selection.agent_keys.contains_key(key)
    }
    pub(crate) fn selects_provider(&self, key: &str, command: &str) -> bool {
        self.selection
            .agent_keys
            .get(key)
            .is_some_and(|provider| provider == command)
    }

    pub(crate) async fn terminate_for_task(
        &self,
        task_id: String,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        self.run(publisher, move |client, selection| {
            for session in client.inventory()?.sessions {
                if selected_shell(selection, &session.session_key)
                    && super::pids::is_shell_session_key_for_task(&session.session_key, &task_id)
                {
                    client.terminate(&format!("stop-{}", session.pty.instance), &session.pty)?;
                }
            }
            Ok(())
        })
        .await
    }

    pub(crate) fn for_key(&self, key: &str) -> Self {
        Self {
            transport: self.transport.clone(),
            selection: Arc::clone(&self.selection),
            key: Some(key.into()),
            fence: None,
        }
    }

    pub(crate) fn fenced(mut self, fence: Option<CommandFence>) -> Self {
        self.fence = fence;
        self
    }

    fn key(&self) -> &str {
        self.key.as_deref().unwrap_or(&self.selection.shell_key)
    }

    pub(crate) fn prepare_shell(
        &self,
        cwd: PathBuf,
        columns: u16,
        rows: u16,
        protocol: Option<super::TerminalImageProtocol>,
    ) -> Result<ShellCommand, String> {
        let cwd = std::fs::canonicalize(cwd).map_err(|error| error.to_string())?;
        if !cwd.is_dir() {
            return Err("shell cwd is not a directory".into());
        }
        let mut env: std::collections::BTreeMap<String, String> = std::env::vars().collect();
        env.extend(crate::user_environment::user_environment());
        env.insert("PWD".into(), cwd.to_string_lossy().into_owned());
        for (key, value) in super::terminal_environment(protocol) {
            env.insert(key.into(), value.into());
        }
        let (task_id, index) = self
            .key()
            .rsplit_once("-shell-")
            .ok_or("expected an indexed shell key")?;
        let index = index.parse::<u32>().map_err(|_| "invalid shell index")?;
        Ok(ShellCommand {
            owner: openforge_session_host::TerminalOwner::Shell {
                task_id: task_id.into(),
                index: Some(index),
            },
            command: openforge_session_host::PreparedCommand {
                program: super::commands::get_shell_path(),
                args: Vec::new(),
                cwd,
                env,
            },
            columns,
            rows,
            image_protocol: protocol,
        })
    }

    pub(crate) async fn inventory(
        &self,
        publisher: RuntimeEventPublisher,
    ) -> Result<serde_json::Value, String> {
        let selection = Arc::clone(&self.selection);
        self.run(publisher, move |client, key| {
            let inventory = client.inventory()?;
            let sessions: Vec<_> = inventory
                .sessions
                .into_iter()
                .filter(|session| {
                    selected_shell(key, &session.session_key)
                        || selection.agent_keys.contains_key(&session.session_key)
                })
                .map(|session| {
                    serde_json::json!({
                        "key": session.session_key,
                        "instanceId": session.pty.instance.value(),
                        "isLive": session.exit_code.is_none(),
                    })
                })
                .collect();
            Ok(serde_json::json!({ "controller": inventory.controller, "sessions": sessions }))
        })
        .await
    }

    pub(crate) async fn spawn(
        &self,
        command: ShellCommand,
        publisher: RuntimeEventPublisher,
    ) -> Result<u64, String> {
        let discovery = self.transport.completion();
        self.run(publisher, move |client, key| {
            if let Some(session) = find(client, key)? {
                if session.owner != command.owner {
                    return Err(Error::StalePty);
                }
                return if session.exit_code.is_none() {
                    if let (
                        Some(discovery),
                        openforge_session_protocol::TerminalOwner::Agent { task_id },
                    ) = (&discovery, &command.owner)
                    {
                        discovery.ensure_agent(
                            task_id,
                            command.command.cwd.clone(),
                            session.pty.instance.value(),
                        );
                    }
                    Ok(session.pty.instance.value())
                } else {
                    Err(Error::StalePty)
                };
            }
            use sha2::Digest;
            let hash = sha2::Sha256::digest(key.as_bytes());
            let operation = format!("spawn-{:x}", hash);
            let instance = client.spawn(&operation, &command)?.pty.instance.value();
            if let (Some(discovery), openforge_session_protocol::TerminalOwner::Agent { task_id }) =
                (&discovery, &command.owner)
            {
                discovery.ensure_agent(task_id, command.command.cwd.clone(), instance);
            }
            Ok(instance)
        })
        .await
    }

    pub(crate) async fn agent_sessions(&self) -> Result<Vec<Session>, String> {
        let selection = Arc::clone(&self.selection);
        self.run(self.publisher(), move |client, _| {
            Ok(client
                .inventory()?
                .sessions
                .into_iter()
                .filter(|session| selection.agent_keys.contains_key(&session.session_key))
                .collect())
        })
        .await
    }

    pub(crate) async fn session(&self) -> Result<Option<Session>, String> {
        self.run(self.publisher(), find).await
    }

    pub(crate) async fn shell_only(&self) -> Result<Self, String> {
        let fence = self
            .run(self.publisher(), |client, key| {
                let Some(session) = find(client, key)? else {
                    return Ok(None);
                };
                if !matches!(
                    session.owner,
                    openforge_session_protocol::TerminalOwner::Shell { .. }
                ) || session.owner.session_key() != key
                {
                    return Err(Error::StalePty);
                }
                Ok(Some(CommandFence {
                    controller: client.controller().clone(),
                    instance_id: session.pty.instance.value(),
                }))
            })
            .await?;
        Ok(self.clone().fenced(fence))
    }

    pub(super) async fn session_client(&self) -> Result<Option<(Client, Session)>, String> {
        self.run(self.publisher(), |client, key| {
            Ok(find(client, key)?.map(|session| (client.clone(), session)))
        })
        .await
    }

    /// Captures the existing controller and exact PTY, never reacquiring ownership.
    pub(crate) async fn pin(&self, instance_id: u64) -> Result<Self, String> {
        let fence = self
            .run(self.publisher(), move |client, key| {
                let session = find(client, key)?.ok_or(Error::StalePty)?;
                if session.pty.instance.value() != instance_id || session.exit_code.is_some() {
                    return Err(Error::StalePty);
                }
                Ok(CommandFence {
                    controller: client.controller().clone(),
                    instance_id,
                })
            })
            .await?;
        Ok(self.clone().fenced(Some(fence)))
    }

    pub(crate) async fn write(
        &self,
        data: Vec<u8>,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        self.run(publisher, move |client, key| {
            let session = find(client, key)?.ok_or(Error::StalePty)?;
            client.write(
                &uuid::Uuid::new_v4().to_string(),
                &session.pty,
                session.next_io_sequence.ok_or(Error::Capacity)?,
                &data,
            )
        })
        .await
    }

    pub(crate) async fn resize(
        &self,
        columns: u16,
        rows: u16,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        self.run(publisher, move |client, key| {
            let session = find(client, key)?.ok_or(Error::StalePty)?;
            client.resize(
                &uuid::Uuid::new_v4().to_string(),
                &session.pty,
                session.next_io_sequence.ok_or(Error::Capacity)?,
                columns,
                rows,
            )
        })
        .await
    }

    pub(crate) async fn terminate(&self, publisher: RuntimeEventPublisher) -> Result<(), String> {
        self.run(publisher, move |client, key| {
            if let Some(session) = find(client, key)? {
                client.terminate(&format!("stop-{}", session.pty.instance), &session.pty)?;
            }
            Ok(())
        })
        .await
    }

    pub(crate) async fn buffer(
        &self,
        publisher: RuntimeEventPublisher,
    ) -> Result<PtyBufferState, String> {
        self.run(publisher, move |client, key| {
            let session = find(client, key)?;
            let Some(session) = session else {
                return Ok(PtyBufferState {
                    buffer: None,
                    snapshot: None,
                    is_live: false,
                    instance_id: None,
                });
            };
            let snapshot = match client.recover(&session.pty) {
                Ok(snapshot) => {
                    let base64 = base64::engine::general_purpose::STANDARD;
                    Some(TerminalViewSnapshot {
                        instance_id: snapshot.pty.instance.value(),
                        watermark: snapshot.watermark,
                        data: base64.encode(snapshot.portable_vt),
                        compatibility_data: base64.encode(snapshot.compatibility_replay),
                        continuation_data: base64.encode(snapshot.continuation),
                    })
                }
                Err(Error::RecoveryUnavailable | Error::Capacity)
                    if session.exit_code.is_some() =>
                {
                    None
                }
                Err(error) => return Err(error),
            };
            Ok(PtyBufferState {
                buffer: None,
                is_live: session.exit_code.is_none(),
                instance_id: Some(session.pty.instance.value()),
                snapshot,
            })
        })
        .await
    }

    pub(crate) async fn register_agent_endpoint(
        &self,
        publisher: RuntimeEventPublisher,
        endpoint: Option<openforge_session_protocol::SidecarEndpoint>,
    ) -> Result<(), String> {
        self.run(publisher, move |client, _| {
            client.register_sidecar(endpoint)
        })
        .await
    }

    pub(crate) async fn validate_agent_owner(
        &self,
        publisher: RuntimeEventPublisher,
        task: String,
        session: String,
        installation: String,
        instance: u64,
    ) -> Result<(), String> {
        self.run(publisher, move |client, _| {
            let inventory = client.inventory()?;
            if inventory.controller.installation.as_str() != installation {
                return Err(Error::ForeignInstallation);
            }
            let owned_key =
                session == task || super::pids::is_shell_session_key_for_task(&session, &task);
            if owned_key
                && inventory.sessions.iter().any(|live| {
                    live.session_key == session
                        && live.pty.instance.value() == instance
                        && live.exit_code.is_none()
                })
            {
                Ok(())
            } else {
                Err(Error::StalePty)
            }
        })
        .await
    }

    async fn run<T: Send + 'static>(
        &self,
        publisher: RuntimeEventPublisher,
        operation: impl FnOnce(&Client, &str) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, String> {
        self.transport
            .run(
                self.key().to_owned(),
                self.fence.clone(),
                publisher,
                operation,
            )
            .await
    }
}

fn indexed_shell_key(key: &str) -> bool {
    key.rsplit_once("-shell-").is_some_and(|(task, index)| {
        !task.is_empty()
            && index
                .parse::<u32>()
                .is_ok_and(|value| value.to_string() == index)
    })
}

fn selected_shell(selection: &str, key: &str) -> bool {
    selection == key || (selection == "*" && indexed_shell_key(key))
}

fn find(client: &Client, key: &str) -> Result<Option<Session>, Error> {
    Ok(client
        .inventory()?
        .sessions
        .into_iter()
        .filter(|s| s.session_key == key)
        .max_by_key(|s| s.pty.instance.value()))
}
