use super::*;

fn scope_payload() -> serde_json::Value {
    json!({
        "namespace": "github",
        "targetKey": "gh:acme/web#1421",
        "revision": "sha-1",
    })
}

fn create_payload() -> serde_json::Value {
    json!({
        "namespace": "github",
        "targetKey": "gh:acme/web#1421",
        "revision": "sha-1",
        "origin": "plugin",
        "body": "Missing null check",
        "anchor": { "kind": "line", "filePath": "src/main.rs", "line": 42, "side": "RIGHT" },
    })
}

#[tokio::test]
async fn a_created_thread_is_listed_back_under_its_scope() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_round_trip");

    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;

    assert_eq!(created["origin"], "plugin");
    assert_eq!(created["anchor"]["kind"], "line");
    assert_eq!(created["anchor"]["filePath"], "src/main.rs");
    assert_eq!(created["anchor"]["line"], 42);
    assert_eq!(created["anchor"]["side"], "RIGHT");
    assert_eq!(created["messages"][0]["body"], "Missing null check");

    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed.as_array().expect("list").len(), 1);
    assert_eq!(listed[0]["id"], created["id"]);
    assert_eq!(listed[0]["targetKey"], "gh:acme/web#1421");
}

#[tokio::test]
async fn a_reply_appends_to_the_thread_rather_than_creating_a_second_one() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_reply");
    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;
    let thread_id = created["id"].as_str().expect("thread id").to_string();

    let replied = invoke_ok(
        &state,
        "reply_to_review_thread",
        json!({ "threadId": thread_id, "role": "human", "body": "Why?" }),
    )
    .await;

    assert_eq!(replied["id"], thread_id.as_str());
    assert_eq!(replied["messages"].as_array().expect("messages").len(), 2);
    assert_eq!(replied["messages"][1]["body"], "Why?");
    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed.as_array().expect("list").len(), 1);
}

#[tokio::test]
async fn a_revision_with_no_threads_lists_empty() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_empty");
    invoke_ok(&state, "create_review_thread", create_payload()).await;

    let listed = invoke_ok(
        &state,
        "list_review_threads",
        json!({ "namespace": "github", "targetKey": "gh:acme/web#1421", "revision": "sha-2" }),
    )
    .await;

    assert_eq!(listed, json!([]));
}

#[tokio::test]
async fn a_structurally_invalid_write_is_rejected_naming_the_field_and_stores_nothing() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_invalid");

    for (case, overrides, field) in [
        (
            "empty file path",
            json!({ "anchor": { "kind": "line", "filePath": "", "line": 42, "side": "RIGHT" } }),
            "filePath",
        ),
        (
            "line below one",
            json!({ "anchor": { "kind": "line", "filePath": "a.rs", "line": 0, "side": "RIGHT" } }),
            "line",
        ),
        (
            "side that is neither LEFT nor RIGHT",
            json!({ "anchor": { "kind": "line", "filePath": "a.rs", "line": 1, "side": "BOTH" } }),
            "side",
        ),
        ("empty body", json!({ "body": "" }), "body"),
    ] {
        let mut payload = create_payload();
        for (key, value) in overrides.as_object().expect("overrides") {
            payload[key] = value.clone();
        }

        let error = invoke(&state, "create_review_thread", payload)
            .await
            .expect_err(&format!("{case} should be rejected"));

        assert_eq!(error.0, StatusCode::BAD_REQUEST, "{case}");
        assert!(
            error.1.contains(field),
            "{case} should name '{field}', got: {}",
            error.1
        );
    }

    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed, json!([]));
}

#[tokio::test]
async fn replying_to_an_unknown_thread_is_rejected_and_creates_no_thread() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_unknown_reply");

    let error = invoke(
        &state,
        "reply_to_review_thread",
        json!({ "threadId": "rt_missing", "role": "human", "body": "Anybody there?" }),
    )
    .await
    .expect_err("reply to an unknown thread should be rejected");

    assert_eq!(error.0, StatusCode::NOT_FOUND);
    assert!(error.1.contains("rt_missing"), "got: {}", error.1);
    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed, json!([]));
}

