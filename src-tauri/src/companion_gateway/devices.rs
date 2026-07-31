use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

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

pub(crate) trait CompanionDeviceStore: Send + Sync {
    fn save(&self, record: &CompanionDeviceRecord) -> Result<(), String>;
    fn list(&self) -> Result<Vec<CompanionDeviceRecord>, String>;
    fn mark_seen(&self, device_id: &str, seen_at: i64) -> Result<(), String>;
    fn revoke(&self, device_id: &str, revoked_at: i64) -> Result<bool, String>;
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

    fn mark_seen(&self, device_id: &str, seen_at: i64) -> Result<(), String> {
        let connection = self.connection()?;
        let connection = connection
            .lock()
            .map_err(|_| "Companion device connection lock was poisoned".to_string())?;
        connection
            .execute(
                "UPDATE companion_devices SET last_seen_at = ?2 WHERE device_id = ?1",
                rusqlite::params![device_id, seen_at],
            )
            .map(|_| ())
            .map_err(|error| format!("failed to update Companion device activity: {error}"))
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
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct InMemoryCompanionDeviceStore {
    records: Mutex<Vec<CompanionDeviceRecord>>,
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

    fn mark_seen(&self, device_id: &str, seen_at: i64) -> Result<(), String> {
        if let Some(record) = self
            .records
            .lock()
            .map_err(|_| "test Companion device store lock was poisoned".to_string())?
            .iter_mut()
            .find(|record| record.device_id == device_id)
        {
            record.last_seen_at = Some(seen_at);
        }
        Ok(())
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
}
