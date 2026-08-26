use crate::{db, http_server, providers, pty_manager::PtyManager};
use log::{debug, error, info, warn};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

// ============================================================================
// Startup: Resume Agent Sessions
// ============================================================================

#[derive(Debug, Clone)]
pub(crate) struct ResumeTarget {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
    pub(crate) repo_path: String,
    pub(crate) workspace_path: String,
    pub(crate) kind: String,
    pub(crate) branch_name: Option<String>,
}

impl ResumeTarget {
    fn from_task_workspace(workspace: db::TaskWorkspaceRow) -> Self {
        Self {
            task_id: workspace.task_id,
            project_id: workspace.project_id,
            repo_path: workspace.repo_path,
            workspace_path: workspace.workspace_path,
            kind: workspace.kind,
            branch_name: workspace.branch_name,
        }
    }

    fn from_worktree(worktree: db::WorktreeRow) -> Self {
        Self {
            task_id: worktree.task_id,
            project_id: worktree.project_id,
            repo_path: worktree.repo_path,
            workspace_path: worktree.worktree_path,
            kind: "git_worktree".to_string(),
            branch_name: Some(worktree.branch_name),
        }
    }
}

pub(crate) fn load_resume_targets(db: &db::Database) -> rusqlite::Result<Vec<ResumeTarget>> {
    let mut targets: Vec<ResumeTarget> = db
        .get_resumable_task_workspaces()?
        .into_iter()
        .map(ResumeTarget::from_task_workspace)
        .collect();

    let existing_task_ids: HashSet<String> = targets
        .iter()
        .map(|target| target.task_id.clone())
        .collect();

    for worktree in db.get_resumable_worktrees()? {
        if existing_task_ids.contains(&worktree.task_id) {
            continue;
        }

        targets.push(ResumeTarget::from_worktree(worktree));
    }

    Ok(targets)
}

fn startup_resume_database_lock_message(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: database lock error: {error}")
}

fn is_startup_resumable_session_status(status: &str) -> bool {
    db::STARTUP_RESUMABLE_AGENT_SESSION_STATUSES.contains(&status)
}

fn latest_session_allows_startup_resume(latest_session: Option<&db::AgentSessionRow>) -> bool {
    latest_session.is_some_and(|session| {
        is_startup_resumable_session_status(&session.status) || session.status == "completed"
    })
}

