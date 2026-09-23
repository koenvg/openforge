//! PTY resource adapter. The shared host owns controller, admission, receipt and I/O policy.
#[path = "backend_checkpoint.rs"]
mod checkpoint;
use crate::{
    journal::{lock, SharedJournal},
    process::Process,
};
use base64::Engine;
pub(crate) use checkpoint::BackendCheckpoint;
use openforge_session_host::*;
use openforge_session_protocol::{Error, Event, Recovery, Session};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

pub(crate) const EXIT_HISTORY: usize = 128;
pub(crate) const RESTORE_FD_RESERVE: usize = 64;
const PROCESS_RESERVE: u128 = 64;
const BASE_MEMORY_RESERVE: u128 = 64 * 1024 * 1024;
const PER_PTY_MEMORY_RESERVE: u128 = 2 * 1024 * 1024;

struct ResourceEnvelope {
    descriptor_limit: u128,
    open_descriptors: u128,
    process_limit: u128,
    occupied_processes: u128,
    available_memory: u128,
}
impl ResourceEnvelope {
    fn sample() -> Result<Self, HostError> {
        let limit = |resource| -> Result<u128, HostError> {
            let mut value = std::mem::MaybeUninit::<libc::rlimit>::uninit();
            // SAFETY: getrlimit initializes the supplied rlimit on success.
            if unsafe { libc::getrlimit(resource, value.as_mut_ptr()) } != 0 {
                return Err(HostError::Capacity);
            }
            // SAFETY: successful getrlimit initialized both fields.
            Ok(unsafe { value.assume_init() }.rlim_cur as u128)
        };
        let open_descriptors = std::fs::read_dir("/dev/fd")
            .map_err(|_| HostError::CapacityExceeded(CapacityKind::FileDescriptors))?
            .try_fold(0_u128, |count, entry| {
                entry
                    .map(|_| count + 1)
                    .map_err(|_| HostError::CapacityExceeded(CapacityKind::FileDescriptors))
            })?;
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing().with_user(sysinfo::UpdateKind::Always),
        );
        // SAFETY: geteuid reads the effective UID without dereferencing pointers.
        let uid = sysinfo::Uid::try_from(unsafe { libc::geteuid() } as usize)
            .map_err(|_| HostError::Capacity)?;
        let occupied_processes = system
            .processes()
            .values()
            .filter(|process| process.user_id() == Some(&uid))
            .count() as u128;
        Ok(Self {
            descriptor_limit: limit(libc::RLIMIT_NOFILE)?,
            open_descriptors,
            process_limit: limit(libc::RLIMIT_NPROC)?,
            occupied_processes,
            // macOS can report zero available while inactive pages remain reclaimable.
            available_memory: system.total_memory().saturating_sub(system.used_memory()) as u128,
        })
    }

    fn admit(&self, live: usize) -> Result<(), HostError> {
        self.require(live as u128 + 1)
    }
    fn check_checkpoint(&self, live: usize) -> Result<(), HostError> {
        self.require((live as u128).max(1))
    }
    fn require(&self, next: u128) -> Result<(), HostError> {
        // Three wrappers per PTY can coexist during restore; reserve descriptors
        // for the new PTY, replacement initialization and control traffic.
        if self.open_descriptors + 3 * next + RESTORE_FD_RESERVE as u128 > self.descriptor_limit {
            return Err(HostError::CapacityExceeded(CapacityKind::FileDescriptors));
        }
        if self.occupied_processes + 1 + PROCESS_RESERVE > self.process_limit {
            return Err(HostError::CapacityExceeded(CapacityKind::ProcessSlots));
        }
        if self.available_memory < BASE_MEMORY_RESERVE + next * PER_PTY_MEMORY_RESERVE {
            return Err(HostError::CapacityExceeded(CapacityKind::MemoryHeadroom));
        }
        Ok(())
    }
    fn describe(&self, live: usize) -> openforge_session_protocol::ResourceCapacity {
        let bounded = |value: u128| u64::try_from(value).unwrap_or(u64::MAX);
        openforge_session_protocol::ResourceCapacity {
            open_descriptors: bounded(self.open_descriptors),
            descriptor_limit: bounded(self.descriptor_limit),
            occupied_processes: bounded(self.occupied_processes),
            process_limit: bounded(self.process_limit),
            available_memory_bytes: bounded(self.available_memory),
            spawn_memory_reserve_bytes: bounded(
                BASE_MEMORY_RESERVE + (live as u128 + 1) * PER_PTY_MEMORY_RESERVE,
            ),
            checkpoint_byte_limit: checkpoint::retained_byte_limit() as u64,
        }
    }
}

