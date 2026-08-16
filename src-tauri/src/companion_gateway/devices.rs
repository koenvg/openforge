use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;

#[derive(Debug, Clone)]
pub(crate) struct CompanionDeviceRecord {
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
    pub(crate) credential_verifier: [u8; 32],
    pub(crate) paired_at: i64,
    pub(crate) last_seen_at: Option<i64>,
    pub(crate) revoked_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CompanionDeviceAuthentication {
    Active { device_id: String },
    Revoked,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionDeviceRemoval {
    Removed,
    Active,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionDeviceRevocationBatch {
    device_ids: Vec<String>,
    revoked_at: i64,
}

impl CompanionDeviceRevocationBatch {
    pub(crate) fn len(&self) -> usize {
        self.device_ids.len()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionPairedDevice {
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
    pub(crate) paired_at: String,
    pub(crate) last_seen_at: Option<String>,
    pub(crate) revoked_at: Option<String>,
}

impl From<&CompanionDeviceRecord> for CompanionPairedDevice {
    fn from(record: &CompanionDeviceRecord) -> Self {
        Self {
            device_id: record.device_id.clone(),
            device_name: record.device_name.clone(),
            platform: record.platform.clone(),
            paired_at: timestamp(record.paired_at),
            last_seen_at: record.last_seen_at.map(timestamp),
            revoked_at: record.revoked_at.map(timestamp),
        }
    }
}

fn timestamp(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap_or_default()
        .to_rfc3339()
}

fn read_records(connection: &rusqlite::Connection) -> Result<Vec<CompanionDeviceRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT device_id, device_name, platform, credential_verifier,
                    paired_at, last_seen_at, revoked_at
             FROM companion_devices
             ORDER BY paired_at DESC, device_id",
        )
        .map_err(|error| format!("failed to prepare Companion device query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let verifier: Vec<u8> = row.get(3)?;
            let credential_verifier = verifier.try_into().map_err(|value: Vec<u8>| {
                rusqlite::Error::FromSqlConversionFailure(
                    value.len(),
                    rusqlite::types::Type::Blob,
                    "Companion credential verifier must be 32 bytes".into(),
                )
            })?;
            Ok(CompanionDeviceRecord {
                device_id: row.get(0)?,
                device_name: row.get(1)?,
                platform: row.get(2)?,
                credential_verifier,
                paired_at: row.get(4)?,
                last_seen_at: row.get(5)?,
                revoked_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("failed to read Companion devices: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to decode Companion device: {error}"))
}

pub(crate) trait CompanionDeviceStore: Send + Sync {
    fn save(&self, record: &CompanionDeviceRecord) -> Result<(), String>;
    fn list(&self) -> Result<Vec<CompanionDeviceRecord>, String>;
    fn authenticate(
        &self,
        credential_verifier: &[u8; 32],
        seen_at: i64,
    ) -> Result<CompanionDeviceAuthentication, String>;
    fn revoke(&self, device_id: &str, revoked_at: i64) -> Result<bool, String>;
    fn remove_revoked(&self, device_id: &str) -> Result<CompanionDeviceRemoval, String>;
    fn revoke_all(&self, revoked_at: i64) -> Result<CompanionDeviceRevocationBatch, String>;
    fn rollback_revoke_all(&self, batch: &CompanionDeviceRevocationBatch) -> Result<(), String>;
}

#[derive(Clone)]
pub(crate) struct DatabaseCompanionDeviceStore {
    database: Arc<Mutex<crate::db::Database>>,
}

impl DatabaseCompanionDeviceStore {
    pub(crate) fn new(database: Arc<Mutex<crate::db::Database>>) -> Self {
        Self { database }
    }

    fn connection(&self) -> Result<Arc<Mutex<rusqlite::Connection>>, String> {
        self.database
            .lock()
            .map(|database| database.connection())
            .map_err(|_| "Companion device database lock was poisoned".to_string())
    }
}

impl CompanionDeviceStore for DatabaseCompanionDeviceStore {
    fn save(&self, record: &CompanionDeviceRecord) -> Result<(), String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        connection
            .execute(
                "INSERT INTO companion_devices (
                    device_id, device_name, platform, credential_verifier,
                    paired_at, last_seen_at, revoked_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    record.device_id,
                    record.device_name,
                    record.platform,
                    record.credential_verifier.as_slice(),
                    record.paired_at,
                    record.last_seen_at,
                    record.revoked_at,
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("failed to persist Companion device: {error}"))
    }

    fn list(&self) -> Result<Vec<CompanionDeviceRecord>, String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        read_records(&connection)
    }

    fn authenticate(
        &self,
        credential_verifier: &[u8; 32],
        seen_at: i64,
    ) -> Result<CompanionDeviceAuthentication, String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        let records = read_records(&connection)?;
        let matched = records.iter().fold(None, |matched, record| {
            if bool::from(record.credential_verifier.ct_eq(credential_verifier)) {
                Some(record)
            } else {
                matched
            }
        });
        let Some(record) = matched else {
            return Ok(CompanionDeviceAuthentication::Missing);
        };
        if record.revoked_at.is_some() {
            return Ok(CompanionDeviceAuthentication::Revoked);
        }
        connection
            .execute(
                "UPDATE companion_devices SET last_seen_at = ?2
                 WHERE device_id = ?1 AND revoked_at IS NULL",
                rusqlite::params![record.device_id, seen_at],
            )
            .map_err(|error| format!("failed to update Companion device activity: {error}"))?;
        Ok(CompanionDeviceAuthentication::Active {
            device_id: record.device_id.clone(),
        })
    }

    fn revoke(&self, device_id: &str, revoked_at: i64) -> Result<bool, String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        connection
            .execute(
                "UPDATE companion_devices
                 SET revoked_at = COALESCE(revoked_at, ?2)
                 WHERE device_id = ?1",
                rusqlite::params![device_id, revoked_at],
            )
            .map(|changed| changed > 0)
            .map_err(|error| format!("failed to revoke Companion device: {error}"))
    }

    fn remove_revoked(&self, device_id: &str) -> Result<CompanionDeviceRemoval, String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        let removed = connection
            .execute(
                "DELETE FROM companion_devices WHERE device_id = ?1 AND revoked_at IS NOT NULL",
                rusqlite::params![device_id],
            )
            .map_err(|error| format!("failed to remove revoked Companion device: {error}"))?;
        if removed > 0 {
            return Ok(CompanionDeviceRemoval::Removed);
        }
        let exists = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM companion_devices WHERE device_id = ?1)",
                rusqlite::params![device_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("failed to inspect Companion device: {error}"))?;
        Ok(if exists {
            CompanionDeviceRemoval::Active
        } else {
            CompanionDeviceRemoval::Missing
        })
    }

