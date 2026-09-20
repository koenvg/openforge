//! Durable Sidecar handoff authorization. All transitions run under the transport lock.
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::{Controller, Error};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum Intent {
    Restart,
    Update,
    Quit,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum Phase {
    Prepared,
    Detached,
    Reconnecting,
    Committed,
    Cancelled,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Operation {
    version: u32,
    pub operation_id: String,
    pub controller: Controller,
    pub intent: Intent,
    pub phase: Phase,
}

impl Operation {
    pub fn new(
        operation_id: String,
        controller: Controller,
        intent: Intent,
    ) -> Result<Self, Error> {
        uuid::Uuid::parse_str(&operation_id).map_err(|_| Error::InvalidRequest)?;
        Ok(Self {
            version: 1,
            operation_id,
            controller,
            intent,
            phase: Phase::Prepared,
        })
    }

    pub fn blocks_mutations(&self) -> bool {
        !matches!(self.phase, Phase::Committed | Phase::Cancelled)
    }

    pub fn preserves_sessions(&self) -> bool {
        self.intent != Intent::Quit && matches!(self.phase, Phase::Detached | Phase::Reconnecting)
    }

    pub fn persist(&self, root: &Path) -> Result<(), Error> {
        let runtime = RuntimeDirectory::open(root)?;
        let temporary = runtime
            .path()
            .join(format!("restart-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&temporary)
                .map_err(host_error)?;
            serde_json::to_writer(&mut file, self).map_err(host_error)?;
            file.sync_all().map_err(host_error)?;
            std::fs::rename(&temporary, runtime.path().join("restart.json")).map_err(host_error)?;
            std::fs::File::open(runtime.path())
                .and_then(|directory| directory.sync_all())
                .map_err(host_error)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    }

    pub fn reconnect(root: &Path, client: &Client) -> Result<Option<Self>, Error> {
        let runtime = RuntimeDirectory::open(root)?;
        let file = match std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(runtime.path().join("restart.json"))
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(host_error(error)),
        };
        let metadata = file.metadata().map_err(host_error)?;
        // SAFETY: geteuid has no pointer arguments and reads only process identity.
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o777 != 0o600
            || metadata.len() > 4096
        {
            return Err(Error::Unauthorized);
        }
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(host_error)?;
        if bytes.len() > 4096 {
            return Err(Error::Capacity);
        }
        let mut operation: Self = serde_json::from_slice(&bytes).map_err(host_error)?;
        if operation.version != 1 || uuid::Uuid::parse_str(&operation.operation_id).is_err() {
            return Err(Error::InvalidRequest);
        }
        if operation.controller.installation != client.controller().installation {
            return Err(Error::ForeignInstallation);
        }
        if matches!(operation.phase, Phase::Committed | Phase::Cancelled) {
            return Ok(Some(operation));
        }
        if operation.controller.lifetime != client.controller().lifetime {
            // The PTY owner was lost. Do not mistake provider history recovery for live attachment.
            operation.phase = Phase::Cancelled;
            operation.persist(root)?;
            return Ok(None);
        }
        if operation.intent == Intent::Quit {
            return Err(Error::Host("previous Quit cleanup is incomplete".into()));
        }
        if operation.phase == Phase::Prepared {
            operation.phase = Phase::Cancelled;
            operation.persist(root)?;
            return Ok(None);
        }
        if std::env::var("OPENFORGE_RESTART_OPERATION").ok().as_deref()
            != Some(&operation.operation_id)
            || client.controller().generation.value() <= operation.controller.generation.value()
        {
            return Err(Error::OperationConflict);
        }
        operation.controller = client.controller().clone();
        operation.phase = Phase::Reconnecting;
        operation.persist(root)?;
        Ok(Some(operation))
    }
}

fn host_error(error: impl std::fmt::Display) -> Error {
    Error::Host(error.to_string())
}