#[tokio::test]
async fn a_write_notifies_that_scope_only_and_carries_no_thread_snapshot() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_event");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;

    let envelope = events.try_recv().expect("create must publish an event");
    assert_eq!(envelope.event_name, "review-threads-changed");
    assert_eq!(
        envelope.payload,
        json!({ "namespace": "github", "targetKey": "gh:acme/web#1421", "revision": "sha-1" }),
        "the notification must name the scope and carry no thread snapshot"
    );

    invoke_ok(
        &state,
        "reply_to_review_thread",
        json!({ "threadId": created["id"], "role": "human", "body": "Why?" }),
    )
    .await;

    let reply_envelope = events.try_recv().expect("reply must publish an event");
    assert_eq!(reply_envelope.event_name, "review-threads-changed");
    assert_eq!(reply_envelope.payload, envelope.payload);
}

#[tokio::test]
async fn a_repeated_idempotency_key_returns_the_stored_thread_and_publishes_nothing() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_idempotent");
    let mut payload = create_payload();
    payload["idempotencyKey"] = json!("review-1");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let created = invoke_ok(&state, "create_review_thread", payload.clone()).await;
    events.try_recv().expect("the first create must publish");

    let repeated = invoke_ok(&state, "create_review_thread", payload).await;

    assert_eq!(repeated["id"], created["id"]);
    assert_eq!(repeated["idempotencyKey"], "review-1");
    assert!(
        events.try_recv().is_err(),
        "a repeat stores nothing, so there is nothing to re-list"
    );
    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed.as_array().expect("list").len(), 1);
}

#[tokio::test]
async fn a_rejected_write_publishes_no_notification() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_no_event");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let mut payload = create_payload();
    payload["body"] = json!("");
    invoke(&state, "create_review_thread", payload)
        .await
        .expect_err("an empty body should be rejected");

    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn a_target_key_that_matches_no_other_host_record_is_accepted() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_unknown_target");
    let scope = json!({
        "namespace": "made-up",
        "targetKey": "nothing-references-this",
        "revision": "rev",
    });
    let mut payload = create_payload();
    for (key, value) in scope.as_object().expect("scope") {
        payload[key] = value.clone();
    }

    invoke_ok(&state, "create_review_thread", payload).await;

    let listed = invoke_ok(&state, "list_review_threads", scope).await;
    assert_eq!(listed.as_array().expect("list").len(), 1);
}

#[tokio::test]
async fn a_status_change_is_listed_back_and_notifies_the_scope() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_status");
    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;
    let thread_id = created["id"].as_str().expect("thread id").to_string();
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let resolved = invoke_ok(
        &state,
        "set_review_thread_status",
        json!({ "threadId": thread_id, "status": "resolved" }),
    )
    .await;

    assert_eq!(resolved["status"], "resolved");
    assert_eq!(resolved["awaiting"], created["awaiting"]);
    let envelope = events
        .try_recv()
        .expect("a status change must publish an event");
    assert_eq!(envelope.event_name, "review-threads-changed");
    assert_eq!(
        envelope.payload,
        json!({ "namespace": "github", "targetKey": "gh:acme/web#1421", "revision": "sha-1" })
    );
    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed[0]["status"], "resolved");
}

#[tokio::test]
async fn a_reviewer_decision_and_the_agent_turn_move_independently() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_two_axes");
    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;
    let thread_id = created["id"].clone();
    assert_eq!(created["status"], "open");
    assert_eq!(created["awaiting"], "none");

    let asked = invoke_ok(
        &state,
        "reply_to_review_thread",
        json!({ "threadId": thread_id, "role": "human", "body": "Why?", "awaiting": "agent" }),
    )
    .await;
    assert_eq!(asked["status"], "open");
    assert_eq!(asked["awaiting"], "agent");

    invoke_ok(
        &state,
        "set_review_thread_awaiting",
        json!({ "threadId": thread_id, "awaiting": "error" }),
    )
    .await;
    let resolved = invoke_ok(
        &state,
        "set_review_thread_status",
        json!({ "threadId": thread_id, "status": "resolved" }),
    )
    .await;

    assert_eq!(resolved["status"], "resolved");
    assert_eq!(resolved["awaiting"], "error");
}

