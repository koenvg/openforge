use super::super::*;
use super::support::*;

#[test]
fn start_context_rejects_malformed_start_prompt_contributions_config() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_context_malformed_prompt_config");
    let (project_id, task_id) = backlog_task_with_project(&state);
    db::acquire_db(&state.db)
        .set_project_config(
            &project_id,
            agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            "not-json",
        )
        .expect("store malformed contribution config");

    let error = service_for_state(&state)
        .load_context(&task_id)
        .err()
        .expect("malformed contribution config must reject Task Start");
    let TaskStartError::InvalidConfiguration(message) = error else {
        panic!("expected invalid configuration error, got {error:?}");
    };
    assert!(message.contains(agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY));
    assert!(message.contains(&project_id));
    assert!(message.contains("line 1 column"));

    drop(state);
}

#[test]
fn start_context_reports_unreadable_start_prompt_contributions_config() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_context_unreadable_prompt_config");
    let (project_id, task_id) = backlog_task_with_project(&state);
    db::acquire_db(&state.db)
        .lock_conn()
        .expect("lock database")
        .execute(
            "INSERT INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &project_id,
                agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
                vec![0xff_u8],
            ],
        )
        .expect("store unreadable contribution config");

    let error = service_for_state(&state)
        .load_context(&task_id)
        .err()
        .expect("unreadable contribution config must reject Task Start");
    let TaskStartError::Persistence(message) = error else {
        panic!("expected persistence error, got {error:?}");
    };
    assert!(message.contains(agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY));
    assert!(message.contains(&project_id));
    assert!(message.contains("Invalid column type"));

    drop(state);
}

#[tokio::test]
async fn safe_start_reports_unreadable_additional_instructions_config() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_unreadable_instructions");
    let (project_id, task_id) = backlog_task_with_project(&state);
    db::acquire_db(&state.db)
        .lock_conn()
        .expect("lock database")
        .execute(
            "INSERT INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![&project_id, "additional_instructions", vec![0xff_u8]],
        )
        .expect("store unreadable additional instructions");

    let error = service_for_state(&state)
        .with_provider_launcher(Arc::new(SuccessfulProviderLauncher))
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("unreadable additional instructions must reject Task Start");
    let TaskStartError::Persistence(message) = error else {
        panic!("expected persistence error, got {error:?}");
    };
    assert!(message.contains("additional_instructions"));
    assert!(message.contains(&project_id));
    assert!(message.contains("Invalid column type"));

    drop(state);
}

#[tokio::test]
async fn safe_start_reports_plugin_activity_lookup_failures() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_plugin_activity_lookup_failure");
    let plugin_id = "com.example.start-prompt";
    let task_id = task_with_owned_start_prompt_contribution(&state, plugin_id);
    let project_id = {
        let db = db::acquire_db(&state.db);
        let task = db
            .get_task(&task_id)
            .expect("get Task")
            .expect("Task should exist");
        db.lock_conn()
            .expect("lock database")
            .execute(
                "UPDATE plugins SET package_metadata = ?1 WHERE id = ?2",
                rusqlite::params!["not-json", plugin_id],
            )
            .expect("corrupt plugin package metadata");
        task.project_id.expect("Task should belong to a Project")
    };

    let error = service_for_state(&state)
        .with_provider_launcher(Arc::new(SuccessfulProviderLauncher))
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("plugin activity lookup failure must reject Task Start");
    let TaskStartError::Persistence(message) = error else {
        panic!("expected persistence error, got {error:?}");
    };
    assert!(message.contains("Failed to resolve activity"));
    assert!(message.contains(plugin_id));
    assert!(message.contains(&project_id));
    assert!(message.contains("malformed JSON"));

    drop(state);
}

#[test]
fn start_context_excludes_contributions_from_disabled_plugins_and_restores_them_on_reenable() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_context_disabled_plugin_prompt");
    let plugin_id = "com.example.start-prompt";
    let task_id = task_with_owned_start_prompt_contribution(&state, plugin_id);
    let service = service_for_state(&state);

    let enabled_context = service
        .load_context(&task_id)
        .expect("load enabled context");
    assert_eq!(enabled_context.start_prompt_contributions.len(), 1);

    let project_id = enabled_context.project_id;
    db::acquire_db(&state.db)
        .set_plugin_enabled(&project_id, plugin_id, false)
        .expect("disable plugin");
    let disabled_context = service
        .load_context(&task_id)
        .expect("load disabled context");
    assert!(disabled_context.start_prompt_contributions.is_empty());

    db::acquire_db(&state.db)
        .set_plugin_enabled(&project_id, plugin_id, true)
        .expect("re-enable plugin");
    let reenabled_context = service
        .load_context(&task_id)
        .expect("load re-enabled context");
    assert_eq!(reenabled_context.start_prompt_contributions.len(), 1);

    drop(state);
}

#[test]
fn start_context_excludes_contributions_from_uninstalled_plugins_and_restores_them_after_reinstall()
{
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_context_uninstalled_plugin_prompt");
    let plugin_id = "com.example.start-prompt";
    let task_id = task_with_owned_start_prompt_contribution(&state, plugin_id);
    let service = service_for_state(&state);

    let enabled_context = service
        .load_context(&task_id)
        .expect("load enabled context");
    assert_eq!(enabled_context.start_prompt_contributions.len(), 1);

    let project_id = enabled_context.project_id;
    db::acquire_db(&state.db)
        .uninstall_plugin(plugin_id)
        .expect("uninstall plugin");
    let uninstalled_context = service
        .load_context(&task_id)
        .expect("load uninstalled context");
    assert!(uninstalled_context.start_prompt_contributions.is_empty());

    let db = db::acquire_db(&state.db);
    db.install_plugin(&test_plugin(plugin_id))
        .expect("reinstall plugin");
    db.set_plugin_enabled(&project_id, plugin_id, true)
        .expect("enable reinstalled plugin");
    drop(db);
    let reinstalled_context = service
        .load_context(&task_id)
        .expect("load reinstalled context");
    assert_eq!(reinstalled_context.start_prompt_contributions.len(), 1);

    drop(state);
}
