use crate::{
    backend_runtime::AppHandle,
    github_client::GitHubClient,
    http_server::{AppState, SidecarReadinessState, TaskClaims},
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::{WhisperManager, WhisperModelSize},
};
use std::{path::Path, sync::Arc};

pub(crate) fn test_state(
    name: &str,
    configure_pty_manager: impl FnOnce(&mut PtyManager, &Path),
) -> (AppState, tempfile::TempDir) {
    let (db, temp_dir) = crate::db::test_helpers::make_test_db(name);
    let db = Arc::new(std::sync::Mutex::new(db));
    let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
    let mut pty_manager = PtyManager::new();
    configure_pty_manager(&mut pty_manager, temp_dir.path());

    (
        AppState {
            app: None,
            db: Arc::clone(&db),
            backend_token: Some("test-token".to_string()),
            pty_manager: Some(pty_manager),
            deferred_completion_watcher:
                crate::http_server::deferred_completion::DeferredCompletionWatcher::new(),
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
            process_memory_history: crate::process_memory_history::ProcessMemoryHistory::default(),
            poll_context: crate::github_poller::PollContext::new(),
        },
        temp_dir,
    )
}