#[tokio::test]
async fn marking_a_thread_seen_reads_its_latest_agent_message_until_a_newer_one_arrives() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_seen");
    let mut payload = create_payload();
    payload["origin"] = json!("agent");
    let created = invoke_ok(&state, "create_review_thread", payload).await;
    let thread_id = created["id"].clone();
    assert_eq!(created["hasUnreadAgentMessage"], true);

    let seen = invoke_ok(
        &state,
        "mark_review_thread_seen",
        json!({ "threadId": thread_id }),
    )
    .await;
    assert_eq!(seen["hasUnreadAgentMessage"], false);

    let answered = invoke_ok(
        &state,
        "reply_to_review_thread",
        json!({ "threadId": thread_id, "role": "agent", "body": "Fixed", "awaiting": "none" }),
    )
    .await;

    assert_eq!(answered["hasUnreadAgentMessage"], true);
    assert_eq!(
        answered["seenAt"], seen["seenAt"],
        "a newer agent message must not clear the seen record"
    );
}

#[tokio::test]
async fn an_unsupported_state_value_is_rejected_naming_the_field() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_invalid_state");
    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;
    let thread_id = created["id"].clone();

    for (command, payload, field) in [
        (
            "set_review_thread_status",
            json!({ "threadId": thread_id, "status": "approved" }),
            "status",
        ),
        (
            "set_review_thread_awaiting",
            json!({ "threadId": thread_id, "awaiting": "answered" }),
            "awaiting",
        ),
        (
            "reply_to_review_thread",
            json!({ "threadId": thread_id, "role": "agent", "body": "hi", "awaiting": "answered" }),
            "awaiting",
        ),
    ] {
        let error = invoke(&state, command, payload)
            .await
            .expect_err("a legacy state value should be rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST, "{command}");
        assert!(error.1.contains(field), "{command} got: {}", error.1);
    }

    let listed = invoke_ok(&state, "list_review_threads", scope_payload()).await;
    assert_eq!(listed[0]["status"], "open");
    assert_eq!(listed[0]["awaiting"], "none");
    assert_eq!(listed[0]["messages"].as_array().expect("messages").len(), 1);
}

#[tokio::test]
async fn a_state_change_on_an_unknown_thread_is_rejected_and_publishes_no_notification() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_unknown_state");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    for (command, payload) in [
        (
            "set_review_thread_status",
            json!({ "threadId": "rt_missing", "status": "resolved" }),
        ),
        (
            "set_review_thread_awaiting",
            json!({ "threadId": "rt_missing", "awaiting": "agent" }),
        ),
        (
            "mark_review_thread_seen",
            json!({ "threadId": "rt_missing" }),
        ),
    ] {
        let error = invoke(&state, command, payload)
            .await
            .expect_err("an unknown thread should be rejected");

        assert_eq!(error.0, StatusCode::NOT_FOUND, "{command}");
        assert!(error.1.contains("rt_missing"), "{command} got: {}", error.1);
    }

    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn every_state_write_notifies_the_scope_of_the_thread_it_changed() {
    let (state, _temp_dir) = test_state("app_invoke_review_threads_state_events");
    let created = invoke_ok(&state, "create_review_thread", create_payload()).await;
    let thread_id = created["id"].clone();
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    for (command, payload) in [
        (
            "set_review_thread_status",
            json!({ "threadId": thread_id, "status": "resolved" }),
        ),
        (
            "set_review_thread_awaiting",
            json!({ "threadId": thread_id, "awaiting": "error" }),
        ),
        ("mark_review_thread_seen", json!({ "threadId": thread_id })),
    ] {
        invoke_ok(&state, command, payload).await;

        let envelope = events
            .try_recv()
            .unwrap_or_else(|_| panic!("{command} must publish an event"));
        assert_eq!(envelope.event_name, "review-threads-changed");
        assert_eq!(
            envelope.payload,
            json!({ "namespace": "github", "targetKey": "gh:acme/web#1421", "revision": "sha-1" })
        );
    }
}