pub(crate) struct Record {
    metadata: Session,
    process: Option<Process>,
    agent: Option<crate::agent_config::AgentCredential>,
    final_recovery: Option<Result<Recovery, Error>>,
}
impl Record {
    fn poll(&mut self, journal: &SharedJournal) -> Result<(), Error> {
        let Some(process) = self.process.as_mut() else {
            return Ok(());
        };
        let Some(code) = process.poll_exit()? else {
            return Ok(());
        };
        // Inventory exposes the root outcome immediately, before bounded output drain.
        self.metadata.exit_code = Some(code);
        self.agent.take();
        if process.output_drained() {
            let cursor = lock(journal).cursor;
            let recovery = process.recover(cursor);
            if recovery.is_err() {
                lock(journal).publish(Event::RecoveryRequired {
                    pty: self.metadata.pty.clone(),
                });
            }
            self.final_recovery = Some(recovery);
            self.process.take();
            lock(journal).publish(Event::Exited {
                pty: self.metadata.pty.clone(),
                code,
            });
        }
        Ok(())
    }
    fn stop(&mut self, journal: &SharedJournal) -> Result<(), Error> {
        if let Some(process) = &mut self.process {
            process.terminate()?;
        }
        self.poll(journal)
    }
}

struct Table {
    installation: InstallationId,
    lifetime: DaemonLifetimeId,
    next_instance: u64,
    records: BTreeMap<u64, Record>,
    color_profile: TerminalColorProfile,
}
#[derive(Clone)]
pub(crate) struct Backend {
    table: Arc<Mutex<Table>>,
    agent_runtime: crate::agent_config::AgentRuntime,
    pub journal: SharedJournal,
}
impl Backend {
    #[cfg(test)]
    pub(crate) fn color_profiles(
        &self,
    ) -> Result<
        (
            TerminalColorProfile,
            Vec<(PtyIdentity, TerminalColorProfile)>,
        ),
        HostError,
    > {
        let table = self.table()?;
        Ok((
            table.color_profile,
            table
                .records
                .values()
                .filter_map(|record| {
                    record
                        .process
                        .as_ref()
                        .map(|process| (record.metadata.pty.clone(), process.color_profile()))
                })
                .collect(),
        ))
    }

