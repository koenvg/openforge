//! Shared controller and event lifetime for selected daemon sessions.
//! Dropping the last handle stops polling, never the daemon or its PTYs.
use super::daemon_restart::{Intent, Operation, Phase};
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
    restart_operation: Mutex<Option<Operation>>,
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
            restart_operation: Mutex::new(None),
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

    pub(super) async fn prepare_restart(
        &self,
        operation_id: String,
        intent: Intent,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(&operation_id).map_err(|_| "invalid restart operation")?;
        let shared = Arc::clone(&self.0);
        self.read(String::new(), None, publisher, move |client, _| {
            client.inventory()?;
            let mut operation = shared
                .restart_operation
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?;
            if operation.as_ref().is_some_and(Operation::blocks_mutations) {
                return Err(Error::OperationConflict);
            }
            let prepared = Operation::new(operation_id, client.controller().clone(), intent)?;
            *operation = Some(prepared.clone());
            prepared.persist(&shared.root)?;
            // Scoped sessions are explicitly not resumable. Their verified daemon
            // process groups must stop before the preservation handoff.
            for session in client.inventory()?.sessions {
                if openforge_session_host::scoped_agent_digest(&session.session_key).is_some()
                    && session.exit_code.is_none()
                {
                    client.terminate(
                        &format!("restart-scoped-{}", session.pty.instance),
                        &session.pty,
                    )?;
                }
            }
            Ok(())
        })
        .await
    }

    pub(super) async fn transition_restart(
        &self,
        operation_id: String,
        from: Phase,
        to: Phase,
        publisher: RuntimeEventPublisher,
    ) -> Result<(), String> {
        let shared = Arc::clone(&self.0);
        self.read(String::new(), None, publisher, move |client, _| {
            client.inventory()?;
            let mut slot = shared
                .restart_operation
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?;
            let operation = slot.as_mut().ok_or(Error::OperationConflict)?;
            if operation.operation_id == operation_id && operation.phase == to {
                return Ok(());
            }
            if operation.operation_id != operation_id
                || operation.phase != from
                || operation.controller != *client.controller()
            {
                return Err(Error::OperationConflict);
            }
            // Retain the safe intent even if the fsync acknowledgement is lost.
            operation.phase = to;
            operation.persist(&shared.root)?;
            if to == Phase::Detached {
                client.register_sidecar(None)?;
            }
            Ok(())
        })
        .await
    }

    pub(super) async fn shutdown(&self, publisher: RuntimeEventPublisher) -> Result<(), String> {
        let shared = Arc::clone(&self.0);
        self.read(String::new(), None, publisher, move |client, _| {
            let mut slot = shared
                .restart_operation
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?;
            if slot.as_ref().is_some_and(Operation::preserves_sessions) {
                return Ok(());
            }
            let inventory = client.inventory()?;
            let operation = Operation::new(
                uuid::Uuid::new_v4().to_string(),
                client.controller().clone(),
                Intent::Quit,
            )?;
            *slot = Some(operation.clone());
            operation.persist(&shared.root)?;
            for session in inventory.sessions {
                if session.exit_code.is_none() {
                    client.terminate(&format!("quit-{}", session.pty.instance), &session.pty)?;
                }
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                match client.shutdown_empty() {
                    Ok(()) => break,
                    Err(Error::InvalidRequest) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(20))
                    }
                    Err(error) => return Err(error),
                }
            }
            let mut completed = operation;
            completed.phase = Phase::Committed;
            completed.persist(&shared.root)?;
            Ok(())
        })
        .await
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
        self.run_admitted(key, fence, publisher, false, operation)
            .await
    }

    pub(super) async fn read<T: Send + 'static>(
        &self,
        key: String,
        fence: Option<CommandFence>,
        publisher: RuntimeEventPublisher,
        operation: impl FnOnce(&Client, &str) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, String> {
        self.run_admitted(key, fence, publisher, true, operation)
            .await
    }

    async fn run_admitted<T: Send + 'static>(
        &self,
        key: String,
        fence: Option<CommandFence>,
        publisher: RuntimeEventPublisher,
        allow_fenced: bool,
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
                *shared
                    .restart_operation
                    .lock()
                    .map_err(|_| Error::OutcomeUnknown)? =
                    Operation::reconnect(&shared.root, &client)?;
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
            if !allow_fenced
                && shared
                    .restart_operation
                    .lock()
                    .map_err(|_| Error::OutcomeUnknown)?
                    .as_ref()
                    .is_some_and(Operation::blocks_mutations)
            {
                return Err(Error::Host(
                    "restart preparing; request not executed".into(),
                ));
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
                    .filter(|session| session.session_key == key)
                    .max_by_key(|session| session.pty.instance.value());
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
