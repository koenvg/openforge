use super::AppState;
use crate::{
    agent_generation_identity::ScopedAgentPrincipal,
    app_events::publish_app_event_to_runtime,
    db::{ScopedAgentSessionStatus, ScopedTurnTransition},
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
    event_type: Option<String>,
    kind: Option<String>,
    raw_event_type: Option<String>,
    provider: Option<String>,
    provider_session_id: Option<String>,
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
            .is_some_and(|row| row.status == ScopedAgentSessionStatus::Starting);
        if !launch_is_starting || attempt + 1 == STARTUP_RETRY_ATTEMPTS {
            return Ok(ScopedTurnTransition::Rejected);
        }
        tokio::time::sleep(STARTUP_RETRY_DELAY).await;
    }
    Ok(ScopedTurnTransition::Rejected)
}

async fn record_provider_session_id(
    state: &AppState,
    session_id: &str,
    provider: &str,
    pty_instance_id: u64,
    provider_session_id: &str,
) -> Result<bool, crate::db::ScopedAgentSessionStoreError> {
    for attempt in 0..STARTUP_RETRY_ATTEMPTS {
        if crate::db::acquire_db(&state.db).set_scoped_agent_provider_session_id(
            session_id,
            provider,
            pty_instance_id,
            provider_session_id,
        )? {
            return Ok(true);
        }
        let launch_is_starting = crate::db::acquire_db(&state.db)
            .scoped_agent_session_by_id(session_id)?
            .is_some_and(|row| row.status == ScopedAgentSessionStatus::Starting);
        if !launch_is_starting || attempt + 1 == STARTUP_RETRY_ATTEMPTS {
            return Ok(false);
        }
        tokio::time::sleep(STARTUP_RETRY_DELAY).await;
    }
    Ok(false)
}

fn turn_id_for(
    state: &AppState,
    session_id: &str,
    pty_instance_id: u64,
    supplied: Option<&str>,
    starting: bool,
) -> Result<String, StatusCode> {
    if let Some(turn_id) = supplied {
        return Ok(turn_id.to_string());
    }
    let row = crate::db::acquire_db(&state.db)
        .scoped_agent_session_by_id(session_id)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::CONFLICT)?;
    if row.status == ScopedAgentSessionStatus::Starting {
        return Ok(format!("turn-{}", uuid::Uuid::new_v4()));
    }
    if row.pty_instance_id != Some(pty_instance_id) {
        return Err(StatusCode::CONFLICT);
    }
    if !starting || row.status == ScopedAgentSessionStatus::Running {
        if let Some(turn_id) = row.turn_id {
            return Ok(turn_id);
        }
    }
    Ok(format!("turn-{}", uuid::Uuid::new_v4()))
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
        || hook
            .provider_session_id
            .as_ref()
            .is_some_and(|session_id| session_id.is_empty() || session_id.len() > 512)
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let row = crate::db::acquire_db(&state.db)
        .scoped_agent_session_by_id(&principal.session_id)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::CONFLICT)?;
    let event = hook
        .event_type
        .as_deref()
        .or(hook.kind.as_deref())
        .ok_or(StatusCode::BAD_REQUEST)?;
    if !matches!(
        event,
        "user-prompt-submit"
            | "started"
            | "became_busy"
            | "requested_permission"
            | "stop"
            | "became_idle"
            | "ended"
            | "failed"
            | "session-end"
    ) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let provider = hook.provider.as_deref().unwrap_or(&row.provider);
    if provider != row.provider {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(provider_session_id) = hook.provider_session_id.as_deref() {
        if !record_provider_session_id(
            &state,
            &principal.session_id,
            provider,
            hook.pty_instance_id,
            provider_session_id,
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        {
            return Err(StatusCode::CONFLICT);
        }
    }

    let _raw_event_type = hook.raw_event_type.as_deref();
    let transition = match event {
        "user-prompt-submit" | "started" | "became_busy" | "requested_permission" => {
            let turn_id = turn_id_for(
                &state,
                &principal.session_id,
                hook.pty_instance_id,
                hook.turn_id.as_deref(),
                true,
            )?;
            begin_turn(
                &state,
                &principal.session_id,
                hook.pty_instance_id,
                &turn_id,
            )
            .await
        }
        "stop" | "became_idle" | "ended" | "failed" => {
            let turn_id = turn_id_for(
                &state,
                &principal.session_id,
                hook.pty_instance_id,
                hook.turn_id.as_deref(),
                false,
            )?;
            crate::db::acquire_db(&state.db).pause_scoped_agent_turn(
                &principal.session_id,
                hook.pty_instance_id,
                &turn_id,
            )
        }
        "session-end" => {
            return if row.pty_instance_id == Some(hook.pty_instance_id) {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(StatusCode::CONFLICT)
            };
        }
        _ => unreachable!("lifecycle event was validated above"),
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
