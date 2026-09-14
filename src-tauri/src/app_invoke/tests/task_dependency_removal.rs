use super::*;

#[tokio::test]
async fn remove_task_dependency_commits_before_publishing_invalidation() {
    let (state, _temp_dir) = test_state("remove_task_dependency_command");
    let (project, task, prerequisite) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Project", "/tmp/dependency-removal")
            .unwrap();
        let task = db
            .create_task("Task", "backlog", Some(&project.id), None, None)
            .unwrap();
        let prerequisite = db
            .create_task("Prerequisite", "done", Some(&project.id), None, None)
            .unwrap();
        db.add_task_dependency(&task.id, &prerequisite.id).unwrap();
        (project, task, prerequisite)
    };
    let mut events = state.app_event_tx.as_ref().unwrap().subscribe();

    let result = invoke_ok(
        &state,
        "remove_task_dependency",
        json!({
            "taskId": task.id, "dependencyTaskId": prerequisite.id,
        }),
    )
    .await;

    assert_eq!(result, serde_json::Value::Null);
    let event = events
        .try_recv()
        .expect("committed relationship invalidation");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["task_id"], task.id);
    assert_eq!(event.payload["project_id"], project.id);
    let read = invoke_ok(
        &state,
        "tasks_detail",
        json!({
            "projectId": project.id, "taskId": task.id,
        }),
    )
    .await;
    assert_eq!(read["task"]["dependsOn"], json!([]));
}

#[tokio::test]
async fn remove_task_dependency_rejects_invalid_payload_and_missing_task_without_events() {
    let (state, _temp_dir) = test_state("remove_task_dependency_command_errors");
    let mut events = state.app_event_tx.as_ref().unwrap().subscribe();
    for payload in [
        json!({ "task_id": "missing", "dependency_task_id": "other" }),
        json!({ "taskId": "missing" }),
    ] {
        let (status, _) = invoke(&state, "remove_task_dependency", payload)
            .await
            .unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, _) = invoke(
        &state,
        "remove_task_dependency",
        json!({
            "taskId": "missing", "dependencyTaskId": "other",
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(events.try_recv().is_err());
}
