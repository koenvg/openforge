use super::*;
use crate::{
    agent_config::{AgentCredential, AgentRuntime, CredentialCheckpoint},
    journal::Journal,
    process::ProcessCheckpoint,
    quiescence::Paused,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

const MAX_RESOURCES: usize = openforge_session_host::MAX_SESSIONS;
const MAX_RECORDS: usize = openforge_session_host::MAX_SESSIONS;
pub(super) const MAX_RETAINED_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn retained_byte_limit() -> usize {
    #[cfg(feature = "replacement-fixtures")]
    if let Some(limit) = std::env::var("OPENFORGE_TEST_CHECKPOINT_BYTE_LIMIT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|limit| *limit > 0 && *limit < MAX_RETAINED_BYTES)
    {
        return limit;
    }
    MAX_RETAINED_BYTES
}

fn checkpoint_time_budget() -> Duration {
    const MAX_MS: u64 = 4_000;
    #[cfg(feature = "replacement-fixtures")]
    if let Some(milliseconds) = std::env::var("OPENFORGE_TEST_CHECKPOINT_DEADLINE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (1..MAX_MS).contains(value))
    {
        return Duration::from_millis(milliseconds);
    }
    Duration::from_millis(MAX_MS)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedRecord {
    metadata: Session,
    process: Option<ProcessCheckpoint>,
    agent: Option<CredentialCheckpoint>,
    final_recovery: Option<Result<Recovery, Error>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BackendCheckpoint {
    installation: InstallationId,
    lifetime: DaemonLifetimeId,
    next_instance: u64,
    records: Vec<SavedRecord>,
    journal: Journal,
    #[serde(default)]
    color_profile: TerminalColorProfile,
}
impl BackendCheckpoint {
    pub fn descriptors(&self) -> Vec<i32> {
        self.records
            .iter()
            .filter_map(|record| record.process.as_ref().map(|process| process.descriptor.fd))
            .collect()
    }
    pub fn validate_for_image(
        &self,
        installation: &InstallationId,
        state: &openforge_session_host::HostState,
        runtime: &AgentRuntime,
    ) -> Result<(), Error> {
        self.validate_ledger(installation, state)?;
        for record in &self.records {
            if let Some(process) = &record.process {
                process.validate_for_image()?;
            }
            if let Some(agent) = &record.agent {
                agent.validate(runtime)?;
            }
        }
        Ok(())
    }
    pub fn validate_ledger(
        &self,
        installation: &InstallationId,
        state: &openforge_session_host::HostState,
    ) -> Result<(), Error> {
        self.validate(installation, state.lifetime())?;
        if state.installation().is_some_and(|id| id != installation) {
            return Err(Error::ForeignInstallation);
        }
        if state.retained_sessions().len() != self.records.len() {
            return Err(Error::InvalidRequest);
        }
        for session in state.retained_sessions() {
            if !self.records.iter().any(|record| {
                record.metadata.pty == session.pty
                    && record.metadata.session_key == session.session_key
            }) {
                return Err(Error::InvalidRequest);
            }
        }
        Ok(())
    }
    fn validate(
        &self,
        installation: &InstallationId,
        lifetime: &DaemonLifetimeId,
    ) -> Result<(), Error> {
        if &self.installation != installation {
            return Err(Error::ForeignInstallation);
        }
        if &self.lifetime != lifetime {
            return Err(Error::StalePty);
        }
        if self.records.len() > MAX_RECORDS
            || self
                .records
                .iter()
                .filter(|record| record.process.is_some())
                .count()
                > MAX_RESOURCES
        {
            return Err(Error::Capacity);
        }
        self.journal.validate()?;
        self.color_profile.validate().map_err(Error::from)?;
        let mut instances = BTreeSet::new();
        let mut descriptors = BTreeSet::new();
        let mut bytes = 0usize;
        for record in &self.records {
            let pty = &record.metadata.pty;
            if &pty.installation != installation
                || &pty.lifetime != lifetime
                || pty.instance.value() >= self.next_instance
                || !instances.insert(pty.instance.value())
                || record.metadata.session_key.is_empty()
                || record.metadata.session_key.len() > 1024
                || (record.metadata.exit_code.is_none()
                    && (record.process.is_none() || record.agent.is_none()))
                || (record.process.is_none() != record.final_recovery.is_some())
            {
                return Err(Error::InvalidRequest);
            }
            if let Some(process) = &record.process {
                if !process.matches_session(&record.metadata)
                    || !descriptors.insert(process.descriptor.fd)
                {
                    return Err(Error::InvalidRequest);
                }
                bytes = bytes
                    .checked_add(process.retained_bytes())
                    .ok_or(Error::CapacityExceeded(CapacityKind::CheckpointBytes))?;
            }
            if let Some(agent) = &record.agent {
                if &agent.config.pty != pty
                    || agent.config.owner.session_key() != record.metadata.session_key
                {
                    return Err(Error::InvalidRequest);
                }
            }
            if let Some(Ok(recovery)) = &record.final_recovery {
                if &recovery.pty != pty {
                    return Err(Error::InvalidRequest);
                }
                bytes = bytes
                    .checked_add(recovery.portable_vt.len())
                    .and_then(|bytes| bytes.checked_add(recovery.compatibility_replay.len()))
                    .and_then(|bytes| bytes.checked_add(recovery.continuation.len()))
                    .ok_or(Error::CapacityExceeded(CapacityKind::CheckpointBytes))?;
            }
            if bytes > retained_byte_limit() {
                return Err(Error::CapacityExceeded(CapacityKind::CheckpointBytes));
            }
        }
        if self.next_instance == 0 {
            return Err(Error::InvalidRequest);
        }
        Ok(())
    }
}
impl Backend {
    pub fn checkpoint(&self) -> Result<(BackendCheckpoint, Vec<Paused>), Error> {
        let table = self.table()?;
        if table.records.len() > MAX_RECORDS
            || table
                .records
                .values()
                .filter(|record| record.process.is_some())
                .count()
                > MAX_RESOURCES
        {
            return Err(Error::Capacity);
        }
        let deadline = Instant::now() + checkpoint_time_budget();
        let mut pauses = Vec::new();
        for (instance, record) in &table.records {
            if Instant::now() >= deadline {
                return Err(Error::CapacityExceeded(CapacityKind::CheckpointTime));
            }
            if let Some(process) = &record.process {
                pauses.push((*instance, process.pause()?));
            }
        }
        let mut records = Vec::new();
        let mut bytes = 0usize;
        for (instance, record) in &table.records {
            if Instant::now() >= deadline {
                return Err(Error::CapacityExceeded(CapacityKind::CheckpointTime));
            }
            let process = match &record.process {
                Some(process) => {
                    let pause = &pauses
                        .iter()
                        .find(|(paused, _)| paused == instance)
                        .ok_or(Error::InvalidRequest)?
                        .1;
                    let saved = process.checkpoint(pause)?;
                    bytes = bytes
                        .checked_add(saved.retained_bytes())
                        .ok_or(Error::CapacityExceeded(CapacityKind::CheckpointBytes))?;
                    if bytes > retained_byte_limit() {
                        return Err(Error::CapacityExceeded(CapacityKind::CheckpointBytes));
                    }
                    Some(saved)
                }
                None => None,
            };
            records.push(SavedRecord {
                metadata: record.metadata.clone(),
                process,
                agent: record
                    .agent
                    .as_ref()
                    .map(AgentCredential::checkpoint)
                    .transpose()?,
                final_recovery: record.final_recovery.clone(),
            });
        }
        let saved = BackendCheckpoint {
            installation: table.installation.clone(),
            lifetime: table.lifetime.clone(),
            next_instance: table.next_instance,
            records,
            journal: lock(&self.journal).checkpoint()?,
            color_profile: table.color_profile,
        };
        saved.validate(&table.installation, &table.lifetime)?;
        Ok((saved, pauses.into_iter().map(|(_, pause)| pause).collect()))
    }
    pub fn restore(
        saved: BackendCheckpoint,
        installation: &InstallationId,
        lifetime: &DaemonLifetimeId,
        agent_runtime: AgentRuntime,
    ) -> Result<Self, Error> {
        saved.validate(installation, lifetime)?;
        let journal = Arc::new(crate::journal::JournalCell::new(saved.journal));
        let mut records = BTreeMap::new();
        for record in saved.records {
            let agent = record
                .agent
                .map(|agent| AgentCredential::restore(agent, &agent_runtime))
                .transpose()?;
            let process = record
                .process
                .map(|process| Process::restore(process, Arc::clone(&journal)))
                .transpose()?;
            records.insert(
                record.metadata.pty.instance.value(),
                Record {
                    metadata: record.metadata,
                    process,
                    agent,
                    final_recovery: record.final_recovery,
                },
            );
        }
        Ok(Self {
            table: Arc::new(Mutex::new(Table {
                installation: saved.installation,
                lifetime: saved.lifetime,
                next_instance: saved.next_instance,
                records,
                color_profile: saved.color_profile,
            })),
            agent_runtime,
            journal,
        })
    }
    /// # Safety
    /// Exec must have removed all prior owning wrappers. The validated checkpoint must
    /// be the only source of restored resources in this image.
    pub unsafe fn activate_restored(&self) -> Result<(), Error> {
        let mut table = self.table()?;
        for record in table.records.values_mut() {
            if let Some(process) = &mut record.process {
                // SAFETY: uniqueness was validated before any process was reconstructed.
                unsafe {
                    process.activate_restored();
                }
            }
            if let Some(agent) = &mut record.agent {
                agent.activate();
            }
        }
        Ok(())
    }
}
