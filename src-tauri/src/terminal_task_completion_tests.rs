use crate::app_events::{AppEventBus, AppEventFrame, AppEventSender};
use crate::db::Database;
use crate::task_claims::{TaskClaims, TaskOperation};
use crate::terminal_task_completion::{
    RuntimeShutdownFuture, TerminalTaskCompletionError, TerminalTaskCompletionOutcome,
    TerminalTaskCompletionRequest, TerminalTaskCompletionService, TerminalTaskRuntime,
};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct RecordingRuntime {
    db: Arc<Mutex<Database>>,
    calls: Arc<Mutex<Vec<(String, String)>>>,
    fail_agent: bool,
}

impl RecordingRuntime {
    fn new(db: Arc<Mutex<Database>>) -> Self {
        Self {
            db,
            calls: Arc::new(Mutex::new(Vec::new())),
            fail_agent: false,
        }
    }

    fn failing_agent(db: Arc<Mutex<Database>>) -> Self {
        Self {
            fail_agent: true,
            ..Self::new(db)
        }
    }

    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("calls lock").clone()
    }

    fn record(&self, operation: &str, task_id: &str) {
        let status = crate::db::acquire_db(&self.db)
            .get_task(task_id)
            .expect("get task while stopping runtime")
            .expect("task exists while stopping runtime")
            .status;
        self.calls
            .lock()
            .expect("calls lock")
            .push((operation.to_string(), status));
    }
}

impl TerminalTaskRuntime for RecordingRuntime {
    fn stop_agent<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            self.record("agent", task_id);
            if self.fail_agent {
                Err("agent shutdown failed".to_string())
            } else {
                Ok(())
            }
        })
    }

    fn stop_task_shells<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            self.record("shells", task_id);
            Ok(())
        })
    }
}

fn make_service(
    db: Arc<Mutex<Database>>,
    runtime: RecordingRuntime,
    claims: TaskClaims,
    sender: Option<AppEventSender>,
) -> TerminalTaskCompletionService<RecordingRuntime> {
    TerminalTaskCompletionService::new(db, runtime, claims, None, None, sender)
}