pub(crate) fn persist_resumed_session_state(
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

async fn schedule_completed_session_recovery(
    app: &crate::backend_runtime::AppHandle,
    session: &db::AgentSessionRow,
) {
    if session.status != "completed" {
        return;
    }

    let Some(reaper) = app.try_state::<crate::completed_session_reaper::CompletedSessionReaper>()
    else {
        warn!(
            "[startup] Completed Agent Session {} for task {} reattached without replay capture",
            session.id, session.ticket_id
        );
        return;
    };
    reaper.completed(&session.ticket_id).await;
}

pub(crate) async fn resume_task_sessions(
    app: crate::backend_runtime::AppHandle,
    http_ready: tokio::sync::oneshot::Receiver<()>,
    sidecar_readiness: http_server::SidecarReadinessState,
    stale_running_session_cutoff: i64,
) {
    // Wait for the HTTP server to be listening so Claude Code hooks don't get connection-refused
    match http_ready.await {
        Ok(()) => debug!("[startup] HTTP server ready, proceeding with session resume"),
        Err(_) => {
            warn!("[startup] HTTP server ready channel dropped — resuming anyway (hooks may fail)");
        }
    }

    let resume_targets = {
        let db = app.state::<Arc<Mutex<db::Database>>>();
        let db_lock = match db.lock() {
            Ok(db_lock) => db_lock,
            Err(e) => {
                let message = startup_resume_database_lock_message(
                    "failed to get resumable task workspaces",
                    e,
                );
                error!("[startup] {message}");
                sidecar_readiness.mark_startup_resume_degraded(message);
                let _ = app.emit("startup-resume-complete", ());
                return;
            }
        };
        match load_resume_targets(&db_lock) {
            Ok(targets) => targets,
            Err(e) => {
                error!("[startup] Failed to get resumable task workspaces: {}", e);
                sidecar_readiness.mark_startup_resume_degraded(format!(
                    "failed to get resumable task workspaces: {e}"
                ));
                let _ = app.emit("startup-resume-complete", ());
                return;
            }
        }
    };

    if resume_targets.is_empty() {
        mark_unresumed_running_sessions_interrupted(&app, stale_running_session_cutoff);
        sidecar_readiness.mark_startup_resume_complete();
        let _ = app.emit("startup-resume-complete", ());
        return;
    }

    sidecar_readiness.mark_startup_resume_running(resume_targets.len());

    info!(
        "[startup] Resuming agent sessions for {} task(s)",
        resume_targets.len()
    );

    for target in resume_targets {
        let workspace_path = std::path::Path::new(&target.workspace_path);
        if !workspace_path.exists() {
            warn!(
                "[startup] Workspace path missing for task {}, skipping: {}",
                target.task_id, target.workspace_path
            );
            continue;
        }

        // Look up the latest session to determine which provider to use
        let latest_session = {
            let db = app.state::<Arc<Mutex<db::Database>>>();
            let db_lock = match db.lock() {
                Ok(db_lock) => db_lock,
                Err(e) => {
                    let message = startup_resume_database_lock_message(
                        &format!("failed to load latest session for task {}", target.task_id),
                        e,
                    );
                    error!("[startup] {message}");
                    sidecar_readiness.record_startup_resume_failure(message);
                    let _ = app.emit(
                        "session-resumed",
                        serde_json::json!({
                            "task_id": target.task_id,
                            "workspace_path": target.workspace_path,
                        }),
                    );
                    continue;
                }
            };
            db_lock
                .get_latest_session_for_ticket(&target.task_id)
                .ok()
                .flatten()
        };
        if !latest_session_allows_startup_resume(latest_session.as_ref()) {
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
            continue;
        }

        let Some(session_ref) = latest_session.as_ref() else {
            continue;
        };
        let provider_name = session_ref.provider.as_str();

        let provider = match providers::Provider::from_name(
            provider_name,
            app.state::<PtyManager>().inner().clone(),
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(
                    "[startup] Unknown provider for task {}: {}",
                    target.task_id, e
                );
                continue;
            }
        };

        let start_context = providers::ProviderStartContext::new(
            crate::app_events::RuntimeEventPublisher::new(Some(app.clone()), None),
        );

        match provider
            .resume(
                &target.task_id,
                session_ref,
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
                {
                    let db = app.state::<Arc<Mutex<db::Database>>>();
                    match db.lock() {
                        Ok(db_lock) => persist_resumed_session_state(
                            &db_lock,
                            latest_session.as_ref(),
                            &target,
                            provider_name,
                            &result,
                        ),
                        Err(e) => {
                            let message = startup_resume_database_lock_message(
                                &format!(
                                    "failed to persist resumed session state for task {}",
                                    target.task_id
                                ),
                                e,
                            );
                            error!("[startup] {message}");
                            sidecar_readiness.record_startup_resume_failure(message);
                        }
                    };
                }

                schedule_completed_session_recovery(&app, session_ref).await;

                let _ = app.emit(
                    "session-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "workspace_path": target.workspace_path,
                        "pty_instance_id": result.pty_instance_id,
                    }),
                );

                sidecar_readiness.record_startup_resume_success();

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
                sidecar_readiness.record_startup_resume_failure(format!(
                    "failed to resume {provider_name} for task {}: {e}",
                    target.task_id
                ));

                // Mark provider sessions as interrupted on failure for providers that do not
                // have an external status source to reconcile against after startup.
                if matches!(
                    provider_name,
                    "claude-code" | "pi" | "opencode" | "codex" | "grok"
                ) {
                    if let Some(ref session) = latest_session {
                        let db = app.state::<Arc<Mutex<db::Database>>>();
                        match db.lock() {
                            Ok(db_lock) => {
                                let _ = db_lock.update_agent_session(
                                    &session.id,
                                    &session.stage,
                                    "interrupted",
                                    None,
                                    Some("App restarted"),
                                );
                            }
                            Err(e) => {
                                let message = startup_resume_database_lock_message(
                                    &format!(
                                        "failed to mark resumed session interrupted for task {}",
                                        target.task_id
                                    ),
                                    e,
                                );
                                warn!("[startup] {message}");
                                sidecar_readiness.record_startup_resume_failure(message);
                            }
                        };
                    }
                }

                let _ = app.emit(
                    "session-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "workspace_path": target.workspace_path,
                    }),
                );
            }
        }
    }

    mark_unresumed_running_sessions_interrupted(&app, stale_running_session_cutoff);
    sidecar_readiness.mark_startup_resume_complete();
    let _ = app.emit("startup-resume-complete", ());
    info!("[startup] Resume complete, emitted startup-resume-complete event");
}

