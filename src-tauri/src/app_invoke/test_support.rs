use crate::{
    backend_runtime::AppHandle,
    github_client::GitHubClient,
    http_server::{
        electron_sidecar_app_handle, AppInvokeRequest, AppState, SidecarReadinessState, TaskClaims,
    },
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::{WhisperManager, WhisperModelSize},
};
use axum::http::StatusCode;
use std::sync::{Arc, Mutex};

pub(crate) fn test_state(name: &str) -> (AppState, tempfile::TempDir) {
    let (db, temp_dir) = crate::db::test_helpers::make_test_db(name);
    let db = Arc::new(Mutex::new(db));
    let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
    let mut pty_manager = PtyManager::new();
    pty_manager.set_pid_dir(temp_dir.path().join("pids"));
    let completed_session_reaper = crate::completed_session_reaper::CompletedSessionReaper::new(
        Arc::clone(&db),
        pty_manager.clone(),
    );
    (
        AppState {
            app: None,
            db: Arc::clone(&db),
            backend_token: Some("test-token".to_string()),
            pty_manager: Some(pty_manager),
            completed_session_reaper,
            github_client: GitHubClient::new(),
            frontend_host_requests:
                crate::frontend_host_request_transport::FrontendHostRequestTransport::production(
                    Some(app_event_tx.clone()),
                ),
            plugin_host: Some(PluginHost::new(AppHandle::new())),
            plugin_lifecycle_locks: crate::plugin_platform::PluginLifecycleLocks::new(),
            app_event_tx: Some(app_event_tx),
            app_event_bus: None,
            whisper: Some(Arc::new(WhisperManager::with_active_model(
                WhisperModelSize::Small,
            ))),
            sidecar_readiness: SidecarReadinessState::new(),
            companion_gateway: None,
            task_claims: TaskClaims::new(),
            task_start_worktree_root: Some(temp_dir.path().join("worktrees")),
            poll_context: crate::github_poller::PollContext::new(),
        },
        temp_dir,
    )
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
