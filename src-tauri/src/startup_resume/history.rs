use super::{persistence, policy, ResumeTarget};
use crate::{
    backend_runtime::AppHandle, db, http_server::SidecarReadinessState, providers,
    pty_manager::PtyManager,
};
use log::{error, info, warn};
use std::sync::{Arc, Mutex};

pub(super) async fn recover_target(
    app: &AppHandle,
    target: &ResumeTarget,
    readiness: &SidecarReadinessState,
) {
    let workspace_path = std::path::Path::new(&target.workspace_path);
    if !workspace_path.exists() {
        warn!(
            "[startup] Workspace path missing for task {}, skipping: {}",
            target.task_id, target.workspace_path
        );
        return;
    }
    let latest_session = match persistence::latest_session(app, target) {
        Ok(session) => session,
        Err(message) => {
            error!("[startup] {message}");
            readiness.record_startup_resume_failure(message);
            emit_failed_resume(app, target);
            return;
        }
    };
    if !policy::latest_session_allows_startup_resume(latest_session.as_ref()) {
        if let Some(session) = latest_session.as_ref() {
            info!(
                "[startup] Skipping resume for task {} because latest {} session {} is {}",
                target.task_id, session.provider, session.id, session.status
            );
        } else {
            warn!(
                "[startup] Skipping resume for task {} because no latest session was found",
                target.task_id
            );
        }
        return;
    }
    let Some(session) = latest_session.as_ref() else {
        return;
    };
    let provider_name = session.provider.as_str();
    let provider = match providers::Provider::from_name(
        provider_name,
        app.state::<PtyManager>().inner().clone(),
    ) {
        Ok(provider) => provider,
        Err(e) => {
            warn!(
                "[startup] Unknown provider for task {}: {}",
                target.task_id, e
            );
            return;
        }
    };
    let start_context = providers::ProviderStartContext::new(
        crate::app_events::RuntimeEventPublisher::new(Some(app.clone()), None),
    );
    match provider
        .resume(
            &target.task_id,
            session,
            workspace_path,
            None,
            None,
            None,
            None,
            &start_context,
        )
        .await
    {
        Ok(result) => {
            if let Err(message) = persistence::persist_recovery(app, session, target, &result) {
                error!("[startup] {message}");
                readiness.record_startup_resume_failure(message);
            }
            capture_recovered_completed_session_replay(app, session).await;
            let _ = app.emit(
                "session-resumed",
                serde_json::json!({
                    "task_id": target.task_id,
                    "workspace_path": target.workspace_path,
                    "pty_instance_id": result.pty_instance_id,
                }),
            );
            readiness.record_startup_resume_success();
            info!(
                "[startup] Resumed {} for task {} (port {})",
                provider_name, target.task_id, result.port
            );
        }
        Err(e) => {
            error!(
                "[startup] Failed to resume {} for task {}: {}",
                provider_name, target.task_id, e
            );
            readiness.record_startup_resume_failure(format!(
                "failed to resume {provider_name} for task {}: {e}",
                target.task_id,
            ));
            if let Err(message) = persistence::interrupt_failed_recovery(app, session, target) {
                warn!("[startup] {message}");
                readiness.record_startup_resume_failure(message);
            }
            emit_failed_resume(app, target);
        }
    }
}

fn emit_failed_resume(app: &AppHandle, target: &ResumeTarget) {
    let _ = app.emit(
        "session-resumed",
        serde_json::json!({
            "task_id": target.task_id,
            "workspace_path": target.workspace_path,
        }),
    );
}

pub(super) async fn capture_recovered_completed_session_replay(
    app: &AppHandle,
    session: &db::AgentSessionRow,
) {
    if session.status != "completed" {
        return;
    }
    let Some(manager) = app.try_state::<PtyManager>() else {
        warn!(
            "[startup] Completed Agent Session {} for task {} reattached without replay capture",
            session.id, session.ticket_id
        );
        return;
    };
    let database = app.state::<Arc<Mutex<db::Database>>>();
    crate::completed_session_replay::capture_completed_session_replay(
        database.inner(),
        manager.inner(),
        &session.ticket_id,
    )
    .await;
}
