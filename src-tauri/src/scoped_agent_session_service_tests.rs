use super::*;
use crate::db::test_helpers::make_test_db;

#[derive(Default)]
struct FakeWorkspace {
    acquired: Mutex<Vec<String>>,
    protected: Mutex<Vec<String>>,
    released: Mutex<Vec<String>>,
}
impl ScopedSessionWorkspace for FakeWorkspace {
    fn acquire<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace> {
        Box::pin(async move {
            lock(&self.acquired).push(row.id.clone());
            Ok(AcquiredSessionWorkspace {
                path: PathBuf::from("/tmp/scoped-workspace"),
                resolved_commit: "a".repeat(40),
                lease: Box::new(()),
            })
        })
    }
    fn protect<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>> {
        Box::pin(async move {
            lock(&self.protected).push(row.id.clone());
            Ok(Box::new(()) as Box<dyn Send + Sync>)
        })
    }
    fn is_available(&self, row: &ScopedAgentSessionRow) -> Result<bool, String> {
        Ok(lock(&self.acquired).contains(&row.id))
    }
    fn release<'a>(&'a self, row: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.released).push(row.id.clone());
            Ok(())
        })
    }
}

#[derive(Default)]
struct GatedWorkspace {
    acquired: Mutex<Vec<String>>,
    first_started: tokio::sync::Notify,
    release_first: tokio::sync::Notify,
}

impl ScopedSessionWorkspace for GatedWorkspace {
    fn acquire<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace> {
        Box::pin(async move {
            if row.target_key.ends_with("#1") {
                self.first_started.notify_one();
                self.release_first.notified().await;
            }
            lock(&self.acquired).push(row.id.clone());
            Ok(AcquiredSessionWorkspace {
                path: PathBuf::from("/tmp/scoped-workspace"),
                resolved_commit: "a".repeat(40),
                lease: Box::new(()),
            })
        })
    }

    fn protect<'a>(
        &'a self,
        _row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>> {
        Box::pin(async { Ok(Box::new(()) as Box<dyn Send + Sync>) })
    }

    fn is_available(&self, row: &ScopedAgentSessionRow) -> Result<bool, String> {
        Ok(lock(&self.acquired).contains(&row.id))
    }

    fn release<'a>(&'a self, _row: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Default)]
struct GatedRotationWorkspace {
    acquired: Mutex<Vec<String>>,
    release_started: tokio::sync::Notify,
    continue_release: tokio::sync::Notify,
}

impl ScopedSessionWorkspace for GatedRotationWorkspace {
    fn acquire<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace> {
        Box::pin(async move {
            lock(&self.acquired).push(row.id.clone());
            Ok(AcquiredSessionWorkspace {
                path: PathBuf::from("/tmp/scoped-workspace"),
                resolved_commit: "a".repeat(40),
                lease: Box::new(()),
            })
        })
    }

    fn protect<'a>(
        &'a self,
        _row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>> {
        Box::pin(async { Ok(Box::new(()) as Box<dyn Send + Sync>) })
    }

    fn is_available(&self, row: &ScopedAgentSessionRow) -> Result<bool, String> {
        Ok(lock(&self.acquired).contains(&row.id))
    }

    fn release<'a>(&'a self, row: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            if row.target_key.ends_with("#1") && row.revision == "head-a" {
                self.release_started.notify_one();
                self.continue_release.notified().await;
            }
            Ok(())
        })
    }
}

#[derive(Default)]
struct FakeRuntime {
    launches: Mutex<Vec<ScopedLaunchRequest>>,
    failed_targets: Mutex<Vec<String>>,
    failed_disposals: Mutex<Vec<String>>,
    inputs: Mutex<Vec<String>>,
    aborted: Mutex<Vec<String>>,
    disposed: Mutex<Vec<String>>,
    output: Mutex<HashMap<String, String>>,
    output_gate: Mutex<Option<Arc<OutputGate>>>,
}

#[derive(Default)]
struct OutputGate {
    started: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}