    pub fn new(
        installation: InstallationId,
        lifetime: DaemonLifetimeId,
        agent_runtime: crate::agent_config::AgentRuntime,
    ) -> Self {
        Self {
            table: Arc::new(Mutex::new(Table {
                installation,
                lifetime,
                next_instance: (uuid::Uuid::new_v4().as_u128() as u64 & ((1 << 48) - 1)) | 1,
                records: BTreeMap::new(),
                color_profile: TerminalColorProfile::default(),
            })),
            agent_runtime,
            journal: Default::default(),
        }
    }
    fn table(&self) -> Result<MutexGuard<'_, Table>, HostError> {
        self.table.lock().map_err(|_| HostError::OutcomeUnknown)
    }
    pub fn resource_capacity(
        &self,
    ) -> Result<openforge_session_protocol::ResourceCapacity, HostError> {
        let live = self
            .table()?
            .records
            .values()
            .filter(|record| record.process.is_some())
            .count();
        Ok(ResourceEnvelope::sample()?.describe(live))
    }
    pub fn preflight_checkpoint(&self) -> Result<(), Error> {
        let live = self
            .table()?
            .records
            .values()
            .filter(|record| record.process.is_some())
            .count();
        ResourceEnvelope::sample()?.check_checkpoint(live)?;
        Ok(())
    }
    pub fn poll(&self) -> Result<(), Error> {
        let mut table = self.table()?;
        for record in table.records.values_mut() {
            record.poll(&self.journal)?;
        }
        // An Exited event is already in the journal before a record becomes disposable.
        // Keep the newest settled exits for recovery; older PTY identities stay stale.
        let excess = table
            .records
            .values()
            .filter(|record| record.process.is_none() && record.metadata.exit_code.is_some())
            .count()
            .saturating_sub(EXIT_HISTORY);
        let mut remaining = excess;
        table.records.retain(|_, record| {
            if remaining > 0 && record.process.is_none() && record.metadata.exit_code.is_some() {
                remaining -= 1;
                false
            } else {
                true
            }
        });
        Ok(())
    }
    pub fn session(&self, hosted: &HostedSession) -> Result<Session, HostError> {
        let table = self.table()?;
        let record = table
            .records
            .get(&hosted.pty.instance.value())
            .ok_or(HostError::StalePty)?;
        let mut metadata = record.metadata.clone();
        metadata.next_io_sequence = hosted.next_io_sequence;
        Ok(metadata)
    }
    pub fn empty(&self) -> Result<bool, HostError> {
        Ok(self
            .table()?
            .records
            .values()
            .all(|record| record.process.is_none()))
    }
    pub fn live_agent_identities(&self) -> Result<Vec<PtyIdentity>, Error> {
        Ok(self
            .table()?
            .records
            .values()
            .filter(|record| record.agent.is_some())
            .map(|record| record.metadata.pty.clone())
            .collect())
    }
    pub fn authenticate_agent(
        &self,
        token: &str,
    ) -> Result<openforge_session_protocol::AgentConfig, Error> {
        use subtle::ConstantTimeEq;
        let mut table = self.table()?;
        for record in table.records.values_mut() {
            record.poll(&self.journal)?;
            if let Some(agent) = &record.agent {
                if bool::from(agent.config.token.as_bytes().ct_eq(token.as_bytes())) {
                    return Ok(agent.config.clone());
                }
            }
        }
        Err(Error::Unauthorized)
    }
    pub fn recover(&self, pty: &PtyIdentity, cursor: u64) -> Result<Recovery, Error> {
        let table = self.table()?;
        let record = table
            .records
            .get(&pty.instance.value())
            .filter(|r| &r.metadata.pty == pty)
            .ok_or(Error::StalePty)?;
        if let Some(process) = &record.process {
            return process.recover(cursor);
        }
        let mut recovery = record
            .final_recovery
            .clone()
            .ok_or(Error::RecoveryUnavailable)??;
        recovery.cursor = cursor;
        Ok(recovery)
    }
}
impl HostBackend for Backend {
    async fn set_terminal_color_profile(
        &self,
        profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        let mut table = self.table()?;
        table.color_profile = profile;
        for record in table.records.values() {
            if let Some(process) = &record.process {
                if let Err(error) = process.update_color_profile(profile) {
                    log::warn!("terminal model rejected committed colour profile: {error}");
                }
            }
        }
        Ok(())
    }

