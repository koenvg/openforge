//! PTY resource adapter. The shared host owns controller, admission, receipt and I/O policy.
use crate::{
    journal::{lock, SharedJournal},
    process::Process,
};
use base64::Engine;
use openforge_session_host::*;
use openforge_session_protocol::{Error, Event, Recovery, Session};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

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
}
#[derive(Clone)]
pub(crate) struct Backend {
    table: Arc<Mutex<Table>>,
    agent_runtime: crate::agent_config::AgentRuntime,
    pub journal: SharedJournal,
}
impl Backend {
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
            })),
            agent_runtime,
            journal: Default::default(),
        }
    }
    fn table(&self) -> Result<MutexGuard<'_, Table>, HostError> {
        self.table.lock().map_err(|_| HostError::OutcomeUnknown)
    }
    pub fn poll(&self) -> Result<(), Error> {
        let mut table = self.table()?;
        for record in table.records.values_mut() {
            record.poll(&self.journal)?;
        }
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
        let process = Process::spawn(&prepared, pty.clone(), Arc::clone(&self.journal))
            .map_err(HostError::from)?;
        let metadata = Session {
            pty,
            session_key: key,
            pid: process.pid(),
            exit_code: None,
            next_io_sequence: Some(1),
        };
        table.records.insert(
            instance.value(),
            Record {
                metadata,
                process: Some(process),
                agent: Some(agent),
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
