//! Transport receipts only, never Task/database business logic.
use openforge_session_protocol::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};

pub(crate) struct NotificationJournal {
    conn: Connection,
    id: String,
}

impl NotificationJournal {
    pub fn open(path: &Path) -> Result<Self, Error> {
        // The parent is the installation's protected runtime directory.
        let parent = path
            .parent()
            .ok_or_else(storage)?
            .canonicalize()
            .map_err(|_| storage())?;
        let resolved = parent.join(path.file_name().ok_or_else(storage)?);
        let path = resolved.as_path();
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .or_else(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    std::fs::OpenOptions::new()
                        .read(true)
                        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
                        .open(path)
                } else {
                    Err(e)
                }
            })
            .map_err(|_| storage())?;
        let metadata = file.metadata().map_err(|_| storage())?;
        // SAFETY: geteuid has no arguments or memory preconditions.
        let uid = unsafe { libc::geteuid() };
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != uid
            || metadata.mode() & 0o077 != 0
        {
            return Err(storage());
        }
        let mut conn = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| storage())?;
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|_| storage())?;
        if version > 1 {
            return Err(Error::Version);
        }
        conn.execute_batch("PRAGMA page_size=4096; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA max_page_count=8192;").map_err(|_| storage())?;
        let page_size: u32 = conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .map_err(|_| storage())?;
        let page_count: u32 = conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .map_err(|_| storage())?;
        if page_size != 4096 || page_count > 8192 {
            return Err(Error::Capacity);
        }
        if version == 0 {
            let tx = conn.transaction().map_err(|_| storage())?;
            tx.execute_batch("CREATE TABLE journal (id TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE notifications (position INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL, sender_id TEXT NOT NULL, delivery TEXT NOT NULL, bytes INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, UNIQUE(identity, sender_id));
                PRAGMA user_version=1;").map_err(|_| storage())?;
            tx.execute(
                "INSERT INTO journal(id) VALUES (?1)",
                [uuid::Uuid::new_v4().to_string()],
            )
            .map_err(|_| storage())?;
            tx.commit().map_err(|_| storage())?;
        }
        let id = conn
            .query_row("SELECT id FROM journal", [], |r| r.get(0))
            .map_err(|_| storage())?;
        std::fs::File::open(path.parent().ok_or_else(storage)?)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| storage())?;
        Ok(Self { conn, id })
    }

    pub fn accept(
        &mut self,
        agent: &AgentConfig,
        envelope: NotificationEnvelope,
    ) -> Result<NotificationReceipt, Error> {
        envelope.validate()?;
        if !matches!(agent.owner, TerminalOwner::Agent { .. })
            || envelope.payload.task_id != agent.owner.task_id()
            || envelope.payload.pty_instance_id != agent.pty.instance.value()
        {
            return Err(Error::Unauthorized);
        }
        let identity = serde_json::to_string(&agent.pty).map_err(|_| Error::InvalidRequest)?;
        let tx = self.conn.transaction().map_err(|_| storage())?;
        let previous: Option<(i64, String)> = tx
            .query_row(
                "SELECT position, delivery FROM notifications WHERE identity=?1 AND sender_id=?2",
                params![identity, envelope.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| storage())?;
        if let Some((position, previous)) = previous {
            let previous: NotificationDelivery =
                serde_json::from_str(&previous).map_err(|_| storage())?;
            if previous.envelope != envelope {
                return Err(Error::OperationConflict);
            }
            return Ok(NotificationReceipt {
                journal_id: self.id.clone(),
                position: position.try_into().map_err(|_| storage())?,
            });
        }
        let (count, bytes): (i64, i64) = tx
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM notifications",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| storage())?;
        let position: i64 = tx.query_row("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notifications'), 0) + 1", [], |r| r.get(0)).map_err(|_| storage())?;
        let delivery = NotificationDelivery {
            journal_id: self.id.clone(),
            position: position.try_into().map_err(|_| storage())?,
            pty: agent.pty.clone(),
            session_key: agent.owner.session_key(),
            envelope,
        };
        let serialized = serde_json::to_string(&delivery).map_err(|_| Error::InvalidRequest)?;
        let size = i64::try_from(serialized.len()).map_err(|_| Error::Capacity)?;
        if count >= MAX_NOTIFICATION_RECORDS as i64
            || bytes.saturating_add(size) > MAX_NOTIFICATION_JOURNAL_BYTES as i64
        {
            return Err(Error::Capacity);
        }
        tx.execute("INSERT INTO notifications(position,identity,sender_id,delivery,bytes) VALUES (?1,?2,?3,?4,?5)", params![position, identity, delivery.envelope.id, serialized, size]).map_err(|_| storage())?;
        tx.commit().map_err(|_| storage())?;
        Ok(NotificationReceipt {
            journal_id: self.id.clone(),
            position: delivery.position,
        })
    }

    pub fn next(&self) -> Result<Option<NotificationDelivery>, Error> {
        let serialized: Option<String> = self
            .conn
            .query_row(
                "SELECT delivery FROM notifications WHERE acknowledged=0 ORDER BY position LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| storage())?;
        serialized
            .map(|s| serde_json::from_str(&s).map_err(|_| storage()))
            .transpose()
    }

    pub fn retire_acknowledged(&mut self, live: &[PtyIdentity]) -> Result<(), Error> {
        let live = live
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| storage())?;
        let tx = self.conn.transaction().map_err(|_| storage())?;
        let identities = {
            let mut statement = tx
                .prepare("SELECT DISTINCT identity FROM notifications WHERE acknowledged=1")
                .map_err(|_| storage())?;
            let rows = statement
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| storage())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|_| storage())?
        };
        for identity in identities {
            if !live.contains(&identity) {
                tx.execute(
                    "DELETE FROM notifications WHERE identity=?1 AND acknowledged=1",
                    [identity],
                )
                .map_err(|_| storage())?;
            }
        }
        tx.commit().map_err(|_| storage())
    }

    pub fn acknowledge(&mut self, receipt: &NotificationReceipt) -> Result<(), Error> {
        let Some(next) = self.next()? else {
            return Err(Error::OutOfOrder);
        };
        if receipt.journal_id != self.id || receipt.position != next.position {
            return Err(Error::OutOfOrder);
        }
        let tx = self.conn.transaction().map_err(|_| storage())?;
        let position = i64::try_from(receipt.position).map_err(|_| Error::OutOfOrder)?;
        tx.execute(
            "UPDATE notifications SET acknowledged=1 WHERE position=?1",
            [position],
        )
        .map_err(|_| storage())?;
        tx.execute("UPDATE journal SET acknowledged=?1", [position])
            .map_err(|_| storage())?;
        tx.commit().map_err(|_| storage())
    }
}

fn storage() -> Error {
    Error::Transport("notification journal storage unavailable".into())
}