impl ScopedSessionRuntime for FakeRuntime {
    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, u64> {
        Box::pin(async move {
            let should_fail = lock(&self.failed_targets).contains(&request.scope.target_key);
            let mut launches = lock(&self.launches);
            launches.push(request);
            if should_fail {
                return Err("injected launch failure".to_string());
            }
            Ok(launches.len() as u64)
        })
    }
    fn input<'a>(&'a self, _: &'a str, input: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.inputs).push(input.into());
            Ok(())
        })
    }
    fn abort<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.aborted).push(key.into());
            Ok(())
        })
    }
    fn output<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, String> {
        Box::pin(async move {
            let gate = lock(&self.output_gate).clone();
            if let Some(gate) = gate {
                gate.started.notify_one();
                gate.resume.notified().await;
            }
            Ok(lock(&self.output).get(key).cloned().unwrap_or_default())
        })
    }
    fn output_revision<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, u64> {
        Box::pin(async move { Ok(lock(&self.output).get(key).map_or(0, |_| 1)) })
    }
    fn dispose<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.disposed).push(key.into());
            if lock(&self.failed_disposals).contains(&key.to_string()) {
                return Err("injected dispose failure".to_string());
            }
            Ok(())
        })
    }
}

struct InvalidatingRuntime {
    database: Arc<Mutex<Database>>,
    aborted: Mutex<Vec<String>>,
}

impl ScopedSessionRuntime for InvalidatingRuntime {
    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, u64> {
        Box::pin(async move {
            lock(&self.database)
                .abort_scoped_agent_session(&request.session_id, SCOPED_EXECUTION_LIMIT)
                .map_err(|error| error.to_string())?;
            Ok(77)
        })
    }

    fn input<'a>(&'a self, _key: &'a str, _input: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }

    fn abort<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.aborted).push(key.to_string());
            Ok(())
        })
    }

    fn output<'a>(&'a self, _key: &'a str) -> RuntimeFuture<'a, String> {
        Box::pin(async { Ok(String::new()) })
    }

    fn output_revision<'a>(&'a self, _key: &'a str) -> RuntimeFuture<'a, u64> {
        Box::pin(async { Ok(0) })
    }

    fn dispose<'a>(&'a self, _key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
}
struct Fixture {
    service: ScopedAgentSessionService,
    runtime: Arc<FakeRuntime>,
    workspace: Arc<FakeWorkspace>,
    project_id: String,
    _temp: tempfile::TempDir,
}
fn fixture(name: &str) -> Fixture {
    let (db, temp) = make_test_db(name);
    let project = db
        .create_project("Repository", temp.path().to_str().unwrap())
        .unwrap();
    db.set_project_config(&project.id, "ai_provider", "claude-code")
        .unwrap();
    let runtime = Arc::new(FakeRuntime::default());
    let workspace = Arc::new(FakeWorkspace::default());
    let service = ScopedAgentSessionService::new(
        Arc::new(Mutex::new(db)),
        workspace.clone(),
        runtime.clone(),
    );
    Fixture {
        service,
        runtime,
        workspace,
        project_id: project.id,
        _temp: temp,
    }
}
fn request(project: &str, index: usize) -> StartScopedAgentSession {
    StartScopedAgentSession {
        owner_plugin_id: "com.example.review".into(),
        scope: OwnedSessionScope {
            namespace: "github-pr".into(),
            target_key: format!("owner/repo#{index}"),
            revision: "head-a".into(),
        },
        project_id: project.into(),
        checkout_revision: "HEAD".into(),
        initial_input: format!("review {index}"),
        tool_policy: "review-read-only".into(),
    }
}

#[tokio::test]
async fn start_watch_input_completion_and_readback() {
    let f = fixture("scoped_lifecycle");
    let req = request(&f.project_id, 1);
    let running = f.service.start(req.clone()).await.unwrap();
    assert_eq!(running.status, ScopedAgentSessionStatus::Running);
    let launch = lock(&f.runtime.launches)[0].clone();
    lock(&f.runtime.output).insert(launch.terminal_key, "review complete".into());
    f.service
        .input(&req.owner_plugin_id, &req.scope, "more")
        .await
        .unwrap();
    assert_eq!(lock(&f.runtime.inputs).len(), 1);
    assert!(f.service.complete(&running.id, 1, true).await.unwrap());
    assert_eq!(
        f.service
            .output(&req.owner_plugin_id, &req.scope)
            .await
            .unwrap(),
        "review complete"
    );
    assert_eq!(
        f.service
            .status(&req.owner_plugin_id, &req.scope)
            .unwrap()
            .unwrap()
            .status,
        ScopedAgentSessionStatus::Completed
    );
}
#[tokio::test]
async fn fifth_session_queues_without_workspace_then_promotes_fifo() {
    let f = fixture("scoped_queue");
    let mut states = Vec::new();
    for i in 1..=5 {
        states.push(f.service.start(request(&f.project_id, i)).await.unwrap());
    }
    assert_eq!(states[4].status, ScopedAgentSessionStatus::Queued);
    assert_eq!(states[4].queue_position, Some(1));
    assert_eq!(lock(&f.runtime.launches).len(), 4);
    assert_eq!(lock(&f.workspace.acquired).len(), 4);
    f.service.complete(&states[0].id, 1, true).await.unwrap();
    assert_eq!(lock(&f.runtime.launches).len(), 5);
}

