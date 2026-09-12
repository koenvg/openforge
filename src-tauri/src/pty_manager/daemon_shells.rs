//! Controlled terminal bridge. Owns no PTY and never stops one on drop.
#[cfg(test)]
use super::PtyManager;
use super::{PtyBufferState, TerminalViewSnapshot};
use crate::app_events::RuntimeEventPublisher;
use base64::Engine;
use openforge_session_client::Client;
use openforge_session_protocol::{Error, Event, Session, ShellCommand};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommandFence {
    controller: openforge_session_protocol::Controller,
    instance_id: u64,
}

#[derive(Clone)]
pub(crate) struct DaemonShells(Arc<Shared>, Option<String>, Option<CommandFence>);
struct Shared {
    root: PathBuf,
    executable: PathBuf,
    key: String,
    pi_key: Option<String>,
    connection: Mutex<Option<Connection>>,
}
struct Connection {
    client: Client,
    cursor: u64,
    publisher: RuntimeEventPublisher,
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
            Some(key),
        ));
    }
}

impl DaemonShells {
    #[cfg(test)]
    pub(crate) fn new(root: PathBuf, executable: PathBuf, key: String) -> Self {
        Self::with_selection(root, executable, key, None)
    }

    fn with_selection(
        root: PathBuf,
        executable: PathBuf,
        key: String,
        pi_key: Option<String>,
    ) -> Self {
        Self(
            Arc::new(Shared {
                root,
                executable,
                key,
                pi_key,
                connection: Mutex::new(None),
            }),
            None,
            None,
        )
    }

    pub(super) fn from_environment() -> Option<Self> {
        if !cfg!(debug_assertions) || std::env::var("OPENFORGE_E2E").as_deref() != Ok("1") {
            return None;
        }
        let key = std::env::var("OPENFORGE_SESSION_DAEMON_SHELL_KEY").unwrap_or_default();
        let pi_key = std::env::var("OPENFORGE_SESSION_DAEMON_PI_KEY")
            .ok()
            .filter(|key| !key.is_empty() && key != "*");
        if key.is_empty() && pi_key.is_none() {
            return None;
        }
        Some(Self::with_selection(
            std::env::var_os("OPENFORGE_SESSION_DAEMON_ROOT")?.into(),
            std::env::var_os("OPENFORGE_SESSION_DAEMON_PATH")?.into(),
            key,
            pi_key,
        ))
    }

