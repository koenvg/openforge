use super::plugin_fixtures::seed_http_plugin;
use super::*;

#[tokio::test]
async fn test_plugin_command_discovery_routes_reject_missing_and_conflicting_context() {
    let (state, path) = test_state("http_plugin_command_context");
    let (task_id, other_project_id) = {
        let database = state.db.lock().expect("lock db");
        let project = database
            .create_project("Project", "/tmp/plugin-command-project")
            .expect("project");
        let other = database
            .create_project("Other", "/tmp/plugin-command-other")
            .expect("other project");
        let task = database
            .create_task("Task", "doing", Some(&project.id), None, None)
            .expect("task");
        (task.id, other.id)
    };
    let router = create_router(state);

    let missing = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/plugin_commands/list")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("missing context request"),
        )
        .await
        .expect("missing context response");
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body_text(missing).await,
        "plugin command discovery requires --task-id or --project-id"
    );

    let invoke_missing = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/plugin_commands/invoke")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"commandId":"com.example.sync.run","input":{"force":true}}"#,
                ))
                .expect("missing invocation context request"),
        )
        .await
        .expect("missing invocation context response");
    assert_eq!(invoke_missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body_text(invoke_missing).await,
        "plugin command discovery requires --task-id or --project-id"
    );

    let conflict = router
        .oneshot(
            Request::builder()
                .uri("/plugin_commands/list")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"taskId":"{task_id}","projectId":"{other_project_id}"}}"#
                )))
                .expect("conflicting context request"),
        )
        .await
        .expect("conflicting context response");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let conflict_body = response_body_text(conflict).await;
    assert!(conflict_body.contains(&task_id));
    assert!(conflict_body.contains(&other_project_id));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_plugin_command_describe_rejects_uninstalled_and_disabled_plugins() {
    let (state, path) = test_state("http_plugin_command_authorization");
    let project_id = {
        let database = state.db.lock().expect("lock db");
        database
            .create_project("Project", "/tmp/plugin-command-auth")
            .expect("project")
            .id
    };
    seed_http_plugin(&state, "com.example.disabled");
    let router = create_router(state);

    let uninstalled = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/plugin_commands/describe")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"commandId":"com.example.missing.run","projectId":"{project_id}"}}"#
                )))
                .expect("uninstalled request"),
        )
        .await
        .expect("uninstalled response");
    assert_eq!(uninstalled.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_body_text(uninstalled).await,
        "Plugin is not installed: com.example.missing"
    );

    let disabled = router
        .oneshot(
            Request::builder()
                .uri("/plugin_commands/describe")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"commandId":"com.example.disabled.run","projectId":"{project_id}"}}"#
                )))
                .expect("disabled request"),
        )
        .await
        .expect("disabled response");
    assert_eq!(disabled.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_body_text(disabled).await,
        format!("Plugin com.example.disabled is not enabled for Project {project_id}")
    );

    let _ = std::fs::remove_file(path);
}
