use super::*;
use crate::whisper_manager::WhisperModelSize;
use axum::body::{to_bytes, Body};
use axum::http::Request;
use std::sync::{Arc, Mutex};
use tower::util::ServiceExt;

async fn response_body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    serde_json::from_slice(&bytes).expect("parse response JSON")
}

async fn response_body_text(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    String::from_utf8(bytes.to_vec()).expect("response body should be UTF-8")
}

fn test_state(name: &str) -> (AppState, tempfile::TempDir) {
    let (db, temp_dir) = crate::db::test_helpers::make_test_db(name);
    let db = Arc::new(Mutex::new(db));
    let pty_manager = PtyManager::new();
    let completed_session_reaper = crate::completed_session_reaper::CompletedSessionReaper::new(
        Arc::clone(&db),
        pty_manager.clone(),
    );
    let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
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
            plugin_host: Some(PluginHost::new(crate::backend_runtime::AppHandle::new())),
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

mod handlers;
mod hook_lifecycle;
mod models;
mod project_resolution;
mod shutdown;
mod transport;
