use super::{policy, ResumeTarget};
use crate::{backend_runtime::AppHandle, db, providers};
use log::{info, warn};
use std::sync::{Arc, Mutex};

pub(super) fn database_lock_message(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: database lock error: {error}")
}

pub(super) fn load_targets(app: &AppHandle) -> Result<Vec<ResumeTarget>, String> {
    let database = app.state::<Arc<Mutex<db::Database>>>();
    let db = database
        .lock()
        .map_err(|error| database_lock_message("failed to get resumable task workspaces", error))?;
    super::targets::load_resume_targets(&db)
        .map_err(|error| format!("failed to get resumable task workspaces: {error}"))
}

pub(super) fn latest_session(
    app: &AppHandle,
    target: &ResumeTarget,
) -> Result<Option<db::AgentSessionRow>, String> {
    let database = app.state::<Arc<Mutex<db::Database>>>();
    let db = database.lock().map_err(|error| {
        database_lock_message(
            &format!("failed to load latest session for task {}", target.task_id),
            error,
        )
    })?;
    // Preserve startup's best-effort handling of a failed session query.
    Ok(db
        .get_latest_session_for_ticket(&target.task_id)
        .ok()
        .flatten())
}

pub(super) fn persist_recovery(
    app: &AppHandle,
    session: &db::AgentSessionRow,
    target: &ResumeTarget,
    result: &providers::ProviderSessionResult,
) -> Result<(), String> {
    let database = app.state::<Arc<Mutex<db::Database>>>();
    let db = database.lock().map_err(|error| {
        database_lock_message(
            &format!(
                "failed to persist resumed session state for task {}",
                target.task_id
            ),
            error,
        )
    })?;
    persist_resumed_session_state(&db, Some(session), target, &session.provider, result);
    Ok(())
}

pub(super) fn interrupt_failed_recovery(
    app: &AppHandle,
    session: &db::AgentSessionRow,
    target: &ResumeTarget,
) -> Result<(), String> {
    if !policy::interrupt_on_resume_failure(&session.provider) {
        return Ok(());
    }
    let database = app.state::<Arc<Mutex<db::Database>>>();
    let db = database.lock().map_err(|error| {
        database_lock_message(
            &format!(
                "failed to mark resumed session interrupted for task {}",
                target.task_id
            ),
            error,
        )
    })?;
    let _ = db.update_agent_session(
        &session.id,
        &session.stage,
        "interrupted",
        None,
        Some("App restarted"),
    );
    Ok(())
}

pub(super) fn persist_resumed_session_state(
    db: &db::Database,
    latest_session: Option<&db::AgentSessionRow>,
    target: &ResumeTarget,
    provider_name: &str,
    provider_result: &providers::ProviderSessionResult,
) {
    if provider_name == "pi" {
        if let (Some(session), Some(pi_session_id)) =
            (latest_session, provider_result.pi_session_id.as_deref())
        {
            if session.pi_session_id.as_deref() != Some(pi_session_id) {
                if let Err(e) = db.set_agent_session_pi_id(&session.id, pi_session_id) {
                    warn!(
                        "[startup] Failed to persist resumed Pi session id for {}: {}",
                        target.task_id, e
                    );
                }
            }
        }
    }
    restore_resumed_session_state(
        db,
        latest_session,
        target,
        provider_name,
        provider_result.pty_instance_id,
    );
}

pub(super) fn restore_resumed_session_state(
    db: &db::Database,
    latest_session: Option<&db::AgentSessionRow>,
    target: &ResumeTarget,
    provider_name: &str,
    pty_instance_id: Option<u64>,
) {
    if let Err(e) = db.upsert_task_workspace_record(
        &target.task_id,
        &target.project_id,
        &target.workspace_path,
        &target.repo_path,
        &target.kind,
        target.branch_name.as_deref(),
        provider_name,
        "active",
    ) {
        warn!(
            "[startup] Failed to update task workspace for {}: {}",
            target.task_id, e
        );
    }
    if let Some(session) = latest_session {
        if let Some(pty_instance_id) = pty_instance_id {
            if let Err(e) = db.set_agent_session_pty_instance_id(&session.id, pty_instance_id) {
                warn!(
                    "[startup] Failed to restore PTY instance ID for session {} on task {}: {}",
                    session.id, target.task_id, e
                );
            }
        }
        if let Some(status) = policy::restored_status(session, provider_name, pty_instance_id) {
            let checkpoint_data = if status == "running" {
                None
            } else {
                session.checkpoint_data.as_deref()
            };
            if let Err(e) =
                db.update_agent_session(&session.id, &session.stage, status, checkpoint_data, None)
            {
                warn!(
                    "[startup] Failed to restore session {} for task {}: {}",
                    session.id, target.task_id, e
                );
            }
        }
    }
}

pub(super) fn mark_unresumed_running_sessions_interrupted(
    app: &AppHandle,
    stale_running_session_cutoff: i64,
    live_tasks: &[(&str, u64)],
) {
    let db = app.state::<Arc<Mutex<db::Database>>>();
    let db_lock = match db.lock() {
        Ok(db_lock) => db_lock,
        Err(e) => {
            warn!(
                "[startup] Failed to mark unresumed running sessions: database lock error: {}",
                e
            );
            return;
        }
    };
    match db_lock.mark_running_sessions_interrupted_except_live_agents(
        stale_running_session_cutoff,
        live_tasks,
    ) {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Marked {} unresumed running sessions as interrupted",
                count
            );
        }
        Ok(_) => {}
        Err(e) => warn!("[startup] Failed to mark stale sessions: {}", e),
    }
}
