pub(crate) mod payload;

mod agent_generate;
mod companion;
mod core;
mod core_unmatched;
mod files_review;
mod github_review;
mod jira;
mod lifecycle;
mod local_skills;
mod plugins;
mod pty;
mod pty_payload;
mod runtime;
mod whisper;

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;

use crate::{
    app_events::publish_app_event_to_runtime,
    db,
    http_server::{AppInvokeRequest, AppState, TaskOperation},
    whisper_manager::WhisperModelSize,
};
use axum::http::StatusCode;
pub(crate) use lifecycle::start_task;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

type AppResult<T> = Result<T, (StatusCode, String)>;

fn payload_string(payload: &serde_json::Value, key: &str) -> AppResult<String> {
    payload::string(payload, key).map_err(Into::into)
}

fn payload_optional_string(payload: &serde_json::Value, key: &str) -> AppResult<Option<String>> {
    payload::optional_string(payload, key).map_err(Into::into)
}

fn payload_bool(payload: &serde_json::Value, key: &str) -> AppResult<bool> {
    payload::bool(payload, key).map_err(Into::into)
}

fn payload_optional_bool(payload: &serde_json::Value, key: &str) -> AppResult<Option<bool>> {
    payload::optional_bool(payload, key).map_err(Into::into)
}

fn payload_field<T: serde::de::DeserializeOwned>(
    payload: &serde_json::Value,
    key: &str,
) -> AppResult<T> {
    payload::field(payload, key).map_err(Into::into)
}

fn payload_i64(payload: &serde_json::Value, key: &str) -> AppResult<i64> {
    payload::i64(payload, key).map_err(Into::into)
}

fn payload_string_vec(payload: &serde_json::Value, key: &str) -> AppResult<Vec<String>> {
    payload::string_vec(payload, key).map_err(Into::into)
}

fn payload_optional_string_vec(
    payload: &serde_json::Value,
    key: &str,
) -> AppResult<Option<Vec<String>>> {
    payload::optional_string_vec(payload, key).map_err(Into::into)
}

fn payload_optional_usize(payload: &serde_json::Value, key: &str) -> AppResult<Option<usize>> {
    payload::optional_usize(payload, key).map_err(Into::into)
}

fn json_value<T: Serialize>(value: T) -> AppResult<serde_json::Value> {
    serde_json::to_value(value).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize app IPC response: {e}"),
        )
    })
}

fn publish_task_changed(state: &AppState, task_id: &str, project_id: Option<&str>) {
    let mut payload = serde_json::json!({ "action": "updated", "task_id": task_id });
    if let Some(project_id) = project_id {
        payload["project_id"] = serde_json::json!(project_id);
    }
    publish_task_changed_payload(state, payload);
}

fn publish_task_changed_payload(state: &AppState, payload: serde_json::Value) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "task-changed",
        &payload,
    );
}

fn publish_project_catalog_changed(state: &AppState) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "project-catalog-changed",
        &serde_json::json!({}),
    );
}

fn publish_project_board_changed(state: &AppState, project_id: &str) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "project-board-changed",
        &serde_json::json!({ "project_id": project_id }),
    );
}

fn publish_project_changed(state: &AppState, project_id: &str) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "project-changed",
        &serde_json::json!({ "project_id": project_id }),
    );
}
pub(crate) async fn handle_companion_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    companion::handle_app_companion_command(state, request).await
}

pub(crate) async fn handle_core_task_project_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    core::handle_app_core_task_project_command(state, request).await
}

pub(crate) async fn handle_resume_startup_sessions_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    lifecycle::handle_app_resume_startup_sessions_command(state, request).await
}

pub(crate) async fn handle_start_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    lifecycle::handle_app_start_implementation_command(state, request).await
}

pub(crate) async fn handle_pty_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    pty::handle_app_pty_command(state, request).await
}

pub(crate) async fn handle_plugin_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    plugins::handle_app_plugin_command(state, request).await
}

pub(crate) async fn handle_github_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    github_review::handle_app_github_review_command(state, request).await
}

pub(crate) async fn handle_files_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    files_review::handle_app_files_review_command(state, request).await
}

pub(crate) async fn handle_agent_generate_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    agent_generate::handle_app_agent_generate_command(state, request).await
}

pub(crate) async fn handle_jira_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    jira::handle_app_jira_command(state, request).await
}

pub(crate) async fn handle_runtime_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    runtime::handle_app_runtime_command(state, request).await
}

pub(crate) async fn handle_unmatched_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    core_unmatched::handle_app_unmatched_command(state, request).await
}

pub(crate) async fn handle_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    if let Some(value) = handle_whisper_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_companion_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_core_task_project_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_resume_startup_sessions_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_start_implementation_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_pty_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_github_review_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_plugin_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_files_review_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_agent_generate_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_jira_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_runtime_command(state, request).await? {
        return Ok(value);
    }

    handle_unmatched_command(state, request).await
}

pub(crate) async fn handle_whisper_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    whisper::handle_app_whisper_command(state, request).await
}
