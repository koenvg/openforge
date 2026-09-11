use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

fn build_host() -> (PluginHost, tempfile::TempDir) {
    let (database, temp_dir) = crate::db::test_helpers::make_test_db("plugin_host_review_threads");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    (PluginHost::new(app), temp_dir)
}

fn create_params(plugin_id: &str) -> Value {
    json!({
        "pluginId": plugin_id,
        "namespace": "github",
        "targetKey": "gh:acme/web#1421",
        "revision": "sha-1",
        "origin": "plugin",
        "body": "Missing null check",
        "anchor": { "kind": "line", "filePath": "src/main.rs", "line": 42, "side": "RIGHT" },
    })
}

fn scope_params() -> Value {
    json!({
        "namespace": "github",
        "targetKey": "gh:acme/web#1421",
        "revision": "sha-1",
    })
}

#[tokio::test]
async fn a_plugin_that_is_not_built_into_the_application_can_create_reply_and_list() {
    let (host, _temp_dir) = build_host();
    let third_party = "com.example.reviewer";

    let created = host
        .handle_host_callback(
            "openforge.reviewThreads.create",
            &create_params(third_party),
        )
        .await
        .expect("a plugin without a built-in identity must be able to create a Review Thread");
    let thread_id = created["id"].as_str().expect("thread id");

    host.handle_host_callback(
        "openforge.reviewThreads.reply",
        &json!({ "pluginId": third_party, "threadId": thread_id, "role": "human", "body": "Why?" }),
    )
    .await
    .expect("reply");

    let listed = host
        .handle_host_callback("openforge.reviewThreads.list", &scope_params())
        .await
        .expect("list");

    assert_eq!(listed.as_array().expect("list").len(), 1);
    assert_eq!(listed[0]["id"], thread_id);
    assert_eq!(listed[0]["messages"].as_array().expect("messages").len(), 2);
}

#[tokio::test]
async fn every_enabled_plugin_reaches_the_same_review_thread_store() {
    let (host, _temp_dir) = build_host();

    for plugin_id in ["com.openforge.github-sync", "com.example.reviewer"] {
        host.handle_host_callback("openforge.reviewThreads.create", &create_params(plugin_id))
            .await
            .unwrap_or_else(|error| panic!("{plugin_id} should be able to create: {error}"));
    }

    let listed = host
        .handle_host_callback("openforge.reviewThreads.list", &scope_params())
        .await
        .expect("list");
    assert_eq!(listed.as_array().expect("list").len(), 2);
}

#[tokio::test]
async fn a_plugin_repeating_an_idempotency_key_gets_the_thread_it_created_first() {
    let (host, _temp_dir) = build_host();
    let mut params = create_params("com.example.reviewer");
    params["idempotencyKey"] = json!("review-1");

    let created = host
        .handle_host_callback("openforge.reviewThreads.create", &params)
        .await
        .expect("create");
    let repeated = host
        .handle_host_callback("openforge.reviewThreads.create", &params)
        .await
        .expect("repeat");

    assert_eq!(repeated["id"], created["id"]);
    assert_eq!(repeated["idempotencyKey"], "review-1");
    let listed = host
        .handle_host_callback("openforge.reviewThreads.list", &scope_params())
        .await
        .expect("list");
    assert_eq!(listed.as_array().expect("list").len(), 1);
}

#[tokio::test]
async fn a_structurally_invalid_create_is_rejected_naming_the_field() {
    let (host, _temp_dir) = build_host();
    let mut params = create_params("com.example.reviewer");
    params["anchor"]["side"] = json!("BOTH");

    let error = host
        .handle_host_callback("openforge.reviewThreads.create", &params)
        .await
        .expect_err("an unsupported side should be rejected");

    assert!(error.contains("side"), "got: {error}");
}

#[tokio::test]
async fn an_empty_body_is_rejected_with_the_same_message_the_store_produces() {
    let (host, _temp_dir) = build_host();
    let mut params = create_params("com.example.reviewer");
    params["body"] = json!("");

    let error = host
        .handle_host_callback("openforge.reviewThreads.create", &params)
        .await
        .expect_err("an empty body should be rejected");

    assert!(
        error.contains("Review Thread field 'body' must not be empty"),
        "got: {error}"
    );
}

#[tokio::test]
async fn replying_to_an_unknown_thread_is_rejected() {
    let (host, _temp_dir) = build_host();

    let error = host
        .handle_host_callback(
            "openforge.reviewThreads.reply",
            &json!({ "threadId": "rt_missing", "role": "human", "body": "Anybody there?" }),
        )
        .await
        .expect_err("replying to an unknown thread should be rejected");

    assert!(error.contains("rt_missing"), "got: {error}");
}
