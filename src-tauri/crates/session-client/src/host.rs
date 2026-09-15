//! PtyHost transport adapter. Ownership and retry policy execute only in the daemon.
use crate::Client;
use base64::Engine;
use openforge_session_host::*;
use openforge_session_protocol::{Command, Response};

impl Client {
    pub(crate) async fn host_request(&self, command: Command) -> Result<Response, HostError> {
        let client = self.clone();
        tokio::task::spawn_blocking(move || client.request(command).map_err(HostError::from))
            .await
            .map_err(|_| HostError::OutcomeUnknown)?
    }
}
impl PtyHost for Client {
    async fn connect(&self, installation: &InstallationId) -> Result<Connection, HostError> {
        let response = self
            .host_request(Command::Connect {
                installation: installation.clone(),
            })
            .await?;
        let Response::Inventory(inventory) = response else {
            return Err(HostError::OutcomeUnknown);
        };
        // A daemon without this optional command must not advertise live replacement.
        let supports_replacement = matches!(self.host_request(Command::Capabilities).await, Ok(Response::Capabilities(capabilities)) if capabilities.supports_replacement);
        Ok(Connection {
            controller: inventory.controller,
            inventory: inventory.sessions.iter().map(|s| s.hosted()).collect(),
            supports_replacement,
        })
    }
    async fn reconcile(&self, controller: &Controller) -> Result<Vec<HostedSession>, HostError> {
        let response = self
            .host_request(Command::Inventory {
                controller: controller.clone(),
            })
            .await?;
        let Response::Inventory(inventory) = response else {
            return Err(HostError::OutcomeUnknown);
        };
        Ok(inventory.sessions.iter().map(|s| s.hosted()).collect())
    }
    async fn spawn(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: SpawnRequest,
    ) -> Result<PtyIdentity, HostError> {
        let response = self
            .host_request(Command::Spawn {
                controller: controller.clone(),
                operation,
                command: request,
            })
            .await?;
        let Response::Spawned(session) = response else {
            return Err(HostError::OutcomeUnknown);
        };
        Ok(session.pty)
    }
    async fn terminate(
        &self,
        controller: &Controller,
        operation: OperationId,
        pty: &PtyIdentity,
    ) -> Result<(), HostError> {
        let response = self
            .host_request(Command::Terminate {
                controller: controller.clone(),
                operation,
                pty: pty.clone(),
            })
            .await?;
        if matches!(response, Response::Done) {
            Ok(())
        } else {
            Err(HostError::OutcomeUnknown)
        }
    }
    async fn io(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: IoRequest,
    ) -> Result<(), HostError> {
        let response = self
            .host_request(Command::Io {
                controller: controller.clone(),
                operation,
                pty: request.pty,
                sequence: request.sequence,
                action: request.action,
            })
            .await?;
        if matches!(response, Response::Done) {
            Ok(())
        } else {
            Err(HostError::OutcomeUnknown)
        }
    }
    async fn replacement(
        &self,
        controller: &Controller,
        operation: OperationId,
        phase: ReplacementPhase,
    ) -> Result<(), HostError> {
        let client = self.with_controller(controller.clone());
        tokio::task::spawn_blocking(move || {
            client
                .complete_replacement(operation, phase)
                .map_err(HostError::from)
        })
        .await
        .map_err(|_| HostError::OutcomeUnknown)?
    }
    async fn attach_recover(
        &self,
        controller: &Controller,
        pty: &PtyIdentity,
        after: Option<OutputPosition>,
    ) -> Result<HostAttachment, HostError> {
        if let Some(position) = &after {
            position
                .validate_for(pty)
                .map_err(|_| HostError::StaleOutput)?;
        }
        let response = self
            .host_request(Command::Recover {
                controller: controller.clone(),
                pty: pty.clone(),
            })
            .await?;
        let Response::Recovery(recovery) = response else {
            return Err(HostError::RecoveryUnavailable);
        };
        if &recovery.pty != pty {
            return Err(HostError::StalePty);
        }
        if after.is_some_and(|position| position.sequence > recovery.watermark) {
            return Err(HostError::StaleOutput);
        }
        let encoding = base64::engine::general_purpose::STANDARD;
        let snapshot = TerminalViewSnapshot {
            instance_id: pty.instance.value(),
            watermark: recovery.watermark,
            data: encoding.encode(recovery.portable_vt),
            compatibility_data: encoding.encode(recovery.compatibility_replay),
            continuation_data: encoding.encode(recovery.continuation),
        };
        let client = self.with_controller(controller.clone());
        let stream = crate::output::RemoteOutput::new(client.clone(), pty.clone(), recovery.cursor);
        Ok(HostAttachment::from_stream(
            snapshot,
            pty.clone(),
            Box::new(stream),
            Box::new(crate::output::RemoteFence(client)),
        ))
    }
}
