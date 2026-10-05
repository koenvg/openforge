//! Legacy native test/E2E teardown, not release Session Daemon lifecycle.
use super::*;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use portable_pty::{Child, ChildKiller, ExitStatus};
use std::sync::atomic::AtomicUsize;
use std::time::{Duration, Instant};

#[derive(Debug)]
struct ObservedChild {
    child: Box<dyn Child + Send + Sync>,
    drops: Arc<AtomicUsize>,
}

impl Drop for ObservedChild {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}

impl ChildKiller for ObservedChild {
    fn kill(&mut self) -> io::Result<()> {
        self.child.kill()
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        self.child.clone_killer()
    }
}

impl Child for ObservedChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait()
    }

    fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }
}

async fn retained_session(
    fixture: &mut NativePtyFixtureCleanup,
    key: &str,
) -> (PtySession, Arc<AtomicUsize>) {
    let ready = fixture
        .pid_dir()
        .parent()
        .unwrap()
        .join(format!("{key}-ready"));
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let mut command = CommandBuilder::new("/bin/sh");
    command.args([
        "-c",
        "trap '' TERM; echo ready > \"$1\"; sleep 30",
        "fixture",
    ]);
    command.arg(&ready);
    let child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
    let session = PtySession {
        managed_process: ManagedProcessIdentity::capture(child.process_id().unwrap()).unwrap(),
        child,
        writer: Arc::new(
            ordered_writer::OrderedPtyWriter::start(
                key.to_string(),
                instance_id,
                pair.master.take_writer().unwrap(),
            )
            .unwrap(),
        ),
        master: Arc::new(std::sync::Mutex::new(pair.master)),
        instance_id,
        kind: PtySessionKind::Agent,
        pid_file_name: format!("{key}-pty.pid"),
        terminal_model: None,
    };
    // The fixture is a last-resort owner, even when the regression is red. Do not
    // run it before checking cancellation evidence or it could hide the bug.
    let mut session = fixture.retain_unpublished_session(session).unwrap();
    let drops = Arc::new(AtomicUsize::new(0));
    session.child = Box::new(ObservedChild {
        child: session.child,
        drops: drops.clone(),
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.exists() {
        assert!(
            Instant::now() < deadline,
            "fixture must install its TERM trap"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    write_managed_process_identity(
        &fixture.pid_dir().join(&session.pid_file_name),
        &session.managed_process,
    )
    .unwrap();
    (session, drops)
}

async fn assert_retained(manager: &PtyManager, key: &str, drops: &AtomicUsize) {
    assert_eq!(
        drops.load(Ordering::SeqCst),
        0,
        "cancellation dropped the child reaper"
    );
    assert!(
        manager
            .terminal_sessions
            .ensure_no_managed_recovery(key)
            .await
            .is_err(),
        "cancelled teardown must remain recoverable in memory"
    );
}

#[tokio::test]
async fn cancelled_legacy_kill_retains_current_session() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "cancel-kill";
    let (session, drops) = retained_session(&mut fixture, key).await;
    let metadata = fixture.pid_dir().join(&session.pid_file_name);
    let original = std::fs::read(&metadata).unwrap();
    manager.sessions.lock().await.insert(key.into(), session);
    {
        let mut cleanup = Box::pin(manager.kill_pty(key));
        assert!(futures::poll!(&mut cleanup).is_pending());
    }
    assert_retained(&manager, key, &drops).await;
    assert_eq!(std::fs::read(&metadata).unwrap(), original);
    manager.kill_pty(key).await.expect("retry retained kill");
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert!(!metadata.exists());
    fixture.finish().expect("fixture cleanup");
}

#[tokio::test]
async fn cancelled_legacy_recovery_retains_current_and_remaining_sessions() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "cancel-recoveries";
    let mut evidence = Vec::new();
    for index in 0..2 {
        let recovery_key = format!("{key}-{index}");
        let (session, drops) = retained_session(&mut fixture, &recovery_key).await;
        let metadata = fixture.pid_dir().join(&session.pid_file_name);
        evidence.push((metadata.clone(), std::fs::read(&metadata).unwrap(), drops));
        manager
            .terminal_sessions
            .retain_managed_recovery(
                key,
                session::ManagedRecovery {
                    recovery_key,
                    session,
                },
            )
            .await;
    }
    {
        let mut cleanup = Box::pin(manager.kill_pty(key));
        assert!(futures::poll!(&mut cleanup).is_pending());
        // A paused teardown must not hold a global recovery/session lock.
        tokio::time::timeout(
            Duration::from_millis(500),
            manager.kill_pty("unrelated-key"),
        )
        .await
        .expect("unrelated cleanup must progress")
        .expect("unrelated cleanup");
        tokio::time::timeout(Duration::from_millis(500), manager.get_session_keys())
            .await
            .expect("session lookup must progress");
    }
    for (metadata, original, drops) in &evidence {
        assert_retained(&manager, key, drops).await;
        assert_eq!(&std::fs::read(metadata).unwrap(), original);
    }
    manager
        .kill_pty(key)
        .await
        .expect("retry retained recoveries");
    for (metadata, _, drops) in evidence {
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(!metadata.exists());
    }
    fixture.finish().expect("fixture cleanup");
}

#[tokio::test]
async fn cancelled_legacy_finalize_exit_retains_current_session() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "cancel-eof";
    let (session, drops) = retained_session(&mut fixture, key).await;
    let instance_id = session.instance_id;
    let metadata = fixture.pid_dir().join(&session.pid_file_name);
    let original = std::fs::read(&metadata).unwrap();
    manager.sessions.lock().await.insert(key.into(), session);
    let lifecycle_lock = manager.lifecycle_lock_for(key).await;
    {
        let mut cleanup = Box::pin(manager.terminal_sessions.finalize_exit(
            key,
            instance_id,
            &lifecycle_lock,
            &metadata,
            false,
        ));
        assert!(futures::poll!(&mut cleanup).is_pending());
    }
    assert_retained(&manager, key, &drops).await;
    assert_eq!(std::fs::read(&metadata).unwrap(), original);
    manager
        .kill_pty(key)
        .await
        .expect("retry retained EOF cleanup");
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert!(!metadata.exists());
    fixture.finish().expect("fixture cleanup");
}

#[tokio::test]
async fn legacy_teardown_identity_failure_retains_recovery_and_metadata() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "identity-failure";
    let (mut session, drops) = retained_session(&mut fixture, key).await;
    let valid_identity = session.managed_process.clone();
    let instance_id = session.instance_id;
    let metadata = fixture.pid_dir().join(&session.pid_file_name);
    let original = std::fs::read(&metadata).unwrap();
    session.managed_process.root_start_time += 1;
    manager.sessions.lock().await.insert(key.into(), session);

    let error = manager
        .kill_pty(key)
        .await
        .expect_err("identity mismatch must fail closed");
    assert!(error.to_string().contains("identity mismatch"));
    assert_retained(&manager, key, &drops).await;
    assert_eq!(std::fs::read(&metadata).unwrap(), original);
    let mut session = manager
        .terminal_sessions
        .take_managed_recovery_for_test(key, instance_id)
        .await
        .unwrap();
    assert!(
        session.child.try_wait().unwrap().is_none(),
        "mismatched process was signaled"
    );
    session.managed_process = valid_identity;
    manager
        .terminal_sessions
        .retain_managed_recovery(
            key,
            session::ManagedRecovery {
                recovery_key: key.into(),
                session,
            },
        )
        .await;
    manager
        .kill_pty(key)
        .await
        .expect("retry verified identity");
    fixture.finish().expect("fixture cleanup");
}