#[tokio::test]
async fn slow_checkout_does_not_block_unrelated_start_input_or_abort() {
    let (db, _temp) = make_test_db("scoped_concurrent_launch");
    let project = db.create_project("Repository", "/tmp/repository").unwrap();
    db.set_project_config(&project.id, "ai_provider", "claude-code")
        .unwrap();
    let workspace = Arc::new(GatedWorkspace::default());
    let runtime = Arc::new(FakeRuntime::default());
    let service = ScopedAgentSessionService::new(
        Arc::new(Mutex::new(db)),
        workspace.clone(),
        runtime.clone(),
    );
    let first_service = service.clone();
    let first_project = project.id.clone();
    let first = tokio::spawn(async move { first_service.start(request(&first_project, 1)).await });
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        workspace.first_started.notified(),
    )
    .await
    .expect("first checkout should start");

    let second_request = request(&project.id, 2);
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.start(second_request.clone()),
    )
    .await
    .expect("second start must not wait for first checkout")
    .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.input(
            &second_request.owner_plugin_id,
            &second_request.scope,
            "inspect more",
        ),
    )
    .await
    .expect("input must not wait for another checkout")
    .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.abort(&second_request.owner_plugin_id, &second_request.scope),
    )
    .await
    .expect("abort must not wait for another checkout")
    .unwrap();

    workspace.release_first.notify_one();
    first.await.unwrap().unwrap();
    assert_eq!(lock(&runtime.inputs).as_slice(), ["inspect more"]);
    assert_eq!(lock(&runtime.aborted).len(), 1);
}

#[tokio::test]
async fn slow_revision_rotation_does_not_block_an_unrelated_start() {
    let (db, _temp) = make_test_db("scoped_concurrent_rotation");
    let project = db.create_project("Repository", "/tmp/repository").unwrap();
    db.set_project_config(&project.id, "ai_provider", "claude-code")
        .unwrap();
    let workspace = Arc::new(GatedRotationWorkspace::default());
    let service = ScopedAgentSessionService::new(
        Arc::new(Mutex::new(db)),
        workspace.clone(),
        Arc::new(FakeRuntime::default()),
    );
    let first = request(&project.id, 1);
    service.start(first.clone()).await.unwrap();
    let mut rotation = first.clone();
    rotation.scope.revision = "head-b".to_string();
    rotation.checkout_revision = "head-b".to_string();
    let rotation_service = service.clone();
    let rotation_start = tokio::spawn(async move { rotation_service.start(rotation).await });
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        workspace.release_started.notified(),
    )
    .await
    .expect("revision cleanup should start");

    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.start(request(&project.id, 2)),
    )
    .await
    .expect("unrelated start must not wait for revision cleanup")
    .unwrap();

    workspace.continue_release.notify_one();
    rotation_start.await.unwrap().unwrap();
}
#[tokio::test]
async fn abort_and_continuation_keep_identity_and_filter_stale_exit() {
    let f = fixture("scoped_abort");
    let req = request(&f.project_id, 1);
    let first = f.service.start(req.clone()).await.unwrap();
    assert_eq!(first.turn_id.as_deref(), Some("1"));
    f.service.complete(&first.id, 1, true).await.unwrap();
    f.service
        .input(&req.owner_plugin_id, &req.scope, "continue")
        .await
        .unwrap();
    {
        let launches = lock(&f.runtime.launches);
        assert_eq!(launches.len(), 2);
        assert!(launches[1].resume);
        assert_eq!(
            launches[0].provider_session_id,
            launches[1].provider_session_id
        );
    }
    let aborted = f
        .service
        .abort(&req.owner_plugin_id, &req.scope)
        .await
        .unwrap();
    assert_eq!(aborted.status, ScopedAgentSessionStatus::Aborted);
    assert_eq!(aborted.turn_id.as_deref(), Some("2"));
    assert_eq!(lock(&f.runtime.aborted).len(), 1);
    let retried = f
        .service
        .input(&req.owner_plugin_id, &req.scope, "retry")
        .await
        .unwrap();
    assert_eq!(retried.id, first.id);
    assert_eq!(retried.turn_id.as_deref(), Some("3"));
    assert!(!f.service.complete(&first.id, 2, true).await.unwrap());
}

