use crate::{db, pty_manager::PtyManager};
use log::warn;
use std::sync::{Arc, Mutex};

pub(crate) async fn capture_completed_session_replay(
    db: &Arc<Mutex<db::Database>>,
    manager: &PtyManager,
    task_id: &str,
) {
    let replay = manager.get_pty_buffer(task_id).await.unwrap_or_default();
    if let Err(error) =
        crate::db::acquire_db(db).save_completed_agent_terminal_replay(task_id, &replay)
    {
        warn!(
            "[completed_session_replay] Failed to persist replay for task {}: {}",
            task_id, error
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn completion_capture_persists_terminal_replay() {
        let (database, _database_dir) =
            crate::db::test_helpers::make_test_db("completed_session_replay_capture");
        let project = database
            .create_project("Replay Project", "/tmp/replay-project")
            .expect("create project");
        let task = database
            .create_task("Capture replay", "doing", Some(&project.id), None, None)
            .expect("create task");
        database
            .create_agent_session(
                "completed-session",
                &task.id,
                None,
                "implementing",
                "completed",
                "pi",
            )
            .expect("create completed Agent Session");
        let database = Arc::new(Mutex::new(database));

        let mut manager = PtyManager::new();
        let pty_dir = tempfile::tempdir().expect("PTY temp directory");
        manager.set_pid_dir(pty_dir.path().join("pids"));
        manager
            .spawn_companion_test_agent_pty(
                &task.id,
                pty_dir.path(),
                "printf 'captured output'; sleep 5",
            )
            .await
            .expect("spawn Agent Session PTY");

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if manager
                    .get_pty_buffer(&task.id)
                    .await
                    .is_some_and(|output| output.contains("captured output"))
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Agent Session output deadline");

        capture_completed_session_replay(&database, &manager, &task.id).await;

        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task.id)
                .expect("load captured replay")
                .as_deref(),
            Some("captured output")
        );
        manager.kill_pty(&task.id).await.expect("stop Agent PTY");
    }
}
