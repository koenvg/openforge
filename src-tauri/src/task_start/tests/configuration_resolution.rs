use super::super::*;
use super::support::*;

#[derive(Clone, Copy, Debug)]
enum UnreadableConfigScope {
    Task,
    Project,
    Global,
}

async fn assert_unreadable_config_rejects_task_start(
    test_name: &str,
    key: &str,
    scope: UnreadableConfigScope,
) {
    let (state, _temp_dir) = crate::app_invoke::test_support::test_state(test_name);
    let (project_id, task_id) = backlog_task_with_project(&state);
    {
        let db = db::acquire_db(&state.db);
        let conn = db.lock_conn().expect("lock database");
        match scope {
            UnreadableConfigScope::Task => conn.execute(
                "INSERT INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                rusqlite::params![&task_id, key, vec![0xff_u8]],
            ),
            UnreadableConfigScope::Project => conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
                rusqlite::params![&project_id, key, vec![0xff_u8]],
            ),
            UnreadableConfigScope::Global => conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, vec![0xff_u8]],
            ),
        }
        .expect("store unreadable config");
    }

    let error = service_for_state(&state)
        .with_provider_launcher(Arc::new(SuccessfulProviderLauncher))
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("unreadable config must reject Task Start");
    let TaskStartError::Persistence(message) = error else {
        panic!("expected persistence error for {scope:?}, got {error:?}");
    };
    assert!(message.contains(key));
    assert!(message.contains(&task_id));
    assert!(message.contains("Invalid column type"));

    drop(state);
}

#[tokio::test]
async fn safe_start_reports_unreadable_cleanup_config_at_each_scope() {
    for (test_name, scope) in [
        (
            "task_start_unreadable_task_cleanup_config",
            UnreadableConfigScope::Task,
        ),
        (
            "task_start_unreadable_project_cleanup_config",
            UnreadableConfigScope::Project,
        ),
        (
            "task_start_unreadable_global_cleanup_config",
            UnreadableConfigScope::Global,
        ),
    ] {
        assert_unreadable_config_rejects_task_start(test_name, "code_cleanup_tasks_enabled", scope)
            .await;
    }
}

#[tokio::test]
async fn safe_start_reports_unreadable_provider_config_at_each_scope() {
    for (test_name, scope) in [
        (
            "task_start_unreadable_task_provider_config",
            UnreadableConfigScope::Task,
        ),
        (
            "task_start_unreadable_project_provider_config",
            UnreadableConfigScope::Project,
        ),
        (
            "task_start_unreadable_global_provider_config",
            UnreadableConfigScope::Global,
        ),
    ] {
        assert_unreadable_config_rejects_task_start(test_name, "ai_provider", scope).await;
    }
}
