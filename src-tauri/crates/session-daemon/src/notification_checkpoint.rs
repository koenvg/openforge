//! Read-only compatibility checks: preflight must not migrate or recreate a journal.
use openforge_session_protocol::{Error, NotificationDelivery};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{fs::OpenOptions, os::unix::fs::{MetadataExt, OpenOptionsExt}, path::{Path, PathBuf}};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NotificationCheckpoint {
    path: PathBuf,
    device: u64,
    inode: u64,
    journal_id: String,
    acknowledged: u64,
    position: u64,
}
impl NotificationCheckpoint {
    pub fn capture(path: &Path) -> Result<Self, Error> {
        let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path).map_err(|_| Error::RecoveryUnavailable)?;
        let metadata = file.metadata().map_err(|_| Error::RecoveryUnavailable)?;
        // SAFETY: geteuid takes no pointers and only reads this process's identity.
        if !metadata.is_file() || metadata.nlink() != 1 || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o777 != 0o600 || metadata.len() > 32 * 1024 * 1024
        { return Err(Error::RecoveryUnavailable); }
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW)
            .map_err(|_| Error::RecoveryUnavailable)?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|_| Error::RecoveryUnavailable)?;
        if version != 1 { return Err(Error::Version); }
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM journal", [], |row| row.get(0)).map_err(|_| Error::RecoveryUnavailable)?;
        if count != 1 { return Err(Error::RecoveryUnavailable); }
        let (journal_id, acknowledged): (String, i64) = connection.query_row("SELECT id, acknowledged FROM journal", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|_| Error::RecoveryUnavailable)?;
        let position: i64 = connection.query_row("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notifications'), 0)", [], |row| row.get(0)).map_err(|_| Error::RecoveryUnavailable)?;
        let acknowledged = u64::try_from(acknowledged).map_err(|_| Error::RecoveryUnavailable)?;
        let position = u64::try_from(position).map_err(|_| Error::RecoveryUnavailable)?;
        if uuid::Uuid::parse_str(&journal_id).is_err() || acknowledged > position { return Err(Error::RecoveryUnavailable); }
        let mut statement = connection.prepare("SELECT delivery FROM notifications ORDER BY position").map_err(|_| Error::RecoveryUnavailable)?;
        let mut rows = statement.query([]).map_err(|_| Error::RecoveryUnavailable)?;
        let mut total = 0usize;
        let mut count = 0usize;
        while let Some(row) = rows.next().map_err(|_| Error::RecoveryUnavailable)? {
            let encoded: String = row.get(0).map_err(|_| Error::RecoveryUnavailable)?;
            count += 1;
            total = total.checked_add(encoded.len()).ok_or(Error::Capacity)?;
            if count > 4096 || total > 32 * 1024 * 1024 { return Err(Error::Capacity); }
            let delivery: NotificationDelivery = serde_json::from_str(&encoded).map_err(|_| Error::Version)?;
            delivery.envelope.validate()?;
            if delivery.journal_id != journal_id || delivery.position == 0 || delivery.position > position { return Err(Error::RecoveryUnavailable); }
        }
        Ok(Self { path: path.into(), device: metadata.dev(), inode: metadata.ino(), journal_id, acknowledged, position })
    }
    pub fn validate(&self) -> Result<(), Error> {
        if Self::capture(&self.path)? != *self { return Err(Error::RecoveryUnavailable); }
        Ok(())
    }
}