    fn revoke_all(&self, revoked_at: i64) -> Result<CompanionDeviceRevocationBatch, String> {
        let connection = self.connection()?;
        let mut connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start Companion device revocation: {error}"))?;
        let device_ids = {
            let mut statement = transaction
                .prepare("SELECT device_id FROM companion_devices WHERE revoked_at IS NULL")
                .map_err(|error| {
                    format!("failed to prepare Companion device revocation: {error}")
                })?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| format!("failed to read revocable Companion devices: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("failed to decode revocable Companion device: {error}"))?
        };
        transaction
            .execute(
                "UPDATE companion_devices SET revoked_at = ?1 WHERE revoked_at IS NULL",
                rusqlite::params![revoked_at],
            )
            .map_err(|error| format!("failed to revoke Companion devices: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit Companion device revocation: {error}"))?;
        Ok(CompanionDeviceRevocationBatch {
            device_ids,
            revoked_at,
        })
    }

    fn rollback_revoke_all(&self, batch: &CompanionDeviceRevocationBatch) -> Result<(), String> {
        let connection = self.connection()?;
        let mut connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start Companion revocation rollback: {error}"))?;
        for device_id in &batch.device_ids {
            transaction
                .execute(
                    "UPDATE companion_devices SET revoked_at = NULL
                     WHERE device_id = ?1 AND revoked_at = ?2",
                    rusqlite::params![device_id, batch.revoked_at],
                )
                .map_err(|error| format!("failed to restore Companion device trust: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("failed to commit Companion revocation rollback: {error}"))
    }
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct InMemoryCompanionDeviceStore {
    records: Mutex<Vec<CompanionDeviceRecord>>,
    fail_next_revoke_all: std::sync::atomic::AtomicBool,
    fail_next_rollback_revoke_all: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
impl InMemoryCompanionDeviceStore {
    pub(crate) fn fail_next_revoke_all(&self) {
        self.fail_next_revoke_all
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn fail_next_rollback_revoke_all(&self) {
        self.fail_next_rollback_revoke_all
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
impl CompanionDeviceStore for InMemoryCompanionDeviceStore {
    fn save(&self, record: &CompanionDeviceRecord) -> Result<(), String> {
        self.records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?
            .push(record.clone());
        Ok(())
    }

    fn list(&self) -> Result<Vec<CompanionDeviceRecord>, String> {
        self.records
            .lock()
            .map(|records| records.clone())
            .map_err(|_| "test Companion device store lock was poisoned".to_string())
    }

    fn authenticate(
        &self,
        credential_verifier: &[u8; 32],
        seen_at: i64,
    ) -> Result<CompanionDeviceAuthentication, String> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?;
        let matched_index = records
            .iter()
            .enumerate()
            .fold(None, |matched, (index, record)| {
                if bool::from(record.credential_verifier.ct_eq(credential_verifier)) {
                    Some(index)
                } else {
                    matched
                }
            });
        let Some(index) = matched_index else {
            return Ok(CompanionDeviceAuthentication::Missing);
        };
        let record = &mut records[index];
        if record.revoked_at.is_some() {
            return Ok(CompanionDeviceAuthentication::Revoked);
        }
        record.last_seen_at = Some(seen_at);
        Ok(CompanionDeviceAuthentication::Active {
            device_id: record.device_id.clone(),
        })
    }

    fn revoke(&self, device_id: &str, revoked_at: i64) -> Result<bool, String> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?;
        let Some(record) = records
            .iter_mut()
            .find(|record| record.device_id == device_id)
        else {
            return Ok(false);
        };
        record.revoked_at.get_or_insert(revoked_at);
        Ok(true)
    }

    fn remove_revoked(&self, device_id: &str) -> Result<CompanionDeviceRemoval, String> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?;
        let Some(index) = records
            .iter()
            .position(|record| record.device_id == device_id)
        else {
            return Ok(CompanionDeviceRemoval::Missing);
        };
        if records[index].revoked_at.is_none() {
            return Ok(CompanionDeviceRemoval::Active);
        }
        records.remove(index);
        Ok(CompanionDeviceRemoval::Removed)
    }

    fn revoke_all(&self, revoked_at: i64) -> Result<CompanionDeviceRevocationBatch, String> {
        if self
            .fail_next_revoke_all
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err("test revoke-all failed".to_string());
        }
        let mut records = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?;
        let mut device_ids = Vec::new();
        for record in records
            .iter_mut()
            .filter(|record| record.revoked_at.is_none())
        {
            record.revoked_at = Some(revoked_at);
            device_ids.push(record.device_id.clone());
        }
        Ok(CompanionDeviceRevocationBatch {
            device_ids,
            revoked_at,
        })
    }

    fn rollback_revoke_all(&self, batch: &CompanionDeviceRevocationBatch) -> Result<(), String> {
        if self
            .fail_next_rollback_revoke_all
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err("test revoke-all rollback failed".to_string());
        }
        let mut records = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?;
        for record in records.iter_mut().filter(|record| {
            batch.device_ids.contains(&record.device_id)
                && record.revoked_at == Some(batch.revoked_at)
        }) {
            record.revoked_at = None;
        }
        Ok(())
    }
}
