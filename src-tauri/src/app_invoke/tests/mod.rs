use super::test_support::{
    assert_propagated_config_lookup_error, insert_unreadable_global_config,
    insert_unreadable_project_config, invoke, invoke_ok, test_state, test_state_with_backend_app,
};
use axum::http::StatusCode;
use serde_json::json;

use std::time::Duration;

const DAEMON_SHELL_CONTRACT_TIMEOUT: Duration = Duration::from_secs(30);
mod companion;
mod core;
mod daemon_fixture;
mod daemon_scoped;
mod daemon_shell_events;
mod daemon_shell_recovery;
mod daemon_shells;
mod documents;
mod files_review;
mod github_review;
mod lifecycle;
mod plugins;
mod pty;
mod review_threads;
mod runtime;
mod task_dependency_removal;
mod task_labels;
mod update_recovery;
mod whisper;
