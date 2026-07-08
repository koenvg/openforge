use super::*;

#[tokio::test]
async fn test_get_projects_handler_returns_all_projects() {
    let (state, path) = test_state("http_get_projects_handler_returns_projects");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project A", "/tmp/project-a")
            .expect("create project a");
        db.create_project("Project B", "/tmp/project-b")
            .expect("create project b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/projects")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let projects = json.as_array().expect("array response");
    assert_eq!(projects.len(), 2);
    assert!(projects.iter().any(|project| {
        project["id"] == "P-1"
            && project["name"] == "Project A"
            && project["path"] == "/tmp/project-a"
    }));
    assert!(projects.iter().any(|project| {
        project["id"] == "P-2"
            && project["name"] == "Project B"
            && project["path"] == "/tmp/project-b"
    }));

    let _ = std::fs::remove_file(path);
}

#[cfg(unix)]
#[tokio::test]
async fn test_debug_process_memory_handler_returns_read_only_diagnostics() {
    let (state, path) = test_state("http_debug_process_memory_handler");
    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/debug/process-memory")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["sidecar"]["pid"], std::process::id());
    assert!(json["sidecar"]["rssBytes"].as_u64().unwrap_or(0) > 0);
    assert!(
        json["totals"]["trackedUniqueRssBytes"]
            .as_u64()
            .unwrap_or(0)
            >= json["sidecar"]["rssBytes"].as_u64().unwrap_or(0)
    );
    assert!(json["ptyProcessTrees"].as_array().is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_task_labels_handler_lists_existing_project_labels() {
    let (state, path) = test_state("http_get_project_task_labels_handler_lists_labels");
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
    assert!(labels.iter().all(|label| label["project_id"] == "P-1"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_returns_tasks_for_project() {
    let (state, path) = test_state("http_get_tasks_handler_returns_tasks");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task A", "backlog", Some(&project.id), None, None)
            .expect("create task a");
        db.create_task("Task B", "doing", Some(&project.id), None, None)
            .expect("create task b");
        db.create_task("Task C", "done", Some(&project.id), None, None)
            .expect("create task c");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 3);
    assert!(tasks.iter().any(|task| task["status"] == "done"));
    assert!(tasks[0].get("initial_prompt").is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_and_compacts_when_requested() {
    let (state, path) = test_state("http_get_tasks_handler_excludes_done_compact");
    let open_task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let open_task = db
            .create_task(
                "Open task full prompt",
                "backlog",
                Some(&project.id),
                Some("Open task runtime prompt"),
                None,
            )
            .expect("create open task");
        db.update_task_summary(&open_task.id, "Open task handoff notes")
            .expect("seed open summary");
        let done_task = db
            .create_task(
                "Done task full prompt",
                "done",
                Some(&project.id),
                Some("Done task runtime prompt"),
                None,
            )
            .expect("create done task");
        db.update_task_summary(&done_task.id, "Done task handoff notes")
            .expect("seed done summary");
        open_task.id
    };

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&exclude_done=true&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["id"], open_task_id);
    assert_eq!(tasks[0]["status"], "backlog");
    assert_eq!(tasks[0]["title"], "Open task full prompt");
    assert!(tasks[0].get("initial_prompt").is_none());
    assert!(tasks[0].get("prompt").is_none());
    assert!(tasks[0].get("summary").is_none());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_when_include_done_is_false() {
    let (state, path) = test_state("http_get_tasks_handler_include_done_false");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task A", "backlog", Some(&project.id), None, None)
            .expect("create task a");
        db.create_task("Task B", "done", Some(&project.id), None, None)
            .expect("create task b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&include_done=false")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"], "backlog");
    assert!(tasks[0].get("initial_prompt").is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_create_task_handler_persists_dependency_ids() {
    let (state, path) = test_state("http_create_task_handler_dependencies");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Prerequisite", "done", Some(&project.id), None, None)
            .expect("create prerequisite");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Dependent","project_id":"P-1","depends_on":["T-1"]}"#,
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
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn http_create_task_handler_uses_project_worktree_default() {
    let (state, path) = test_state("http_create_task_handler_worktree_default");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("set worktree default");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Project directory task","project_id":"P-1"}"#,
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
    assert_eq!(task.worktree_source.as_deref(), Some("disabled"));
    assert_eq!(task.worktree_branch, None);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_create_task_handler_persists_labels() {
    let (state, path) = test_state("http_create_task_handler_labels");
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

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_delete_task_handler_completes_task_and_keeps_cli_retrieval() {
    let (state, path) = test_state("http_delete_task_handler_completes_task");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task(
            "Completed prompt",
            "backlog",
            Some(&project.id),
            Some("Full prompt kept for agents"),
            None,
        )
        .expect("create completed task");
        db.update_task_summary("T-1", "## Handoff Notes\nKeep this reference")
            .expect("set handoff notes");
        db.create_task("Open task", "backlog", Some(&project.id), None, None)
            .expect("create open task");
    }

    let router = create_router(state.clone());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-1");
    assert_eq!(json["status"], "completed");

    let completed_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/task/T-1")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("get completed task should succeed");
    assert_eq!(completed_response.status(), StatusCode::OK);
    let completed_json = response_body_json(completed_response).await;
    assert_eq!(completed_json["id"], "T-1");
    assert_eq!(completed_json["status"], "done");
    assert_eq!(completed_json["initial_prompt"], "Completed prompt");
    assert_eq!(completed_json["prompt"], "Full prompt kept for agents");
    assert_eq!(
        completed_json["summary"],
        "## Handoff Notes\nKeep this reference"
    );

    let normal_list_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&exclude_done=true&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("list visible tasks should succeed");
    assert_eq!(normal_list_response.status(), StatusCode::OK);
    let normal_list = response_body_json(normal_list_response).await;
    let normal_ids: Vec<_> = normal_list
        .as_array()
        .expect("normal list array")
        .iter()
        .map(|row| row["id"].as_str().expect("task id"))
        .collect();
    assert_eq!(normal_ids, vec!["T-2"]);

    let completed_list_response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=done&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("list completed tasks should succeed");
    assert_eq!(completed_list_response.status(), StatusCode::OK);
    let completed_list = response_body_json(completed_list_response).await;
    let completed_rows = completed_list.as_array().expect("completed list array");
    assert_eq!(completed_rows.len(), 1);
    assert_eq!(completed_rows[0]["id"], "T-1");
    assert_eq!(completed_rows[0]["status"], "done");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_hard_delete_task_handler_removes_task_row() {
    let (state, path) = test_state("http_hard_delete_task_handler_removes_task");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task to remove", "backlog", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hard_delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-1");
    assert_eq!(json["status"], "deleted");
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .is_none());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_delete_task_handler_rejects_non_backlog_task() {
    let (state, path) = test_state("http_delete_task_handler_non_backlog_task");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task", "doing", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_delete_task_handler_rejects_missing_task() {
    let (state, path) = test_state("http_delete_task_handler_missing_task");

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-404"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_task_label_handlers_list_add_and_remove_labels() {
    let (state, path) = test_state("http_task_label_handlers");
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

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_set_task_dependencies_handler_replaces_dependencies() {
    let (state, path) = test_state("http_set_task_dependencies_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "done", Some(&project.id), None, None)
            .expect("create second");
        let dependent = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.add_task_dependency(&dependent.id, "T-1")
            .expect("seed dependency");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/set_task_dependencies")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-3","depends_on":["T-2"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-3");
    assert_eq!(json["status"], "updated");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_add_task_dependency_handler_appends_dependency() {
    let (state, path) = test_state("http_add_task_dependency_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/add_task_dependency")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-2","depends_on":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_link_task_chain_handler_links_atomically() {
    let (state, path) = test_state("http_link_task_chain_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second");
        db.create_task("Third", "backlog", Some(&project.id), None, None)
            .expect("create third");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/link_task_chain")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"chain":["T-1","T-2","T-3"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["links"][0]["task_id"], "T-2");
    assert_eq!(json["links"][0]["depends_on"], "T-1");
    assert_eq!(json["links"][1]["task_id"], "T-3");
    assert_eq!(json["links"][1]["depends_on"], "T-2");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_filters_by_state() {
    let (state, path) = test_state("http_get_tasks_handler_filters_by_state");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task backlog", "backlog", Some(&project.id), None, None)
            .expect("create backlog task");
        db.create_task("Task doing", "doing", Some(&project.id), None, None)
            .expect("create doing task");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=doing")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"], "doing");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_rejects_invalid_state() {
    let (state, path) = test_state("http_get_tasks_handler_rejects_invalid_state");
    {
        let db = state.db.lock().expect("lock db");
        let _ = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=blocked")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_updates_summary_without_changing_initial_prompt() {
    let (state, path) = test_state("http_update_task_summary_only");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task")
            .id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","summary":"New Summary"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], task_id);
    assert_eq!(json["status"], "updated");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.summary, Some("New Summary".to_string()));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_rejects_initial_prompt_and_preserves_task() {
    let (state, path) = test_state("http_update_task_rejects_initial_prompt");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.update_task_summary(&task.id, "Existing Summary")
            .expect("seed summary");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","initial_prompt":"New prompt","summary":"New Summary"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.summary, Some("Existing Summary".to_string()));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_zeroed_row_when_no_attention() {
    let (state, path) = test_state("http_get_project_attention_handler_zeroed_row");
    {
        let db = state.db.lock().expect("lock db");
        let _ = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-1/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["project_id"], "P-1");
    assert_eq!(json["needs_input"], 0);
    assert_eq!(json["running_agents"], 0);
    assert_eq!(json["ci_failures"], 0);
    assert_eq!(json["unaddressed_comments"], 0);
    assert_eq!(json["completed_agents"], 0);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_not_found_for_unknown_project() {
    let (state, path) = test_state("http_get_project_attention_handler_not_found");

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-999/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let _ = std::fs::remove_file(path);
}

fn sample_http_plugin(plugin_id: &str) -> crate::db::PluginRow {
    crate::db::PluginRow {
        id: plugin_id.to_string(),
        name: format!("Plugin {plugin_id}"),
        version: "1.0.0".to_string(),
        api_version: 1,
        description: "A test plugin".to_string(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: "dist/index.js".to_string(),
        backend_entry: None,
        install_path: "/tmp/plugin".to_string(),
        source_kind: "local".to_string(),
        source_spec: "local:/tmp/plugin".to_string(),
        package_metadata: "{}".to_string(),
        installed_at: 0,
        is_builtin: false,
    }
}

fn seed_http_plugin(state: &AppState, plugin_id: &str) {
    state
        .db
        .lock()
        .expect("lock db")
        .install_plugin(&sample_http_plugin(plugin_id))
        .expect("seed plugin");
}

fn assert_no_app_event(receiver: &mut tokio::sync::broadcast::Receiver<AppEventEnvelope>) {
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            | Err(tokio::sync::broadcast::error::TryRecvError::Closed)
    ));
}

fn write_local_plugin_package(source_dir: &std::path::Path, plugin_id: &str) {
    std::fs::create_dir_all(source_dir.join("dist")).expect("create plugin dist");
    std::fs::write(
        source_dir.join("dist/index.js"),
        "export const ok = true;\n",
    )
    .expect("write plugin frontend");
    std::fs::write(
        source_dir.join("package.json"),
        format!(
            r#"{{
  "name": "openforge-http-test-plugin",
  "version": "1.2.3",
  "openforge": {{
    "id": "{plugin_id}",
    "apiVersion": 1,
    "displayName": "HTTP Test Plugin",
    "description": "Installed by HTTP bridge tests",
    "frontend": "dist/index.js"
  }}
}}"#
        ),
    )
    .expect("write plugin package.json");
}

#[tokio::test]
async fn test_install_plugin_from_local_handler_installs_with_camel_case_payload_and_publishes_event(
) {
    let (mut state, path) = test_state("http_install_plugin_from_local_handler");
    let plugin_source = tempfile::tempdir().expect("create plugin source tempdir");
    let app_data_dir = tempfile::tempdir().expect("create app data tempdir");
    let resource_dir = tempfile::tempdir().expect("create resource tempdir");
    write_local_plugin_package(plugin_source.path(), "com.example.http-install");
    state.app = Some(crate::backend_runtime::AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    ));
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/install_plugin_from_local")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"sourcePath":"{}"}}"#,
                    plugin_source.path().display()
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["id"], "com.example.http-install");
    assert_eq!(json["name"], "HTTP Test Plugin");
    assert_eq!(json["version"], "1.2.3");
    assert_eq!(json["source_kind"], "local");

    let installed = state
        .db
        .lock()
        .expect("lock db")
        .get_plugin("com.example.http-install")
        .expect("get installed plugin")
        .expect("plugin should be installed");
    assert_eq!(installed.frontend_entry, "dist/index.js");
    assert_eq!(
        installed.install_path,
        plugin_source
            .path()
            .canonicalize()
            .expect("canonicalize plugin source")
            .to_string_lossy()
    );

    let event = events.recv().await.expect("plugin installation event");
    assert_eq!(event.event_name, "plugin-installation-changed");
    assert_eq!(event.payload["plugin_id"], "com.example.http-install");
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_install_plugin_from_local_handler_maps_missing_app_path_state() {
    let (state, path) = test_state("http_install_plugin_from_local_no_app_path");
    let plugin_source = tempfile::tempdir().expect("create plugin source tempdir");
    write_local_plugin_package(plugin_source.path(), "com.example.no-app");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/install_plugin_from_local")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"sourcePath":"{}"}}"#,
                    plugin_source.path().display()
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_set_plugin_enabled_handler_updates_db_with_camel_case_payload_and_publishes_events() {
    let (state, path) = test_state("http_set_plugin_enabled_handler");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project", "/tmp/project")
            .expect("create project");
    }
    seed_http_plugin(&state, "com.example.enable");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state.clone());
    let enable_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/set_plugin_enabled")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.enable","projectId":"P-1","enabled":true}"#,
                ))
                .expect("build enable request"),
        )
        .await
        .expect("enable request should succeed");

    assert_eq!(enable_response.status(), StatusCode::OK);
    let enable_json = response_body_json(enable_response).await;
    assert_eq!(enable_json["plugin_id"], "com.example.enable");
    assert_eq!(enable_json["project_id"], "P-1");
    assert_eq!(enable_json["enabled"], true);
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .is_plugin_enabled("P-1", "com.example.enable")
        .expect("enabled state"));

    let enable_event = events.recv().await.expect("enable event");
    assert_eq!(enable_event.event_name, "project-plugin-enablement-changed");
    assert_eq!(enable_event.payload["plugin_id"], "com.example.enable");
    assert_eq!(enable_event.payload["project_id"], "P-1");
    assert_eq!(enable_event.payload["enabled"], true);

    let disable_response = router
        .oneshot(
            Request::builder()
                .uri("/set_plugin_enabled")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.enable","projectId":"P-1","enabled":false}"#,
                ))
                .expect("build disable request"),
        )
        .await
        .expect("disable request should succeed");

    assert_eq!(disable_response.status(), StatusCode::OK);
    let disable_json = response_body_json(disable_response).await;
    assert_eq!(disable_json["enabled"], false);
    assert!(!state
        .db
        .lock()
        .expect("lock db")
        .is_plugin_enabled("P-1", "com.example.enable")
        .expect("enabled state"));

    let disable_event = events.recv().await.expect("disable event");
    assert_eq!(
        disable_event.event_name,
        "project-plugin-enablement-changed"
    );
    assert_eq!(disable_event.payload["plugin_id"], "com.example.enable");
    assert_eq!(disable_event.payload["project_id"], "P-1");
    assert_eq!(disable_event.payload["enabled"], false);
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_reload_plugin_handler_publishes_reload_event_with_camel_case_payload() {
    let (state, path) = test_state("http_reload_plugin_handler");
    seed_http_plugin(&state, "com.example.reload");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/reload_plugin")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.reload","projectId":"P-1"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["plugin_id"], "com.example.reload");
    assert_eq!(json["project_id"], "P-1");
    assert_eq!(json["reloaded"], true);

    let event = events.recv().await.expect("reload event");
    assert_eq!(event.event_name, "plugin-reload-requested");
    assert_eq!(event.payload["plugin_id"], "com.example.reload");
    assert_eq!(event.payload["project_id"], "P-1");
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_reload_plugin_handler_returns_not_found_for_unknown_plugin_without_event() {
    let (state, path) = test_state("http_reload_plugin_unknown");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/reload_plugin")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.missing","projectId":"P-1"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}
