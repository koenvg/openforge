//! Shared controller and event lifetime for selected daemon sessions.
//! Dropping the last handle stops polling, never the daemon or its PTYs.
use crate::app_events::RuntimeEventPublisher;
use crate::github_runtime::task_pr_discovery::{daemon::DaemonOutput, Discovery, LocalDiscovery};
use base64::Engine;
use openforge_session_client::Client;
use openforge_session_protocol::{Error, Event};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommandFence {
    pub(super) controller: openforge_session_protocol::Controller,
    pub(super) instance_id: u64,
}

#[derive(Clone)]
pub(super) struct DaemonTransport(Arc<Shared>);

struct Shared {
    root: PathBuf,
    executable: PathBuf,
    selects: Box<dyn Fn(&str) -> bool + Send + Sync>,
    connection: Mutex<Option<Connection>>,
    completion: Mutex<Option<LocalDiscovery>>,
    discovery: LocalDiscovery,
}

struct Connection {
    client: Client,
    cursor: u64,
    publisher: RuntimeEventPublisher,
    discovery: DaemonOutput,
    disconnected: bool,
}

impl DaemonTransport {
    pub(super) fn configure_completion(
        &self,
        discovery: crate::github_runtime::task_pr_discovery::LocalDiscovery,
    ) {
        *self.0.completion.lock().unwrap_or_else(|p| p.into_inner()) = Some(discovery);
    }
    pub(super) fn completion(
        &self,
    ) -> Option<crate::github_runtime::task_pr_discovery::LocalDiscovery> {
        self.0
            .completion
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
    /// Selection is fixed for this controller lifetime, including key-scoped commands.
    pub(super) fn new(
        root: PathBuf,
        executable: PathBuf,
        selects: impl Fn(&str) -> bool + Send + Sync + 'static,
    ) -> Self {
        Self(Arc::new(Shared {
            root,
            executable,
            selects: Box::new(selects),
            connection: Mutex::new(None),
            completion: Mutex::new(None),
            discovery: LocalDiscovery::default(),
        }))
    }

    pub(super) fn configure_pr_discovery(&self, discovery: Discovery) {
        self.0.discovery.configure(discovery);
    }

    pub(super) fn publisher(&self) -> RuntimeEventPublisher {
        self.0
            .connection
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|connection| connection.publisher.clone()))
            .unwrap_or_else(|| RuntimeEventPublisher::new(None, None))
    }

    /// Serializes commands and event polling under the same controller.
    /// A stale controller is never replaced here: reconnect requires a new transport.
    pub(super) async fn run<T: Send + 'static>(
        &self,
        key: String,
        fence: Option<CommandFence>,
        publisher: RuntimeEventPublisher,
        operation: impl FnOnce(&Client, &str) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, String> {
        let shared = Arc::clone(&self.0);
        tokio::task::spawn_blocking(move || {
            let mut slot = shared
                .connection
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?;
            if slot.is_none() {
                let client = Client::launch(&shared.executable, &shared.root)?;
                let cursor = client.inventory()?.cursor;
                let mut discovery = DaemonOutput::new(shared.discovery.clone());
                discovery.resume(cursor);
                *slot = Some(Connection {
                    client,
                    cursor,
                    publisher: publisher.clone(),
                    discovery,
                    disconnected: false,
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
            operation(&connection.client, &key)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
    }
}

fn pump(shared: &Shared) -> Result<(), Error> {
    let mut slot = shared
        .connection
        .lock()
        .map_err(|_| Error::OutcomeUnknown)?;
    let Some(connection) = slot.as_mut() else {
        return Ok(());
    };
    let result = pump_connection(shared, connection);
    if result.is_err() {
        connection.discovery.disconnect();
        connection.disconnected = true;
    }
    result
}

fn pump_connection(shared: &Shared, connection: &mut Connection) -> Result<(), Error> {
    let batch = connection.client.events(connection.cursor)?;
    let inventory = connection.client.inventory()?;
    if connection.disconnected {
        // Resume from current authority, not output accumulated while disconnected.
        connection.cursor = inventory.cursor;
        connection.discovery.resume(inventory.cursor);
        connection.disconnected = false;
        connection
            .publisher
            .publish("openforge-app-events-reconnected", &serde_json::json!({}));
        return Ok(());
    }
    let current: Vec<_> = inventory
        .sessions
        .into_iter()
        .filter(|session| (shared.selects)(&session.session_key))
        .collect();
    connection.discovery.accept(&current, &batch);
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
                Event::Output {
                    pty,
                    sequence,
                    data,
                } if pty == &session.pty => {
                    connection.publisher.publish(
                        &format!("pty-model-output-{}", session.session_key),
                        &serde_json::json!({
                            "instance_id": pty.instance,
                            "start_sequence": sequence,
                            "sequence": sequence,
                            "data": base64::engine::general_purpose::STANDARD.encode(data),
                        }),
                    );
                }
                Event::Exited { pty, code } if pty == &session.pty => {
                    if let openforge_session_protocol::TerminalOwner::Agent { task_id } =
                        &session.owner
                    {
                        if task_id == &session.session_key {
                            if let Some(discovery) = shared
                                .completion
                                .lock()
                                .unwrap_or_else(|p| p.into_inner())
                                .as_ref()
                            {
                                discovery.agent_exited(task_id, pty.instance.value(), *code == 0);
                                discovery.finish(task_id, pty.instance.value());
                            }
                        }
                    }
                    connection.publisher.publish(
                        &format!("pty-exit-{}", session.session_key),
                        &serde_json::json!({ "instance_id": pty.instance }),
                    );
                }
                Event::RecoveryRequired { pty } if pty == &session.pty => {
                    connection.publisher.publish(
                        &format!("pty-model-disabled-{}", session.session_key),
                        &serde_json::json!({ "instance_id": pty.instance }),
                    );
                }
                _ => {}
            }
        }
    }
    connection.cursor = batch.cursor;
    Ok(())
}

#[cfg(test)]
mod tests;
