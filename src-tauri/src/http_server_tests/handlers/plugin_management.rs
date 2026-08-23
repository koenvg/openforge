use super::plugin_fixtures::{
    assert_no_app_event, seed_http_app_plugin, seed_http_plugin, write_local_plugin_package,
};
use super::*;

#[tokio::test]
async fn test_app_plugin_install_stays_disabled_and_reload_uses_installed_artifacts() {
    let (mut state, path) = test_state("http_install_plugin_from_local_handler");
    let plugin_source = tempfile::tempdir().expect("create plugin source tempdir");
    let app_data_dir = tempfile::tempdir().expect("create app data tempdir");
    let resource_dir = tempfile::tempdir().expect("create resource tempdir");
    write_local_plugin_package(plugin_source.path(), "com.example.http-install", "app");
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
        .clone()
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
    assert!(installed.package_metadata.contains(r#""enablement":"app""#));
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_enabled_app_plugins()
        .expect("enabled app plugins")
        .is_empty());
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

    let reload_response = router
        .oneshot(
            Request::builder()
                .uri("/reload_plugin")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"pluginId":"com.example.http-install"}"#))
                .expect("build reload request"),
        )
        .await
        .expect("reload request should succeed");
    assert_eq!(reload_response.status(), StatusCode::OK);
    let reload_json = response_body_json(reload_response).await;
    assert_eq!(reload_json["plugin_id"], "com.example.http-install");
    assert_eq!(reload_json["project_id"], serde_json::Value::Null);
    assert_eq!(reload_json["reloaded"], true);

    let reload_event = events.recv().await.expect("plugin reload event");
    assert_eq!(reload_event.event_name, "plugin-reload-requested");
    assert_eq!(
        reload_event.payload["plugin_id"],
        "com.example.http-install"
    );
    assert_eq!(reload_event.payload["project_id"], serde_json::Value::Null);
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_install_plugin_from_local_handler_maps_missing_app_path_state() {
    let (state, _temp_dir) = test_state("http_install_plugin_from_local_no_app_path");
    let plugin_source = tempfile::tempdir().expect("create plugin source tempdir");
    write_local_plugin_package(plugin_source.path(), "com.example.no-app", "project");
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
}

#[tokio::test]
async fn test_set_plugin_enabled_handler_updates_db_with_camel_case_payload_and_publishes_events() {
    let (state, _temp_dir) = test_state("http_set_plugin_enabled_handler");
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
}

#[tokio::test]
async fn test_set_app_plugin_enabled_handler_updates_db_and_publishes_event() {
    let (state, path) = test_state("http_set_app_plugin_enabled_handler");
    seed_http_app_plugin(&state, "com.example.app-enable");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state.clone());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/set_app_plugin_enabled")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.app-enable","enabled":true}"#,
                ))
                .expect("build enable request"),
        )
        .await
        .expect("enable request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["plugin_id"], "com.example.app-enable");
    assert_eq!(json["enabled"], true);
    let enabled_plugins = state
        .db
        .lock()
        .expect("lock db")
        .get_enabled_app_plugins()
        .expect("enabled app plugins");
    assert_eq!(enabled_plugins.len(), 1);

    let event = events.recv().await.expect("enable event");
    assert_eq!(event.event_name, "app-plugin-enablement-changed");
    assert_eq!(event.payload["plugin_id"], "com.example.app-enable");
    assert_eq!(event.payload["enabled"], true);
    assert_no_app_event(&mut events);

    let disable_response = router
        .oneshot(
            Request::builder()
                .uri("/set_app_plugin_enabled")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"pluginId":"com.example.app-enable","enabled":false}"#,
                ))
                .expect("build disable request"),
        )
        .await
        .expect("disable request should succeed");
    assert_eq!(disable_response.status(), StatusCode::OK);
    let disabled_json = response_body_json(disable_response).await;
    assert_eq!(disabled_json["enabled"], false);
    let remaining_enabled_plugins = state
        .db
        .lock()
        .expect("lock db after disable")
        .get_enabled_app_plugins()
        .expect("enabled app plugins after disable");
    assert!(remaining_enabled_plugins.is_empty());

    let app_disable_event = events.recv().await.expect("app disable event");
    assert_eq!(
        app_disable_event.event_name,
        "app-plugin-enablement-changed"
    );
    assert_eq!(
        app_disable_event.payload["plugin_id"],
        "com.example.app-enable"
    );
    assert_eq!(app_disable_event.payload["enabled"], false);
    assert_no_app_event(&mut events);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_plugin_enablement_handlers_reject_the_wrong_lifecycle_scope() {
    let (state, path) = test_state("http_plugin_enablement_scope_validation");
    state
        .db
        .lock()
        .expect("lock db")
        .create_project("Project", "/tmp/project")
        .expect("create project");
    seed_http_plugin(&state, "com.example.project-scope");
    seed_http_app_plugin(&state, "com.example.app-scope");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();
    let router = create_router(state);

    let cases = [
        (
            "/set_app_plugin_enabled",
            r#"{"pluginId":"com.example.project-scope","enabled":true}"#,
            "uses project enablement",
        ),
        (
            "/set_plugin_enabled",
            r#"{"pluginId":"com.example.app-scope","projectId":"P-1","enabled":true}"#,
            "uses app enablement",
        ),
    ];

    for (endpoint, body, expected_message) in cases {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(endpoint)
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .expect("build scope validation request"),
            )
            .await
            .expect("scope validation request should complete");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(response_body_text(response)
            .await
            .contains(expected_message));
    }

    assert_no_app_event(&mut events);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_reload_plugin_handler_publishes_reload_event_with_camel_case_payload() {
    let (state, _temp_dir) = test_state("http_reload_plugin_handler");
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
}

#[tokio::test]
async fn test_reload_plugin_handler_returns_not_found_for_unknown_plugin_without_event() {
    let (state, _temp_dir) = test_state("http_reload_plugin_unknown");
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
}