fn mark_unresumed_running_sessions_interrupted(
    app: &crate::backend_runtime::AppHandle,
    stale_running_session_cutoff: i64,
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

    match db_lock.mark_running_sessions_interrupted_before(stale_running_session_cutoff) {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Marked {} unresumed running sessions as interrupted",
                count
            );
        }
        Ok(_) => {}
        Err(e) => {
            warn!("[startup] Failed to mark stale sessions: {}", e);
        }
    }
}

pub(crate) fn restore_resumed_session_state(
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

        let persisted_status = if matches!(session.status.as_str(), "interrupted" | "running") {
            Some("running")
        } else if matches!(provider_name, "pi" | "opencode" | "codex")
            && pty_instance_id.is_some()
            && matches!(session.status.as_str(), "completed" | "paused")
        {
            Some(session.status.as_str())
        } else {
            None
        };

        if let Some(status) = persisted_status {
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

#[cfg(test)]
mod tests {
    use super::{
        latest_session_allows_startup_resume, load_resume_targets, persist_resumed_session_state,
        restore_resumed_session_state, resume_task_sessions, schedule_completed_session_recovery,
        ResumeTarget,
    };
    use crate::app_events::{AppEventError, AppEventId, EmitReceipt, RustAppEventAdapter};
    use crate::db;
    use crate::db::test_helpers::make_test_db;

    use std::sync::{Arc, Mutex};

    fn test_agent_session_with_status(status: &str) -> db::AgentSessionRow {
        db::AgentSessionRow {
            id: format!("ses-{status}"),
            ticket_id: "T-100".to_string(),
            opencode_session_id: None,
            stage: "implement".to_string(),
            status: status.to_string(),
            checkpoint_data: None,
            pty_instance_id: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: "opencode".to_string(),
            claude_session_id: None,
            pi_session_id: None,
            grok_session_id: None,
        }
    }

    #[test]
    fn latest_session_allows_startup_resume_for_reopenable_statuses() {
        for status in ["running", "paused", "interrupted"] {
            let session = test_agent_session_with_status(status);
            assert!(latest_session_allows_startup_resume(Some(&session)));
        }
        let completed_session = test_agent_session_with_status("completed");
        assert!(
            latest_session_allows_startup_resume(Some(&completed_session)),
            "completed Agent Sessions loaded for missing replay recovery must reattach"
        );

        let failed_session = test_agent_session_with_status("failed");
        assert!(!latest_session_allows_startup_resume(Some(&failed_session)));

        assert!(!latest_session_allows_startup_resume(None));
    }

    #[tokio::test]
    async fn completed_replay_recovery_is_handed_to_idle_reaper() {
        let (database, _temp_dir) = make_test_db("completed_replay_recovery_reaper");
        let project = database
            .create_project("Replay recovery", "/tmp/replay-recovery")
            .expect("create project");
        let task = database
            .create_task("Recover replay", "doing", Some(&project.id), None, None)
            .expect("create task");
        database
            .create_agent_session(
                "ses-replay-recovery",
                &task.id,
                None,
                "implement",
                "completed",
                "pi",
            )
            .expect("create completed Agent Session");

        let database = Arc::new(Mutex::new(database));
        let app = crate::backend_runtime::AppHandle::new();
        app.manage(
            crate::completed_session_reaper::CompletedSessionReaper::new(
                Arc::clone(&database),
                crate::pty_manager::PtyManager::new(),
            ),
        );
        let session = database
            .lock()
            .expect("database lock")
            .get_latest_session_for_ticket(&task.id)
            .expect("load latest Agent Session")
            .expect("latest Agent Session missing");

        schedule_completed_session_recovery(&app, &session).await;

        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task.id)
                .expect("load recovered replay")
                .as_deref(),
            Some("")
        );

        drop(database);
    }

    #[derive(Default)]
    struct RecordingEventAdapter {
        events: Mutex<Vec<String>>,
    }

    impl RustAppEventAdapter for RecordingEventAdapter {
        fn emit(
            &self,
            event_name: &str,
            _payload: serde_json::Value,
        ) -> Result<EmitReceipt, AppEventError> {
            self.events
                .lock()
                .expect("recording event adapter lock poisoned")
                .push(event_name.to_string());
            Ok(EmitReceipt {
                id: AppEventId {
                    epoch: "test".to_string(),
                    seq: 1,
                },
            })
        }
    }

    #[tokio::test]
    async fn resume_task_sessions_reports_degraded_readiness_when_initial_database_lock_is_poisoned(
    ) {
        let (db, _temp_dir) = make_test_db("resume_task_sessions_poisoned_initial_lock");
        let db = Arc::new(Mutex::new(db));
        let poison_db = Arc::clone(&db);
        let _ = std::thread::spawn(move || {
            let _guard = poison_db.lock().expect("lock test database before panic");
            panic!("poison test database lock");
        })
        .join();

        let app = crate::backend_runtime::AppHandle::new();
        app.manage(Arc::clone(&db));
        let event_adapter = Arc::new(RecordingEventAdapter::default());
        app.set_app_event_adapter(event_adapter.clone());
        let sidecar_readiness = crate::http_server::SidecarReadinessState::new();
        let (http_ready_tx, http_ready_rx) = tokio::sync::oneshot::channel();
        http_ready_tx.send(()).expect("send http ready signal");

        resume_task_sessions(app, http_ready_rx, sidecar_readiness.clone(), 0).await;

        let startup_resume = sidecar_readiness.startup_resume();
        assert_eq!(startup_resume.phase, "degraded");
        assert!(sidecar_readiness
            .degraded()
            .iter()
            .any(|state| state.area == "startupResume"
                && state.message.contains("database lock error")));
        assert!(event_adapter
            .events
            .lock()
            .expect("read recorded events")
            .iter()
            .any(|event| event == "startup-resume-complete"));
    }

    #[test]
    fn restore_resumed_session_state_marks_interrupted_opencode_session_running_like_other_tty_providers(
    ) {
        let (db, _temp_dir) = make_test_db("restore_resumed_session_state");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");

        let task = db
            .create_task(
                "Resume me",
                "backlog",
                Some(&project.id),
                Some("Resume me"),
                None,
            )
            .expect("create task failed");
        db.update_task_status(&task.id, "doing")
            .expect("update task status failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-100",
            "t-100",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-100",
            &task.id,
            Some("oc-ses-100"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create agent session failed");
        db.mark_running_sessions_interrupted()
            .expect("mark interrupted failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        assert_eq!(session.status, "interrupted");

        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-100".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-100".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", None);

        let restored = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get restored session failed")
            .expect("missing restored session");
        assert_eq!(restored.status, "running");
        assert_eq!(restored.stage, "implement");
        assert_eq!(restored.error_message, None);

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("missing task workspace");
        assert_eq!(workspace.workspace_path, "/tmp/test-repo/.worktrees/T-100");
        assert_eq!(workspace.kind, "git_worktree");

        drop(db);
    }

    #[test]
    fn restore_resumed_opencode_session_becomes_running_after_tty_resume() {
        let (db, _temp_dir) = make_test_db("restore_resumed_opencode_tty_running");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume OpenCode TTY",
                "doing",
                Some(&project.id),
                Some("Resume OpenCode TTY"),
                Some("opencode"),
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-201",
            "t-201",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-oc-201",
            &task.id,
            Some("oc-ses-201"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create opencode session failed");
        db.mark_running_sessions_interrupted()
            .expect("mark interrupted failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        assert_eq!(session.status, "interrupted");

        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-201".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-201".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", Some(42));

        let restored = db
            .get_agent_session("ses-oc-201")
            .expect("get restored opencode session failed")
            .expect("missing restored opencode session");
        assert_eq!(restored.status, "running");
        assert_eq!(restored.pty_instance_id, Some(42));
        assert_eq!(restored.checkpoint_data, None);
        assert_eq!(restored.error_message, None);

        drop(db);
    }

    #[test]
    fn restore_resumed_opencode_session_refreshes_checkpoint_for_completed_session() {
        let (db, _temp_dir) = make_test_db("restore_resumed_opencode_completed_checkpoint");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume completed OpenCode",
                "doing",
                Some(&project.id),
                Some("Resume completed OpenCode"),
                Some("opencode"),
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-202",
            "t-202",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-oc-202",
            &task.id,
            Some("oc-ses-202"),
            "implement",
            "completed",
            "opencode",
        )
        .expect("create opencode session failed");
        db.set_agent_session_pty_instance_id("ses-oc-202", 41)
            .expect("seed old pty instance failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-202".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-202".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", Some(42));

        let restored = db
            .get_agent_session("ses-oc-202")
            .expect("get restored opencode session failed")
            .expect("missing restored opencode session");
        assert_eq!(restored.status, "completed");
        assert_eq!(restored.pty_instance_id, Some(42));
        assert_eq!(restored.checkpoint_data, None);

        drop(db);
    }

    #[test]
    fn persist_resumed_pi_session_state_updates_changed_pi_session_id() {
        let (db, _temp_dir) = make_test_db("persist_resumed_pi_session_id");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume Pi",
                "doing",
                Some(&project.id),
                Some("Resume Pi"),
                None,
            )
            .expect("create task failed");
        db.create_agent_session(
            "ses-pi-resume",
            &task.id,
            None,
            "implement",
            "running",
            "pi",
        )
        .expect("create pi session failed");
        db.set_agent_session_pi_id("ses-pi-resume", "pi-old")
            .expect("set old pi session id failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-pi".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-pi".to_string()),
        };
        let provider_result = crate::providers::ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: Some("pi-new".to_string()),
            pty_instance_id: Some(55),
        };

        persist_resumed_session_state(&db, Some(&session), &target, "pi", &provider_result);

        let restored = db
            .get_agent_session("ses-pi-resume")
            .expect("get restored pi session failed")
            .expect("missing restored pi session");
        assert_eq!(restored.pi_session_id.as_deref(), Some("pi-new"));
        assert_eq!(restored.pty_instance_id, Some(55));
        assert_eq!(restored.status, "running");

        drop(db);
    }

    #[test]
    fn restore_resumed_pi_session_refreshes_checkpoint_for_completed_session() {
        let (db, _temp_dir) = make_test_db("restore_resumed_pi_completed_checkpoint");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume Pi",
                "doing",
                Some(&project.id),
                Some("Resume Pi"),
                None,
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-200",
            "t-200",
        )
        .expect("create worktree failed");
        db.create_agent_session("ses-pi-200", &task.id, None, "implement", "completed", "pi")
            .expect("create pi session failed");
        db.set_agent_session_pi_id("ses-pi-200", "pi-ses-200")
            .expect("set pi session id failed");
        db.set_agent_session_pty_instance_id("ses-pi-200", 41)
            .expect("seed old pty instance failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-200".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-200".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "pi", Some(42));

        let restored = db
            .get_agent_session("ses-pi-200")
            .expect("get restored pi session failed")
            .expect("missing restored pi session");
        assert_eq!(restored.status, "completed");
        assert_eq!(restored.pty_instance_id, Some(42));
        assert_eq!(restored.checkpoint_data, None);

        drop(db);
    }

    #[test]
    fn load_resume_targets_prefers_task_workspaces_and_falls_back_to_worktrees() {
        let (db, _temp_dir) = make_test_db("load_resume_targets");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");

        let task_with_workspace = db
            .create_task("Workspace-backed", "doing", Some(&project.id), None, None)
            .expect("create workspace-backed task failed");
        let task_with_legacy_worktree = db
            .create_task("Legacy worktree", "doing", Some(&project.id), None, None)
            .expect("create legacy worktree task failed");

        db.upsert_task_workspace_record(
            &task_with_workspace.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
            "active",
        )
        .expect("upsert task workspace failed");

        db.create_worktree_record(
            &task_with_legacy_worktree.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/legacy",
            "legacy-branch",
        )
        .expect("create legacy worktree failed");

        db.create_agent_session(
            "ses-workspace",
            &task_with_workspace.id,
            Some("oc-workspace"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create workspace session failed");
        db.create_agent_session(
            "ses-legacy",
            &task_with_legacy_worktree.id,
            Some("oc-legacy"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create legacy session failed");

        let targets = load_resume_targets(&db).expect("load resume targets failed");
        assert_eq!(targets.len(), 2);
        assert!(targets
            .iter()
            .any(|target| target.task_id == task_with_workspace.id
                && target.workspace_path == "/tmp/test-repo"));
        assert!(targets
            .iter()
            .any(|target| target.task_id == task_with_legacy_worktree.id
                && target.workspace_path == "/tmp/test-repo/.worktrees/legacy"));

        drop(db);
    }

    #[test]
    fn load_resume_targets_reattaches_completed_sessions_for_doing_tasks() {
        let (db, _temp_dir) = make_test_db("load_completed_resume_targets");
        let project = db
            .create_project("Replay recovery", "/tmp/replay-recovery")
            .expect("create project failed");

        let missing_replay = db
            .create_task("Missing replay", "doing", Some(&project.id), None, None)
            .expect("create missing-replay task");
        let empty_replay = db
            .create_task("Empty replay", "doing", Some(&project.id), None, None)
            .expect("create empty-replay task");
        let captured_replay = db
            .create_task("Captured replay", "doing", Some(&project.id), None, None)
            .expect("create captured-replay task");

        for task in [&missing_replay, &captured_replay] {
            db.upsert_task_workspace_record(
                &task.id,
                &project.id,
                "/tmp/replay-recovery",
                "/tmp/replay-recovery",
                "project_dir",
                None,
                "pi",
                "active",
            )
            .expect("create task workspace");
        }
        db.create_worktree_record(
            &empty_replay.id,
            &project.id,
            "/tmp/replay-recovery",
            "/tmp/replay-recovery/.worktrees/empty",
            "empty",
        )
        .expect("create legacy worktree");

        for (session_id, task_id) in [
            ("ses-missing-replay", missing_replay.id.as_str()),
            ("ses-empty-replay", empty_replay.id.as_str()),
            ("ses-captured-replay", captured_replay.id.as_str()),
        ] {
            db.create_agent_session(session_id, task_id, None, "implement", "completed", "pi")
                .expect("create completed Agent Session");
        }
        assert!(db
            .save_completed_agent_terminal_replay(&empty_replay.id, "")
            .expect("save empty replay"));
        assert!(db
            .save_completed_agent_terminal_replay(&captured_replay.id, "captured output")
            .expect("save captured replay"));

        let mut recovered_task_ids: Vec<_> = load_resume_targets(&db)
            .expect("load replay recovery targets")
            .into_iter()
            .map(|target| target.task_id)
            .collect();
        recovered_task_ids.sort();
        let mut expected_task_ids = vec![
            missing_replay.id.clone(),
            empty_replay.id.clone(),
            captured_replay.id.clone(),
        ];
        expected_task_ids.sort();

        assert_eq!(recovered_task_ids, expected_task_ids);

        drop(db);
    }
}