#[tokio::test]
async fn typed_delete_and_complete_requests_validate_backlog_and_doing_distinctly() {
    let (database, path) = crate::db::test_helpers::make_test_db("typed_terminal_actions");
    let db = Arc::new(Mutex::new(database));
    let (backlog_id, doing_id) = {
        let database = crate::db::acquire_db(&db);
        let backlog = database
            .create_task("Delete me", "backlog", None, None, None)
            .expect("create backlog task");
        let doing = database
            .create_task("Complete me", "doing", None, None, None)
            .expect("create doing task");
        (backlog.id, doing.id)
    };
    let runtime = RecordingRuntime::new(Arc::clone(&db));
    let service = make_service(Arc::clone(&db), runtime, TaskClaims::new(), None);

    let deleted = service
        .complete(TerminalTaskCompletionRequest::delete(&backlog_id))
        .await
        .expect("backlog Delete should succeed");
    assert!(matches!(
        deleted,
        TerminalTaskCompletionOutcome::Deleted { .. }
    ));

    let wrong_action = service
        .complete(TerminalTaskCompletionRequest::delete(&doing_id))
        .await
        .expect_err("Delete must reject a doing Task");
    assert!(matches!(
        wrong_action,
        TerminalTaskCompletionError::InvalidState { .. }
    ));

    let completed = service
        .complete(TerminalTaskCompletionRequest::complete(&doing_id))
        .await
        .expect("doing Complete should succeed");
    assert!(matches!(
        completed,
        TerminalTaskCompletionOutcome::Completed { .. }
    ));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn completion_publishes_through_the_canonical_task_event_bus() {
    let (database, path) = crate::db::test_helpers::make_test_db("terminal_completion_event_bus");
    let db = Arc::new(Mutex::new(database));
    let (project_id, task_id) = {
        let database = crate::db::acquire_db(&db);
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = database
            .create_task("Delete me", "backlog", Some(&project.id), None, None)
            .expect("create backlog task");
        (project.id, task.id)
    };
    let bus = AppEventBus::new(16, 8);
    let mut subscription = bus.subscribe(None).expect("subscribe to app events");
    let service = TerminalTaskCompletionService::new(
        Arc::clone(&db),
        RecordingRuntime::new(Arc::clone(&db)),
        TaskClaims::new(),
        None,
        Some(bus),
        None,
    );

    service
        .complete(TerminalTaskCompletionRequest::delete(&task_id))
        .await
        .expect("Delete should succeed");

    let AppEventFrame::Event(event) = subscription.recv().await.expect("completion event") else {
        panic!("expected completion event");
    };
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["action"], "deleted");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project_id);
    assert_eq!(
        event
            .meta
            .expect("canonical event metadata")
            .ordering_key
            .as_deref(),
        Some(format!("task:{task_id}").as_str())
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn background_cleanup_failure_keeps_completion_and_releases_its_claim() {
    let temp = tempfile::tempdir().expect("create tempdir");
    let repo_path = temp.path().join("not-a-repository");
    let worktree_path = temp.path().join("worktree");
    std::fs::create_dir_all(&repo_path).expect("create invalid repo directory");
    std::fs::create_dir_all(&worktree_path).expect("create worktree directory");
    let (database, path) = crate::db::test_helpers::make_test_db("terminal_cleanup_failure");
    let db = Arc::new(Mutex::new(database));
    let task_id = {
        let database = crate::db::acquire_db(&db);
        let project = database
            .create_project("Project", repo_path.to_str().expect("repo path"))
            .expect("create project");
        let task = database
            .create_task("Delete me", "backlog", Some(&project.id), None, None)
            .expect("create backlog task");
        database
            .create_worktree_record(
                &task.id,
                &project.id,
                repo_path.to_str().expect("repo path"),
                worktree_path.to_str().expect("worktree path"),
                "openforge/test",
            )
            .expect("create worktree record");
        task.id
    };
    let claims = TaskClaims::new();
    let service = make_service(
        Arc::clone(&db),
        RecordingRuntime::new(Arc::clone(&db)),
        claims.clone(),
        None,
    );

    let outcome = service
        .complete(TerminalTaskCompletionRequest::delete(&task_id))
        .await
        .expect("completion should not wait for cleanup");
    assert!(matches!(
        outcome,
        TerminalTaskCompletionOutcome::Deleted {
            cleanup_scheduled: true,
            ..
        }
    ));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Some(claim) = claims.try_claim(&task_id, TaskOperation::TerminalCompletion) {
            drop(claim);
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "background cleanup must release the lifecycle claim even after failure"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(
        crate::db::acquire_db(&db)
            .get_task(&task_id)
            .expect("get completed task")
            .expect("Completed Task remains")
            .status,
        "done"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn complete_accepts_a_legacy_doing_state_alias_without_a_stale_write() {
    let (database, path) = crate::db::test_helpers::make_test_db("terminal_legacy_doing_state");
    let db = Arc::new(Mutex::new(database));
    let task_id = crate::db::acquire_db(&db)
        .create_task("Legacy doing Task", "in_progress", None, None, None)
        .expect("create legacy doing task")
        .id;
    let service = make_service(
        Arc::clone(&db),
        RecordingRuntime::new(Arc::clone(&db)),
        TaskClaims::new(),
        None,
    );

    let outcome = service
        .complete(TerminalTaskCompletionRequest::complete(&task_id))
        .await
        .expect("legacy doing state should complete");

    assert!(matches!(
        outcome,
        TerminalTaskCompletionOutcome::Completed { .. }
    ));
    let _ = std::fs::remove_file(path);
}
#[tokio::test]
async fn running_task_stops_agent_and_shells_before_reference_data_is_completed() {
    let (database, path) = crate::db::test_helpers::make_test_db("terminal_runtime_shutdown");
    let db = Arc::new(Mutex::new(database));
    let task_id = {
        let database = crate::db::acquire_db(&db);
        let task = database
            .create_task("Running Task", "doing", None, None, None)
            .expect("create doing task");
        database
            .update_task_summary(&task.id, "Reviewer reference")
            .expect("set summary");
        task.id
    };
    let runtime = RecordingRuntime::new(Arc::clone(&db));
    let service = make_service(Arc::clone(&db), runtime.clone(), TaskClaims::new(), None);

    service
        .complete(TerminalTaskCompletionRequest::complete(&task_id))
        .await
        .expect("Complete should succeed");

    assert_eq!(
        runtime.calls(),
        vec![
            ("agent".to_string(), "doing".to_string()),
            ("shells".to_string(), "doing".to_string()),
        ]
    );
    let completed = crate::db::acquire_db(&db)
        .get_task(&task_id)
        .expect("get completed task")
        .expect("completed Task reference remains");
    assert_eq!(completed.status, "done");
    assert_eq!(completed.summary.as_deref(), Some("Reviewer reference"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn duplicate_claim_and_runtime_failure_leave_task_uncompleted() {
    let (database, path) = crate::db::test_helpers::make_test_db("terminal_completion_rejections");
    let db = Arc::new(Mutex::new(database));
    let task_id = crate::db::acquire_db(&db)
        .create_task("Running Task", "doing", None, None, None)
        .expect("create doing task")
        .id;
    let claims = TaskClaims::new();
    let claim = claims
        .try_claim(&task_id, TaskOperation::TerminalCompletion)
        .expect("claim terminal completion");
    let service = make_service(
        Arc::clone(&db),
        RecordingRuntime::new(Arc::clone(&db)),
        claims.clone(),
        None,
    );

    let duplicate = service
        .complete(TerminalTaskCompletionRequest::complete(&task_id))
        .await
        .expect_err("duplicate completion must be rejected");
    assert_eq!(duplicate, TerminalTaskCompletionError::AlreadyClaimed);
    drop(claim);

    let failing_runtime = RecordingRuntime::failing_agent(Arc::clone(&db));
    let service = make_service(Arc::clone(&db), failing_runtime.clone(), claims, None);
    let shutdown_error = service
        .complete(TerminalTaskCompletionRequest::complete(&task_id))
        .await
        .expect_err("runtime shutdown failure must abort completion");
    assert!(matches!(
        shutdown_error,
        TerminalTaskCompletionError::RuntimeShutdown(_)
    ));
    assert_eq!(failing_runtime.calls().len(), 2);
    assert_eq!(
        crate::db::acquire_db(&db)
            .get_task(&task_id)
            .expect("get task")
            .expect("task remains")
            .status,
        "doing"
    );

    let _ = std::fs::remove_file(path);
}
