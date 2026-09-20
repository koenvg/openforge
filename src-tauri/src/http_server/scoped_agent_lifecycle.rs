use super::AppState;
use crate::{
    agent_generation_identity::ScopedAgentPrincipal, app_events::publish_app_event_to_runtime,
    db::ScopedTurnTransition,
};
use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    routing::post,
    Router,
};
use serde::Deserialize;

const STARTUP_RETRY_ATTEMPTS: usize = 20;
const STARTUP_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(10);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScopedLifecycleHook {
    event_type: String,
    pty_instance_id: u64,
    turn_id: Option<String>,
}

async fn begin_turn(
    state: &AppState,
    session_id: &str,
    pty_instance_id: u64,
    turn_id: &str,
) -> Result<ScopedTurnTransition, crate::db::ScopedAgentSessionStoreError> {
    for attempt in 0..STARTUP_RETRY_ATTEMPTS {
        let transition = crate::db::acquire_db(&state.db).begin_scoped_agent_turn(
            session_id,
            pty_instance_id,
            turn_id,
        )?;
        if transition != ScopedTurnTransition::Rejected {
            return Ok(transition);
        }
        let launch_is_starting = crate::db::acquire_db(&state.db)
            .scoped_agent_session_by_id(session_id)?
            .is_some_and(|row| row.status == crate::db::ScopedAgentSessionStatus::Starting);
        if !launch_is_starting || attempt + 1 == STARTUP_RETRY_ATTEMPTS {
            return Ok(ScopedTurnTransition::Rejected);
        }
        tokio::time::sleep(STARTUP_RETRY_DELAY).await;
    }
    Ok(ScopedTurnTransition::Rejected)
}

async fn receive(
    State(state): State<AppState>,
    Extension(principal): Extension<ScopedAgentPrincipal>,
    Json(hook): Json<ScopedLifecycleHook>,
) -> Result<StatusCode, StatusCode> {
    if hook.pty_instance_id == 0
        || hook
            .turn_id
            .as_ref()
            .is_some_and(|turn_id| turn_id.is_empty() || turn_id.len() > 128)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let transition = match hook.event_type.as_str() {
        "user-prompt-submit" => {
            let turn_id = hook.turn_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;
            begin_turn(&state, &principal.session_id, hook.pty_instance_id, turn_id).await
        }
        "stop" => {
            let turn_id = hook.turn_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;
            crate::db::acquire_db(&state.db).pause_scoped_agent_turn(
                &principal.session_id,
                hook.pty_instance_id,
                turn_id,
            )
        }
        // PTY exit remains authoritative for terminal session outcome and queue promotion,
        // but the hook still has to prove it belongs to the current PTY generation.
        "session-end" => {
            let current = crate::db::acquire_db(&state.db)
                .scoped_agent_session_by_id(&principal.session_id)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
            return if current.is_some_and(|row| row.pty_instance_id == Some(hook.pty_instance_id)) {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(StatusCode::CONFLICT)
            };
        }
        _ => return Err(StatusCode::BAD_REQUEST),
    }
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    match transition {
        ScopedTurnTransition::Applied => {
            publish_app_event_to_runtime(
                state.app.as_ref(),
                &state.app_event_tx,
                "scoped-agent-session-changed",
                &serde_json::json!({
                    "pluginId": principal.owner_plugin_id,
                    "namespace": principal.namespace,
                    "targetKey": principal.target_key,
                    "revision": principal.revision,
                }),
            );
            Ok(StatusCode::NO_CONTENT)
        }
        ScopedTurnTransition::Duplicate => Ok(StatusCode::NO_CONTENT),
        ScopedTurnTransition::Rejected => Err(StatusCode::CONFLICT),
    }
}

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/hooks/scoped-agent-lifecycle", post(receive))
}
