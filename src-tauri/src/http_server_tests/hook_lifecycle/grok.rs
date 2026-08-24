use super::*;

#[tokio::test]
async fn grok_stop_hook_maps_to_ended_and_persists_session_id() {
    let (state, _temp_dir) = test_state("grok_stop_hook_ended");
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Grok task",
            session_id: "ses-grok-running",
            status: "running",
            provider: "grok",
            pty_instance_id: 1,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-stop?task_id={task_id}&pty_instance_id=1&session_id=grok-ses-1"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(session.grok_session_id.as_deref(), Some("grok-ses-1"));
}

#[tokio::test]
async fn grok_session_start_hook_marks_completed_session_running_and_persists_session_id() {
    let (state, _temp_dir) = test_state("grok_session_start_hook_running");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-completed", 2)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-session-start?task_id={task_id}&pty_instance_id=2&session_id=grok-ses-2"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(session.pty_instance_id, Some(2));
    assert_eq!(session.grok_session_id.as_deref(), Some("grok-ses-2"));
}

#[tokio::test]
async fn grok_hook_ignores_stale_pty_instance() {
    let (state, _temp_dir) = test_state("grok_hook_stale_pty_instance");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-stale",
            &task.id,
            None,
            "implementing",
            "completed",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-stale", 99)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-pre-tool-use?task_id={task_id}&pty_instance_id=42&session_id=grok-ses-3"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-stale")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert!(session.grok_session_id.is_none());
}

#[tokio::test]
async fn grok_notification_permission_hook_pauses_running_session() {
    let (state, _temp_dir) = test_state("grok_notification_permission_pauses");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-permission",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-permission", 3)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-notification-permission?task_id={task_id}&pty_instance_id=3&session_id=grok-ses-4"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-permission")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "paused");
}

#[tokio::test]
async fn grok_hook_empty_body_still_processes_event() {
    let (state, _temp_dir) = test_state("grok_hook_empty_body_processes");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-empty-body",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-empty-body", 5)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    // Mirrors the real curl command's Content-Type header, but with an
    // entirely empty body (e.g. empty stdin piped via --data-binary @-).
    // Grok has no payload fallback, so this must not drop the lifecycle
    // event.
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-stop?task_id={task_id}&pty_instance_id=5&session_id=grok-ses-empty"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "an empty body must not cause the lifecycle event to be dropped"
    );
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-empty-body")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(session.grok_session_id.as_deref(), Some("grok-ses-empty"));
}

#[tokio::test]
async fn grok_hook_non_json_body_still_processes_event() {
    let (state, _temp_dir) = test_state("grok_hook_non_json_body_processes");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-non-json-body",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-non-json-body", 6)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-stop?task_id={task_id}&pty_instance_id=6&session_id=grok-ses-non-json"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("not valid json at all"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "a malformed/non-JSON body must not cause the lifecycle event to be dropped"
    );
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-grok-non-json-body")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(
        session.grok_session_id.as_deref(),
        Some("grok-ses-non-json")
    );
}

#[tokio::test]
async fn grok_hook_empty_pty_instance_id_query_value_reaches_handler() {
    let (state, _temp_dir) = test_state("grok_hook_empty_pty_instance_id");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-empty-pty",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-empty-pty", 7)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    // `pty_instance_id=` with no value, as happens when
    // $OPENFORGE_PTY_INSTANCE_ID is unset/empty in the guarded curl command.
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-stop?task_id={task_id}&pty_instance_id=&session_id=grok-ses-empty-pty"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "an empty pty_instance_id query value must not cause the whole request to be rejected"
    );
}

#[tokio::test]
async fn grok_hook_garbage_pty_instance_id_query_value_reaches_handler() {
    let (state, _temp_dir) = test_state("grok_hook_garbage_pty_instance_id");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-garbage-pty",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create grok session");
        db.set_agent_session_pty_instance_id("ses-grok-garbage-pty", 8)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/grok-stop?task_id={task_id}&pty_instance_id=not-a-number&session_id=grok-ses-garbage-pty"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "a non-numeric pty_instance_id query value must not cause the whole request to be rejected"
    );
}
