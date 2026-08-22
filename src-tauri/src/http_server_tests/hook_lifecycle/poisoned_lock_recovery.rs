use super::*;

#[tokio::test]
async fn pi_agent_start_handler_preserves_project_id_after_database_lock_poisoning() {
    let (state, path) = test_state("http_pi_agent_start_poisoned_database_lock");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let (task_id, project_id) = {
        let db = state.db.lock().expect("lock healthy test database");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Pi task", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-poisoned-lock",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-pi-poisoned-lock", 42)
            .expect("set pty instance");
        (task.id, project.id)
    };

    let database = Arc::clone(&state.db);
    let poison_result = std::thread::spawn(move || {
        let _database = database.lock().expect("lock healthy test database");
        panic!("poison test database lock");
    })
    .join();
    assert!(poison_result.is_err());

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-start")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{task_id}","pty_instance_id":42}}"#
                )))
                .expect("build request"),
        )
        .await
        .expect("request should return a controlled response");

    assert_eq!(response.status(), StatusCode::OK);
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project_id);
    let session = crate::db::acquire_db(&state.db)
        .get_agent_session("ses-pi-poisoned-lock")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn legacy_event_handler_completes_title_refresh_post_processing_with_poisoned_database_lock()
{
    let (state, path) = test_state("legacy_title_refresh_poisoned_database_lock");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let (task_id, project_id) = {
        let db = state.db.lock().expect("lock healthy test database");
        db.set_config("task_display_title_metadata_updates_enabled", "true")
            .expect("enable task display title refresh");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task(
                "Recover legacy title refresh",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_agent_session(
            "ses-opencode-title-refresh-poisoned-lock",
            &task.id,
            None,
            "implementing",
            "completed",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-opencode-title-refresh-poisoned-lock", 43)
            .expect("set pty instance");
        (task.id, project.id)
    };

    let database = Arc::clone(&state.db);
    let poison_result = std::thread::spawn(move || {
        let _database = database.lock().expect("lock healthy test database");
        panic!("poison test database lock");
    })
    .join();
    assert!(poison_result.is_err());

    let response = handle_agent_lifecycle_notification_with_refresh(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "opencode".to_string(),
            task_id: task_id.clone(),
            pty_instance_id: Some(43),
            provider_session_id: Some("opencode-title-refresh-poisoned-lock".to_string()),
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
            raw_event_type: Some("message.updated".to_string()),
            raw_status_type: None,
        },
        None,
        Some(r#"{"type":"message.updated","message":"Recover legacy title refresh"}"#.to_string()),
        |_db, _queued_refresh| async { Ok::<bool, String>(true) },
    )
    .await
    .expect("handler response");
    assert_eq!(response.0["status"], "ok");

    let task_changed = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let event = events.recv().await.expect("app event");
            if event.event_name == "task-changed" {
                break event;
            }
        }
    })
    .await
    .expect("title refresh post-processing event");
    assert_eq!(task_changed.payload["action"], "updated");
    assert_eq!(task_changed.payload["task_id"], task_id);
    assert_eq!(task_changed.payload["project_id"], project_id);

    let _ = std::fs::remove_file(path);
}
