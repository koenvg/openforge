use super::*;
use crate::app_invoke::test_support::{
    assert_config_lookup_error_status, insert_unreadable_global_config,
};

#[test]
fn task_display_title_refresh_is_disabled_by_default() {
    let (state, _temp_dir) = test_state("task_title_refresh_disabled_by_default");
    let notification = crate::agent_lifecycle::AgentLifecycleNotification {
        provider: "codex".to_string(),
        task_id: "task-title-refresh".to_string(),
        pty_instance_id: Some(1),
        provider_session_id: None,
        kind: crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        raw_event_type: Some("UserPromptSubmit".to_string()),
        raw_status_type: None,
    };

    assert!(
        !should_start_task_display_title_refresh(&state, &notification)
            .expect("resolve title refresh config")
    );
}

#[test]
fn task_display_title_refresh_starts_for_supported_provider_activity_when_enabled() {
    let (state, _temp_dir) = test_state("task_title_refresh_enabled_supported_activity");
    state
        .db
        .lock()
        .expect("lock db")
        .set_config("task_display_title_metadata_updates_enabled", "true")
        .expect("set task display title experiment config");
    let cases = [
        ("codex", "UserPromptSubmit"),
        ("claude-code", "user-prompt-submit"),
        ("opencode", "message.updated"),
        ("pi", "user_prompt"),
    ];

    for (provider, raw_event_type) in cases {
        let notification = crate::agent_lifecycle::AgentLifecycleNotification {
            provider: provider.to_string(),
            task_id: "task-title-refresh".to_string(),
            pty_instance_id: Some(1),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
            raw_event_type: Some(raw_event_type.to_string()),
            raw_status_type: None,
        };

        assert!(
            should_start_task_display_title_refresh(&state, &notification)
                .expect("resolve title refresh config"),
            "{provider} {raw_event_type} should start title refresh"
        );
    }
}

#[test]
fn task_display_title_refresh_ignores_unsupported_provider_activity() {
    let (state, _temp_dir) = test_state("task_title_refresh_enabled_unsupported_activity");
    state
        .db
        .lock()
        .expect("lock db")
        .set_config("task_display_title_metadata_updates_enabled", "true")
        .expect("set task display title experiment config");
    let cases = [
        (
            "codex",
            "TaskComplete",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "opencode",
            "session.status",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "opencode",
            "session.updated",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "opencode",
            "tool.execute.before",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "pi",
            "agent.start",
            crate::agent_lifecycle::AgentLifecycleEventKind::Started,
        ),
        (
            "claude-code",
            "pre-tool-use",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "claude-code",
            "post-tool-use",
            crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        ),
        (
            "claude-code",
            "stop",
            crate::agent_lifecycle::AgentLifecycleEventKind::Ended,
        ),
    ];

    for (provider, raw_event_type, kind) in cases {
        let notification = crate::agent_lifecycle::AgentLifecycleNotification {
            provider: provider.to_string(),
            task_id: "task-title-refresh".to_string(),
            pty_instance_id: Some(1),
            provider_session_id: None,
            kind,
            raw_event_type: Some(raw_event_type.to_string()),
            raw_status_type: None,
        };

        assert!(
            !should_start_task_display_title_refresh(&state, &notification)
                .expect("resolve title refresh config"),
            "{provider} {raw_event_type} should not start title refresh"
        );
    }
}

#[test]
fn task_display_title_refresh_reads_task_override() {
    let (state, _temp_dir) = test_state("task_title_refresh_task_override");

    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db.create_project("P", "/tmp/p").expect("create project");
        // Global default OFF; the task snapshot overrides it ON.
        db.set_config("task_display_title_metadata_updates_enabled", "false")
            .expect("set global title config");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create task");
        db.set_task_config(
            &task.id,
            "task_display_title_metadata_updates_enabled",
            "true",
        )
        .expect("set task title config");
        task.id
    };

    let notification = crate::agent_lifecycle::AgentLifecycleNotification {
        provider: "codex".to_string(),
        task_id: task_id.clone(),
        pty_instance_id: Some(1),
        provider_session_id: None,
        kind: crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
        raw_event_type: Some("UserPromptSubmit".to_string()),
        raw_status_type: None,
    };

    assert!(
        should_start_task_display_title_refresh(&state, &notification)
            .expect("resolve title refresh config"),
        "task-level title-update override should win over global config"
    );
}

#[tokio::test]
async fn lifecycle_handler_reports_unreadable_global_title_refresh_config() {
    let (state, _temp_dir) = test_state("title_refresh_unreadable_global_config");
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Unreadable title config",
            session_id: "ses-unreadable-title-config",
            status: "completed",
            provider: "opencode",
            pty_instance_id: 41,
        },
    );
    insert_unreadable_global_config(&state, "task_display_title_metadata_updates_enabled");

    let error = handle_agent_lifecycle_notification_with_refresh(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "opencode".to_string(),
            task_id,
            pty_instance_id: Some(41),
            provider_session_id: Some("unreadable-title-config".to_string()),
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
            raw_event_type: Some("message.updated".to_string()),
            raw_status_type: None,
        },
        None,
        None,
        |_db, _queued_refresh| async {
            panic!("title refresh must not start when config lookup fails")
        },
    )
    .await
    .expect_err("unreadable title config must fail the lifecycle request");

    assert_config_lookup_error_status(error);
}
