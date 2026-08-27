use crate::{
    http_server::{electron_sidecar_app_handle, AppInvokeRequest, AppState},
    plugin_host::PluginHost,
};
use axum::http::StatusCode;

pub(crate) fn test_state(name: &str) -> (AppState, tempfile::TempDir) {
    crate::test_support::test_state(name, |pty_manager, temp_dir| {
        pty_manager.set_pid_dir(temp_dir.join("pids"));
    })
}

pub(crate) fn test_state_with_backend_app(
    name: &str,
) -> (AppState, tempfile::TempDir, tempfile::TempDir) {
    let (mut state, db_temp_dir) = test_state(name);
    let app_dir = tempfile::tempdir().expect("app data dir should create");
    let app =
        electron_sidecar_app_handle(app_dir.path().to_path_buf(), app_dir.path().to_path_buf());
    state.plugin_host = Some(PluginHost::with_app_event_sender(
        app.clone(),
        state.app_event_tx.clone(),
    ));
    state.app = Some(app);
    (state, db_temp_dir, app_dir)
}

pub(crate) async fn invoke(
    state: &AppState,
    command: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let request = AppInvokeRequest {
        command: command.to_string(),
        payload,
    };
    super::handle_command(state, &request).await
}

pub(crate) async fn invoke_ok(
    state: &AppState,
    command: &str,
    payload: serde_json::Value,
) -> serde_json::Value {
    invoke(state, command, payload)
        .await
        .unwrap_or_else(|err| panic!("{command} should succeed, got {err:?}"))
}

const UNREADABLE_SQLITE_TEXT_VALUE: &[u8] = &[0xff];

pub(crate) fn insert_unreadable_global_config(state: &AppState, key: &str) {
    let db = crate::db::acquire_db(&state.db);
    let conn = db.lock_conn().expect("lock database");
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, UNREADABLE_SQLITE_TEXT_VALUE],
    )
    .expect("store unreadable global config");
}

pub(crate) fn insert_unreadable_project_config(state: &AppState, project_id: &str, key: &str) {
    let db = crate::db::acquire_db(&state.db);
    let conn = db.lock_conn().expect("lock database");
    conn.execute(
        "INSERT OR REPLACE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, key, UNREADABLE_SQLITE_TEXT_VALUE],
    )
    .expect("store unreadable project config");
}

pub(crate) fn assert_config_lookup_error_status(status: StatusCode) {
    assert_eq!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "configuration lookup failure must propagate as an internal server error"
    );
}

pub(crate) fn assert_propagated_config_lookup_error(
    error: (StatusCode, String),
    expected_context: &str,
) {
    let (status, message) = error;
    assert_config_lookup_error_status(status);
    assert!(
        message.contains(expected_context),
        "error should contain {expected_context:?}, got: {message}"
    );
    assert!(
        message.contains("Invalid column type"),
        "error should preserve the SQLite lookup failure, got: {message}"
    );
}