#[tokio::test]
async fn legacy_teardown_keeps_replaced_private_metadata() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "metadata-failure";
    let (session, drops) = retained_session(&mut fixture, key).await;
    let valid_identity = session.managed_process.clone();
    let metadata = fixture.pid_dir().join(&session.pid_file_name);
    let mut other_identity = valid_identity.clone();
    other_identity.root_start_time += 1;
    let replaced = serde_json::to_vec(&other_identity).unwrap();
    std::fs::write(&metadata, &replaced).unwrap();
    manager.sessions.lock().await.insert(key.into(), session);

    let error = manager
        .kill_pty(key)
        .await
        .expect_err("replaced metadata must be preserved");
    assert!(error.to_string().contains("different process identity"));
    assert_retained(&manager, key, &drops).await;
    assert_eq!(std::fs::read(&metadata).unwrap(), replaced);
    std::fs::remove_file(&metadata).unwrap();
    write_managed_process_identity(&metadata, &valid_identity).unwrap();
    manager
        .kill_pty(key)
        .await
        .expect("retry original private metadata");
    fixture.finish().expect("fixture cleanup");
}

#[tokio::test]
async fn legacy_teardown_does_not_adopt_disk_only_processes() {
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let key = "disk-only";
    let (mut untracked, drops) = retained_session(&mut fixture, key).await;
    let metadata = fixture.pid_dir().join(&untracked.pid_file_name);
    let original = std::fs::read(&metadata).unwrap();
    manager
        .kill_pty(key)
        .await
        .expect("untracked kill is a no-op");
    manager.kill_all().await;
    assert!(
        untracked.child.try_wait().unwrap().is_none(),
        "disk-only process was signaled"
    );
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    assert_eq!(std::fs::read(&metadata).unwrap(), original);
    // Only the fixture's separate in-memory owner can clean this process.
    std::fs::remove_file(&metadata).unwrap();
    fixture.finish().expect("fixture cleanup");
}