    async fn inventory(&self) -> Result<Vec<BackendSession>, HostError> {
        Ok(self
            .table()?
            .records
            .values()
            .map(|record| BackendSession {
                instance: record.metadata.pty.instance,
                session_key: record.metadata.session_key.clone(),
                state: if record.metadata.exit_code.is_none() {
                    HostedSessionState::Live
                } else if record.process.is_some() {
                    HostedSessionState::Cleaning
                } else {
                    HostedSessionState::Exited
                },
            })
            .collect())
    }
    async fn spawn_prepared(&self, request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        if request.columns > 512 || request.rows > 256 {
            return Err(HostError::Capacity);
        }
        let mut table = self.table()?;
        ResourceEnvelope::sample()?.admit(
            table
                .records
                .values()
                .filter(|record| record.process.is_some())
                .count(),
        )?;
        let key = request.owner.session_key();
        for record in table
            .records
            .values_mut()
            .filter(|r| r.metadata.session_key == key)
        {
            record.stop(&self.journal).map_err(HostError::from)?;
        }
        let instance = PtyInstanceId::new(table.next_instance)?;
        table.next_instance = table
            .next_instance
            .checked_add(1)
            .ok_or(HostError::Capacity)?;
        let pty = PtyIdentity {
            installation: table.installation.clone(),
            lifetime: table.lifetime.clone(),
            instance,
        };
        let mut prepared = request.clone();
        let agent = self
            .agent_runtime
            .prepare(&mut prepared, pty.clone())
            .map_err(HostError::from)?;
        let cwd = request.command.cwd.canonicalize().ok();
        let process = Process::spawn(
            &prepared,
            pty.clone(),
            Arc::clone(&self.journal),
            table.color_profile,
        )
        .map_err(HostError::from)?;
        let metadata = Session {
            pty,
            session_key: key,
            owner: request.owner.clone(),
            cwd,
            pid: process.pid(),
            exit_code: None,
            next_io_sequence: Some(1),
        };
        table.records.insert(
            instance.value(),
            Record {
                metadata,
                process: Some(process),
                agent,
                final_recovery: None,
            },
        );
        Ok(instance)
    }
    async fn terminate_exact(&self, session: &HostedSession) -> Result<(), HostError> {
        let mut table = self.table()?;
        let record = table
            .records
            .get_mut(&session.pty.instance.value())
            .filter(|r| r.metadata.pty == session.pty)
            .ok_or(HostError::StalePty)?;
        record.stop(&self.journal).map_err(HostError::from)
    }
    async fn operate(&self, session: &HostedSession, action: &IoAction) -> Result<(), HostError> {
        if matches!(action, IoAction::Resize { columns, rows } if *columns > 512 || *rows > 256) {
            return Err(HostError::Capacity);
        }
        let table = self.table()?;
        let record = table
            .records
            .get(&session.pty.instance.value())
            .filter(|r| r.metadata.pty == session.pty && r.metadata.exit_code.is_none())
            .ok_or(HostError::StalePty)?;
        record
            .process
            .as_ref()
            .ok_or(HostError::StalePty)?
            .operate(action)
            .map_err(HostError::from)
    }
    async fn attach(&self, session: &HostedSession) -> Result<BackendAttachment, HostError> {
        let cursor = lock(&self.journal).cursor;
        let recovery = self
            .recover(&session.pty, cursor)
            .map_err(HostError::from)?;
        let encoding = base64::engine::general_purpose::STANDARD;
        Ok(BackendAttachment {
            snapshot: TerminalViewSnapshot {
                instance_id: session.pty.instance.value(),
                watermark: recovery.watermark,
                data: encoding.encode(recovery.portable_vt),
                compatibility_data: encoding.encode(recovery.compatibility_replay),
                continuation_data: encoding.encode(recovery.continuation),
            },
            output: Box::new(crate::output::JournalOutput::new(
                Arc::clone(&self.journal),
                session.pty.clone(),
                cursor,
            )),
        })
    }
}

#[cfg(test)]
mod capacity_tests {
    use super::*;

    #[test]
    fn provisioned_256_is_accepted_but_each_resource_can_refuse_admission() {
        let mut envelope = ResourceEnvelope {
            descriptor_limit: 2_000,
            open_descriptors: 20,
            process_limit: 1_000,
            occupied_processes: 100,
            available_memory: 2 * 1024 * 1024 * 1024,
        };
        assert_eq!(envelope.admit(255), Ok(()));
        assert_eq!(envelope.check_checkpoint(256), Ok(()));
        envelope.descriptor_limit = 100;
        assert_eq!(
            envelope.check_checkpoint(10),
            Err(HostError::CapacityExceeded(CapacityKind::FileDescriptors))
        );
        assert_eq!(
            envelope.admit(10),
            Err(HostError::CapacityExceeded(CapacityKind::FileDescriptors))
        );
        envelope.descriptor_limit = 2_000;
        envelope.process_limit = 160;
        assert_eq!(
            envelope.admit(255),
            Err(HostError::CapacityExceeded(CapacityKind::ProcessSlots))
        );
        envelope.process_limit = 1_000;
        envelope.available_memory = 128 * 1024 * 1024;
        assert_eq!(
            envelope.admit(255),
            Err(HostError::CapacityExceeded(CapacityKind::MemoryHeadroom))
        );
    }
}