    pub(crate) fn publisher(&self) -> RuntimeEventPublisher {
        self.0
            .connection
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|connection| connection.publisher.clone()))
            .unwrap_or_else(|| RuntimeEventPublisher::new(None, None))
    }

    pub(crate) fn owns(&self, key: &str) -> bool {
        selected_shell(&self.0.key, key) || self.owns_pi(key)
    }
    pub(crate) fn owns_pi(&self, key: &str) -> bool {
        self.0.pi_key.as_deref() == Some(key)
    }

    pub(crate) async fn terminate_for_task(
        &self,
        task_id: String,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        self.run(publisher, move |connection, selection| {
            for session in connection.client.inventory()?.sessions {
                if selected_shell(selection, &session.session_key)
                    && super::pids::is_shell_session_key_for_task(&session.session_key, &task_id)
                {
                    connection
                        .client
                        .terminate(&format!("stop-{}", session.pty.instance), &session.pty)?;
                }
            }
            Ok(())
        })
        .await
    }

    pub(crate) fn for_key(&self, key: &str) -> Self {
        Self(Arc::clone(&self.0), Some(key.into()), None)
    }

    pub(crate) fn fenced(mut self, fence: Option<CommandFence>) -> Self {
        self.2 = fence;
        self
    }

    fn key(&self) -> &str {
        self.1.as_deref().unwrap_or(&self.0.key)
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
        let pi_key = self.0.pi_key.clone();
        self.run(publisher, move |connection, key| {
            let inventory = connection.client.inventory()?;
            let sessions: Vec<_> = inventory
                .sessions
                .into_iter()
                .filter(|session| {
                    selected_shell(key, &session.session_key)
                        || pi_key.as_deref() == Some(&session.session_key)
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
        self.run(publisher, move |connection, key| {
            if let Some(session) = find(&connection.client, key)? {
                return if session.exit_code.is_none() {
                    Ok(session.pty.instance.value())
                } else {
                    Err(Error::StalePty)
                };
            }
            use sha2::Digest;
            let hash = sha2::Sha256::digest(key.as_bytes());
            let operation = format!("spawn-{:x}", hash);
            Ok(connection
                .client
                .spawn(&operation, &command)?
                .pty
                .instance
                .value())
        })
        .await
    }

    pub(crate) async fn pi_session(&self) -> Result<Option<Session>, String> {
        match &self.0.pi_key {
            Some(key) => self.for_key(key).session().await,
            None => Ok(None),
        }
    }

    pub(crate) async fn session(&self) -> Result<Option<Session>, String> {
        self.run(self.publisher(), |connection, key| {
            find(&connection.client, key)
        })
        .await
    }

    pub(crate) async fn write(
        &self,
        data: Vec<u8>,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        self.run(publisher, move |connection, key| {
            let session = find(&connection.client, key)?.ok_or(Error::StalePty)?;
            connection.client.write(
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
        self.run(publisher, move |connection, key| {
            let session = find(&connection.client, key)?.ok_or(Error::StalePty)?;
            connection.client.resize(
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
        self.run(publisher, move |connection, key| {
            if let Some(session) = find(&connection.client, key)? {
                connection
                    .client
                    .terminate(&format!("stop-{}", session.pty.instance), &session.pty)?;
            }
            Ok(())
        })
        .await
    }

    pub(crate) async fn buffer(
        &self,
        publisher: RuntimeEventPublisher,
    ) -> Result<PtyBufferState, String> {
        self.run(publisher, move |connection, key| {
            let session = find(&connection.client, key)?;
            let Some(session) = session else {
                return Ok(PtyBufferState {
                    buffer: None,
                    snapshot: None,
                    is_live: false,
                    instance_id: None,
                });
            };
            let snapshot = match connection.client.recover(&session.pty) {
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
        self.run(publisher, move |connection, _| {
            connection.client.register_sidecar(endpoint)
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
        self.run(publisher, move |connection, _| {
            let inventory = connection.client.inventory()?;
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
        operation: impl FnOnce(&mut Connection, &str) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, String> {
        let shared = Arc::clone(&self.0);
        let key = self.key().to_owned();
        let fence = self.2.clone();
        tokio::task::spawn_blocking(move || {
            let mut slot = shared
                .connection
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?;
            if slot.is_none() {
                let client = Client::launch(&shared.executable, &shared.root)?;
                let cursor = client.inventory()?.cursor;
                *slot = Some(Connection {
                    client,
                    cursor,
                    publisher: publisher.clone(),
                });
                let weak = Arc::downgrade(&shared);
                std::thread::Builder::new()
                    .name("daemon-shell-events".into())
                    .spawn(move || {
                        while let Some(shared) = weak.upgrade() {
                            let result = pump(&shared);
                            drop(shared);
                            if matches!(
                                result,
                                Err(Error::StaleController | Error::ForeignInstallation)
                            ) {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(
                                if result.is_ok() { 20 } else { 250 },
                            ));
                        }
                    })
                    .map_err(|error| Error::Host(error.to_string()))?;
            }
            let connection = slot.as_mut().ok_or(Error::OutcomeUnknown)?;
            connection.publisher = publisher;
            if let Some(fence) = fence {
                let inventory = connection.client.inventory()?;
                if inventory.controller != fence.controller {
                    return Err(Error::StaleController);
                }
                let current = inventory
                    .sessions
                    .into_iter()
                    .find(|session| session.session_key == key);
                if current.is_none_or(|session| session.pty.instance.value() != fence.instance_id) {
                    return Err(Error::StalePty);
                }
            }
            operation(connection, &key)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
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

fn pump(shared: &Shared) -> Result<(), Error> {
    let mut slot = shared
        .connection
        .lock()
        .map_err(|_| Error::OutcomeUnknown)?;
    let Some(connection) = slot.as_mut() else {
        return Ok(());
    };
    let batch = connection.client.events(connection.cursor)?;
    let current: Vec<_> = connection
        .client
        .inventory()?
        .sessions
        .into_iter()
        .filter(|session| {
            selected_shell(&shared.key, &session.session_key)
                || shared.pi_key.as_deref() == Some(&session.session_key)
        })
        .collect();
    if batch.gap {
        // Existing transport reconciliation requests fresh authority snapshots, not raw replay.
        connection
            .publisher
            .publish("openforge-app-events-reconnected", &serde_json::json!({}));
        for session in &current {
            if batch.events.iter().any(|event| event.is_exit(&session.pty)) {
                connection.publisher.publish(
                    &format!("pty-exit-{}", session.session_key),
                    &serde_json::json!({ "instance_id": session.pty.instance }),
                );
            }
        }
        // A suffix after a missing prefix is not an ordered stream. Recovery restores
        // both terminal state and liveness; never forward this suffix after an exit.
        connection.cursor = batch.cursor;
        return Ok(());
    }
    for session in current {
        for event in &batch.events {
            match event {
                Event::Output { pty, sequence, data } if pty == &session.pty => connection.publisher.publish(&format!("pty-model-output-{}", session.session_key), &serde_json::json!({
                    "instance_id": pty.instance, "start_sequence": sequence, "sequence": sequence, "data": base64::engine::general_purpose::STANDARD.encode(data),
                })),
                Event::Exited { pty, .. } if pty == &session.pty => connection.publisher.publish(&format!("pty-exit-{}", session.session_key), &serde_json::json!({ "instance_id": pty.instance })),
                Event::RecoveryRequired { pty } if pty == &session.pty => connection.publisher.publish(&format!("pty-model-disabled-{}", session.session_key), &serde_json::json!({ "instance_id": pty.instance })),
                _ => {},
            }
        }
    }
    connection.cursor = batch.cursor;
    Ok(())
}