#[tokio::test]
async fn queued_continuation_protects_its_existing_workspace() {
    let f = fixture("scoped_queued_continuation");
    let first_request = request(&f.project_id, 1);
    let first = f.service.start(first_request.clone()).await.unwrap();
    f.service.complete(&first.id, 1, true).await.unwrap();
    for index in 2..=5 {
        f.service
            .start(request(&f.project_id, index))
            .await
            .unwrap();
    }

    let queued = f
        .service
        .input(
            &first_request.owner_plugin_id,
            &first_request.scope,
            "continue",
        )
        .await
        .unwrap();

    assert_eq!(queued.status, ScopedAgentSessionStatus::Queued);
    assert_eq!(queued.queue_position, Some(1));
    assert!(lock(&f.workspace.protected).contains(&first.id));
}
#[tokio::test]
async fn rejects_large_input_and_unknown_policy_before_side_effects() {
    let f = fixture("scoped_validation");
    let mut req = request(&f.project_id, 1);
    req.initial_input = "x".repeat(SCOPED_INPUT_LIMIT_BYTES + 1);
    assert!(matches!(
        f.service.start(req).await,
        Err(ScopedAgentSessionError::InputTooLarge)
    ));
    let mut req = request(&f.project_id, 2);
    req.tool_policy = "allow-all".into();
    assert!(matches!(
        f.service.start(req).await,
        Err(ScopedAgentSessionError::ToolPolicy(
            SessionToolPolicyError::UnknownPolicy(_)
        ))
    ));
    assert!(lock(&f.runtime.launches).is_empty());
    assert!(lock(&f.workspace.acquired).is_empty());
}

#[tokio::test]
async fn persistence_failure_after_spawn_aborts_the_provider() {
    let (db, _temp) = make_test_db("scoped_post_spawn_failure");
    let project = db.create_project("Repository", "/tmp/repository").unwrap();
    db.set_project_config(&project.id, "ai_provider", "claude-code")
        .unwrap();
    let database = Arc::new(Mutex::new(db));
    let runtime = Arc::new(InvalidatingRuntime {
        database: database.clone(),
        aborted: Mutex::new(Vec::new()),
    });
    let service = ScopedAgentSessionService::new(
        database,
        Arc::new(FakeWorkspace::default()),
        runtime.clone(),
    );

    assert!(matches!(
        service.start(request(&project.id, 1)).await,
        Err(ScopedAgentSessionError::Runtime(_))
    ));
    assert_eq!(lock(&runtime.aborted).len(), 1);
}
#[tokio::test]
async fn queued_abort_never_starts_a_process_and_queue_rejects_the_thirty_third_waiter() {
    let f = fixture("scoped_queue_limits");
    let mut states = Vec::new();
    for i in 1..=36 {
        states.push(f.service.start(request(&f.project_id, i)).await.unwrap());
    }
    assert_eq!(states[35].queue_position, Some(32));
    let error = f
        .service
        .start(request(&f.project_id, 37))
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::QueueFull {
            queue_limit: 32
        })
    ));
    let fifth = request(&f.project_id, 5);
    assert_eq!(
        f.service
            .abort(&fifth.owner_plugin_id, &fifth.scope)
            .await
            .unwrap()
            .status,
        ScopedAgentSessionStatus::Aborted
    );
    assert_eq!(lock(&f.runtime.launches).len(), 4);
    assert!(lock(&f.runtime.aborted).is_empty());
}

