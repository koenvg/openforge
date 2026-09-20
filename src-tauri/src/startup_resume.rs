//! Startup recovery ordering lives here; policy and database transitions do not.
mod history;
mod inventory;
mod persistence;
mod policy;
mod targets;

use crate::{backend_runtime::AppHandle, http_server::SidecarReadinessState};
use inventory::RecoveryInventory;
use log::{debug, error, info, warn};
use targets::ResumeTarget;

pub(crate) async fn resume_task_sessions(
    app: AppHandle,
    http_ready: tokio::sync::oneshot::Receiver<()>,
    sidecar_readiness: SidecarReadinessState,
    stale_running_session_cutoff: i64,
) {
    // Hooks need the HTTP server before any provider recovery starts.
    match http_ready.await {
        Ok(()) => debug!("[startup] HTTP server ready, proceeding with session resume"),
        Err(_) => {
            warn!("[startup] HTTP server ready channel dropped — resuming anyway (hooks may fail)");
        }
    }

    // A retained allocation, including an exit, is authoritative before history.
    let inventory = match RecoveryInventory::load(&app).await {
        Ok(inventory) => inventory,
        Err(message) => {
            sidecar_readiness.mark_startup_resume_degraded(message);
            let _ = app.emit("startup-resume-complete", ());
            return;
        }
    };
    let targets = match persistence::load_targets(&app) {
        Ok(targets) => targets,
        Err(message) => {
            error!("[startup] {message}");
            sidecar_readiness.mark_startup_resume_degraded(message);
            let _ = app.emit("startup-resume-complete", ());
            return;
        }
    };

    if !targets.is_empty() {
        sidecar_readiness.mark_startup_resume_running(targets.len());
        info!(
            "[startup] Resuming agent sessions for {} task(s)",
            targets.len()
        );
        for target in targets {
            if inventory.retains(&target.task_id) {
                sidecar_readiness.record_startup_resume_success();
                continue;
            }
            history::recover_target(&app, &target, &sidecar_readiness).await;
        }
    }

    persistence::mark_unresumed_running_sessions_interrupted(
        &app,
        stale_running_session_cutoff,
        &inventory.live_tasks(),
    );
    sidecar_readiness.mark_startup_resume_complete();
    let _ = app.emit("startup-resume-complete", ());
    info!("[startup] Resume complete, emitted startup-resume-complete event");
}

#[cfg(test)]
mod tests {
    use super::{
        history::capture_recovered_completed_session_replay,
        persistence::{persist_resumed_session_state, restore_resumed_session_state},
        policy::latest_session_allows_startup_resume,
        resume_task_sessions,
        targets::{load_resume_targets, ResumeTarget},
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
            output_revision: 0,
            viewed_output_revision: 0,
        }
    }

    #[test]
    fn recovery_policy_preserves_provider_and_completion_rules() {
        for provider in ["claude-code", "pi", "opencode", "codex", "grok", "unknown"] {
            assert_eq!(
                super::policy::interrupt_on_resume_failure(provider),
                provider != "unknown",
            );
            for status in ["running", "interrupted", "paused", "completed", "failed"] {
                let session = test_agent_session_with_status(status);
                for instance in [None, Some(42)] {
                    let expected = match status {
                        "running" | "interrupted" => Some("running"),
                        "paused" | "completed"
                            if matches!(provider, "pi" | "opencode" | "codex")
                                && instance.is_some() =>
                        {
                            Some(status)
                        }
                        _ => None,
                    };
                    assert_eq!(
                        super::policy::restored_status(&session, provider, instance),
                        expected,
                        "{provider}/{status}/{instance:?}",
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn empty_recovery_completes_even_when_http_ready_sender_drops() {
        let (database, _temp_dir) = make_test_db("empty_startup_recovery");
        let app = crate::backend_runtime::AppHandle::new();
        app.manage(Arc::new(Mutex::new(database)));
        let events = Arc::new(RecordingEventAdapter::default());
        app.set_app_event_adapter(events.clone());
        let readiness = crate::http_server::SidecarReadinessState::new();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        drop(sender);

        resume_task_sessions(app, receiver, readiness.clone(), 0).await;

        assert_eq!(readiness.startup_resume().phase, "complete");
        assert!(readiness.degraded().is_empty());
        assert_eq!(
            *events.events.lock().expect("recorded events"),
            vec!["startup-resume-complete"],
        );
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
    async fn completed_replay_recovery_persists_empty_replay_without_live_buffer() {
        let (database, _temp_dir) = make_test_db("completed_replay_recovery_capture");
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
        app.manage(Arc::clone(&database));
        app.manage(crate::pty_manager::PtyManager::new());
        let session = database
            .lock()
            .expect("database lock")
            .get_latest_session_for_ticket(&task.id)
            .expect("load latest Agent Session")
            .expect("latest Agent Session missing");

        capture_recovered_completed_session_replay(&app, &session).await;

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
