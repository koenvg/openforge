use std::{
    future::Future,
    sync::{Arc, Mutex, OnceLock},
};

use crate::db::Database;

fn secure_config_access_lock() -> &'static tokio::sync::Mutex<()> {
    static SECURE_CONFIG_ACCESS_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    SECURE_CONFIG_ACCESS_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn with_secure_config_access<T>(operation: impl Future<Output = T>) -> T {
    let _guard = secure_config_access_lock().lock().await;
    operation.await
}

async fn get_with<ReadSecret, ReadSecretFuture>(
    db: &Arc<Mutex<Database>>,
    key: &str,
    read_secret: ReadSecret,
) -> Result<Option<String>, String>
where
    ReadSecret: FnOnce(String) -> ReadSecretFuture,
    ReadSecretFuture: Future<Output = Result<Option<String>, String>>,
{
    with_secure_config_access(async {
        if let Some(secret) = read_secret(key.to_string())
            .await
            .map_err(|error| format!("credential store read failed: {error}"))?
        {
            return Ok(Some(secret));
        }

        let db = crate::db::acquire_db(db);
        db.get_config(key)
            .map_err(|error| format!("database fallback read failed: {error}"))
    })
    .await
}

pub(crate) async fn get(db: &Arc<Mutex<Database>>, key: &str) -> Result<Option<String>, String> {
    get_with(db, key, |key| async move {
        crate::secure_store::get_secret_async(&key).await
    })
    .await
}

async fn set_with<WriteSecret, WriteSecretFuture>(
    db: &Arc<Mutex<Database>>,
    key: &str,
    value: &str,
    write_secret: WriteSecret,
) -> Result<(), String>
where
    WriteSecret: FnOnce(String, String) -> WriteSecretFuture,
    WriteSecretFuture: Future<Output = Result<(), String>>,
{
    with_secure_config_access(async {
        write_secret(key.to_string(), value.to_string())
            .await
            .map_err(|error| format!("credential store write failed: {error}"))?;

        let db = crate::db::acquire_db(db);
        db.set_config(key, "")
            .map_err(|error| format!("database secret clear failed: {error}"))
    })
    .await
}

pub(crate) async fn set(db: &Arc<Mutex<Database>>, key: &str, value: &str) -> Result<(), String> {
    set_with(db, key, value, |key, value| async move {
        crate::secure_store::set_secret_async(&key, &value).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    #[tokio::test]
    async fn secret_config_read_and_write_transactions_do_not_interleave() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("secure_config_transaction_serialization");
        database
            .set_config("github_token", "legacy-token")
            .expect("seed legacy token");
        let database = Arc::new(std::sync::Mutex::new(database));
        let (read_started_tx, read_started_rx) = tokio::sync::oneshot::channel();
        let (release_read_tx, release_read_rx) = tokio::sync::oneshot::channel();
        let (write_started_tx, mut write_started_rx) = tokio::sync::oneshot::channel();

        let read_database = Arc::clone(&database);
        let read = tokio::spawn(async move {
            super::get_with(&read_database, "github_token", move |_| async move {
                let _ = read_started_tx.send(());
                release_read_rx.await.expect("release credential read");
                Ok::<Option<String>, String>(None)
            })
            .await
        });
        read_started_rx.await.expect("credential read should start");

        let write = super::set_with(
            &database,
            "github_token",
            "new-token",
            move |_, _| async move {
                let _ = write_started_tx.send(());
                Ok::<(), String>(())
            },
        );
        tokio::pin!(write);
        tokio::select! {
            biased;
            result = &mut write => panic!("write entered during read transaction: {result:?}"),
            _ = tokio::task::yield_now() => {}
        }
        assert!(
            matches!(
                write_started_rx.try_recv(),
                Err(tokio::sync::oneshot::error::TryRecvError::Empty)
            ),
            "credential write must wait for the read transaction"
        );

        release_read_tx.send(()).expect("release credential read");
        let read_value = read
            .await
            .expect("read task should join")
            .expect("read transaction should succeed");
        assert_eq!(read_value, Some("legacy-token".to_string()));

        write.await.expect("write transaction should succeed");
        write_started_rx
            .await
            .expect("credential write should run after read");
        assert_eq!(
            crate::db::acquire_db(&database)
                .get_config("github_token")
                .expect("read cleared database token"),
            Some(String::new())
        );
    }

    #[tokio::test]
    async fn credential_wait_does_not_hold_database_lock() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("secure_config_credential_wait_database_lock");
        database
            .set_config("github_token", "legacy-token")
            .expect("seed legacy token");
        let database = Arc::new(std::sync::Mutex::new(database));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();

        let read = super::get_with(&database, "github_token", move |_| async move {
            let _ = started_tx.send(());
            release_rx.await.expect("release credential read");
            Ok::<Option<String>, String>(None)
        });
        let inspect_database = async {
            started_rx.await.expect("credential read should start");
            let guard = database
                .try_lock()
                .expect("database lock must remain available during credential read");
            drop(guard);
            let _ = release_tx.send(());
        };

        let (value, ()) = tokio::join!(read, inspect_database);
        assert_eq!(
            value.expect("database fallback"),
            Some("legacy-token".to_string())
        );
    }
}