#[tokio::test]
async fn owner_release_aborts_process_and_removes_session_before_workspace() {
    let f = fixture("scoped_owner_release");
    let req = request(&f.project_id, 1);
    f.service.start(req.clone()).await.unwrap();

    assert_eq!(
        f.service
            .release_owner(&req.owner_plugin_id, Some("another-project"))
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        f.service
            .release_owner(&req.owner_plugin_id, Some(&f.project_id))
            .await
            .unwrap(),
        1
    );
    assert_eq!(lock(&f.runtime.aborted).len(), 1);
    assert_eq!(lock(&f.runtime.disposed).len(), 1);
    assert_eq!(lock(&f.workspace.released).len(), 1);
    assert!(f
        .service
        .status(&req.owner_plugin_id, &req.scope)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn captured_owner_cleanup_cannot_release_a_replacement_session() {
    let f = fixture("scoped_captured_owner_generation");
    let req = request(&f.project_id, 1);
    let old = f.service.start(req.clone()).await.unwrap();
    f.service
        .release(&req.owner_plugin_id, &req.scope)
        .await
        .unwrap();
    let replacement = f.service.start(req.clone()).await.unwrap();

    assert_eq!(
        f.service
            .release_captured(&req.owner_plugin_id, vec![old.id])
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        f.service
            .status(&req.owner_plugin_id, &req.scope)
            .unwrap()
            .unwrap()
            .id,
        replacement.id
    );
}

#[tokio::test]
async fn promoted_launch_failure_does_not_poison_the_completed_operation() {
    let f = fixture("scoped_promotion_failure_isolation");
    let mut states = Vec::new();
    for index in 1..=5 {
        states.push(
            f.service
                .start(request(&f.project_id, index))
                .await
                .unwrap(),
        );
    }

    lock(&f.runtime.failed_targets).push("owner/repo#5".to_string());

    assert!(f.service.complete(&states[0].id, 1, true).await.unwrap());

    assert_eq!(
        f.service
            .status("com.example.review", &request(&f.project_id, 5).scope,)
            .unwrap()
            .unwrap()
            .status,
        ScopedAgentSessionStatus::Failed
    );
}
#[tokio::test]
async fn output_read_finishes_before_same_scope_release_and_replacement() {
    let f = fixture("scoped_output_generation_fence");
    let req = request(&f.project_id, 1);
    f.service.start(req.clone()).await.unwrap();
    let terminal_key = lock(&f.runtime.launches)[0].terminal_key.clone();
    lock(&f.runtime.output).insert(terminal_key.clone(), "old output".to_string());
    let gate = Arc::new(OutputGate::default());
    *lock(&f.runtime.output_gate) = Some(gate.clone());

    let output_service = f.service.clone();
    let output_owner = req.owner_plugin_id.clone();
    let output_scope = req.scope.clone();
    let output =
        tokio::spawn(async move { output_service.output(&output_owner, &output_scope).await });
    gate.started.notified().await;

    let release_service = f.service.clone();
    let release_owner = req.owner_plugin_id.clone();
    let release_scope = req.scope.clone();
    let mut release = tokio::spawn(async move {
        release_service
            .release(&release_owner, &release_scope)
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut release)
            .await
            .is_err()
    );

    gate.resume.notify_one();
    assert_eq!(output.await.unwrap().unwrap(), "old output");
    release.await.unwrap().unwrap();
    *lock(&f.runtime.output_gate) = None;
    let replacement = f.service.start(req.clone()).await.unwrap();
    lock(&f.runtime.output).insert(terminal_key, "replacement output".to_string());
    assert_eq!(
        f.service
            .status(&req.owner_plugin_id, &req.scope)
            .unwrap()
            .unwrap()
            .id,
        replacement.id
    );
}

#[tokio::test]
async fn dispose_failure_cannot_strand_an_already_promoted_waiter() {
    let f = fixture("scoped_dispose_failure_promotion");
    let mut requests = Vec::new();
    let mut states = Vec::new();
    for index in 1..=5 {
        let req = request(&f.project_id, index);
        states.push(f.service.start(req.clone()).await.unwrap());
        requests.push(req);
    }
    let first_key = lock(&f.runtime.launches)[0].terminal_key.clone();
    lock(&f.runtime.failed_disposals).push(first_key.clone());

    assert!(matches!(
        f.service
            .release(&requests[0].owner_plugin_id, &requests[0].scope)
            .await,
        Err(ScopedAgentSessionError::Runtime(_))
    ));
    assert_eq!(
        f.service
            .status(&requests[4].owner_plugin_id, &requests[4].scope)
            .unwrap()
            .unwrap()
            .status,
        ScopedAgentSessionStatus::Running
    );
    lock(&f.runtime.failed_disposals).clear();
    f.service
        .release(&requests[0].owner_plugin_id, &requests[0].scope)
        .await
        .unwrap();
    assert_eq!(lock(&f.runtime.launches).len(), 5);
    assert_eq!(states[4].status, ScopedAgentSessionStatus::Queued);
}
