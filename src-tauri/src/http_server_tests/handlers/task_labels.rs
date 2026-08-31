use super::*;

#[tokio::test]
async fn test_get_project_task_labels_handler_lists_existing_project_labels() {
    let (state, _temp_dir) = test_state("http_get_project_task_labels_handler_lists_labels");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let other_project = db
            .create_project("Other", "/tmp/other")
            .expect("create other project");
        let first = db
            .create_task("First", "backlog", Some(&project.id), None, None)
            .expect("create first task");
        let second = db
            .create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second task");
        let other = db
            .create_task("Other", "backlog", Some(&other_project.id), None, None)
            .expect("create other task");
        db.add_task_label(&first.id, "cleanup")
            .expect("add cleanup label");
        db.add_task_label(&second.id, "Bug").expect("add bug label");
        db.add_task_label(&other.id, "other")
            .expect("add other label");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-1/labels")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let labels = json.as_array().expect("array response");
    assert_eq!(labels.len(), 2);
    assert_eq!(labels[0]["name"], "Bug");
    assert_eq!(labels[1]["name"], "cleanup");
    assert!(labels.iter().all(|label| label["projectId"] == "P-1"));
}

#[tokio::test]
async fn test_create_task_handler_persists_labels() {
    let (state, _temp_dir) = test_state("http_create_task_handler_labels");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Labelled task","project_id":"P-1","labels":["bug","ui"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .expect("task exists");
    let label_names: Vec<_> = task
        .labels
        .iter()
        .map(|label| label.name.as_str())
        .collect();
    assert_eq!(label_names, vec!["bug", "ui"]);
}

#[tokio::test]
async fn create_task_label_storage_failure_is_atomic_when_cleanup_delete_would_fail() {
    let (state, _temp_dir) = test_state("http_create_task_label_failure_atomic");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        let existing_label = db
            .create_task_label(&project.id, "existing")
            .expect("create existing label");
        let triggers = format!(
            "CREATE TRIGGER reject_new_task_label_assignment
             BEFORE INSERT ON task_label_assignments
             WHEN NEW.label_id != {}
             BEGIN
               SELECT RAISE(ABORT, 'label assignment rejected');
             END;
             CREATE TRIGGER reject_task_delete
             BEFORE DELETE ON tasks
             BEGIN
               SELECT RAISE(ABORT, 'task delete rejected');
             END;",
            existing_label.id
        );
        db.connection()
            .lock()
            .expect("lock connection")
            .execute_batch(&triggers)
            .expect("create storage failure triggers");
    }

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Labelled task","project_id":"P-1","labels":["existing","new"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let db = state.db.lock().expect("lock db");
    assert!(db.get_task("T-1").expect("get attempted task").is_none());
    let labels = db
        .get_project_task_labels("P-1")
        .expect("list project labels");
    assert_eq!(
        labels
            .iter()
            .map(|label| label.name.as_str())
            .collect::<Vec<_>>(),
        vec!["existing"]
    );
    assert_eq!(
        db.get_config("next_task_id").expect("get task counter"),
        Some("1".to_string())
    );
    let assignment_count: i64 = db
        .connection()
        .lock()
        .expect("lock connection")
        .query_row("SELECT COUNT(*) FROM task_label_assignments", [], |row| {
            row.get(0)
        })
        .expect("count rolled-back assignments");
    assert_eq!(assignment_count, 0);
    drop(db);
}

#[tokio::test]
async fn test_task_label_handlers_list_add_and_remove_labels() {
    let (state, _temp_dir) = test_state("http_task_label_handlers");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let add_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/add_task_label")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1","label":"bug"}"#))
                .expect("build add request"),
        )
        .await
        .expect("add request should succeed");

    assert_eq!(add_response.status(), StatusCode::OK);
    let add_json = response_body_json(add_response).await;
    assert_eq!(add_json["task_id"], "T-1");
    assert_eq!(add_json["status"], "updated");
    assert_eq!(add_json["label"]["name"], "bug");
    let label_id = add_json["label"]["id"].as_i64().expect("label id");

    let list_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/task/T-1/labels")
                .method("GET")
                .body(Body::empty())
                .expect("build list request"),
        )
        .await
        .expect("list request should succeed");

    assert_eq!(list_response.status(), StatusCode::OK);
    let list_json = response_body_json(list_response).await;
    assert_eq!(list_json["task_id"], "T-1");
    assert_eq!(list_json["labels"][0]["name"], "bug");

    let remove_response = router
        .oneshot(
            Request::builder()
                .uri("/remove_task_label")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"T-1","label_id":{label_id}}}"#
                )))
                .expect("build remove request"),
        )
        .await
        .expect("remove request should succeed");

    assert_eq!(remove_response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .expect("task exists");
    assert!(task.labels.is_empty());
}
