//! Failure-safe ownership for legacy native lifecycle test sessions.
use super::*;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;

fn assert_fixture_root_reaped(identity: &ManagedProcessIdentity) {
    assert!(
        sysinfo::System::new_all()
            .process(sysinfo::Pid::from_u32(identity.root_pid as u32))
            .is_none(),
        "fixture must reap its owned root before removing private metadata"
    );
}

#[tokio::test]
async fn unpublished_helper_session_is_reaped_on_fixture_unwind() {
    // A separate owner makes the regression safe even when the tested owner fails.
    let mut rescue_manager = PtyManager::new();
    let mut rescue = NativePtyFixtureCleanup::new(&mut rescue_manager);
    let mut observed = None;
    let mut rescued_sessions = Vec::new();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut manager = PtyManager::new();
        let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
        let session = test_agent_pty_session(&mut fixture, "unpublished-unwind");
        observed = Some((session.managed_process.clone(), fixture.pid_dir()));
        rescued_sessions.push(rescue.retain_unpublished_session(session).unwrap());
        panic!("simulate an assertion before session registration");
    }));
    assert!(result.is_err());
    let (identity, pid_dir) = observed.unwrap();
    assert_fixture_root_reaped(&identity);
    assert!(!pid_dir.parent().unwrap().exists());
    rescue.finish().expect("rescue fixture cleanup");
}

#[tokio::test]
async fn unpublished_helper_sessions_are_reaped_when_test_times_out() {
    let mut rescue_manager = PtyManager::new();
    let mut rescue = NativePtyFixtureCleanup::new(&mut rescue_manager);
    let mut observed = Vec::new();
    let mut rescued_sessions = Vec::new();
    let result = tokio::time::timeout(std::time::Duration::from_millis(100), async {
        let mut manager = PtyManager::new();
        let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
        for index in 0..2 {
            let session = test_shell_pty_session(&mut fixture, "unpublished-timeout", index);
            observed.push((session.managed_process.clone(), fixture.pid_dir()));
            rescued_sessions.push(rescue.retain_unpublished_session(session).unwrap());
        }
        std::future::pending::<()>().await;
    })
    .await;
    assert!(result.is_err());
    assert_eq!(observed.len(), 2);
    for (identity, pid_dir) in observed {
        assert_fixture_root_reaped(&identity);
        assert!(!pid_dir.parent().unwrap().exists());
    }
    rescue.finish().expect("rescue fixture cleanup");
}

#[tokio::test]
async fn registered_helper_session_is_reaped_when_test_is_aborted() {
    let mut manager = PtyManager::new();
    let fixture = NativePtyFixtureCleanup::new(&mut manager);
    let pid_dir = fixture.pid_dir();
    let mut fixture = fixture;
    let session = test_agent_pty_session(&mut fixture, "registered-abort");
    let identity = session.managed_process.clone();
    // Keep independent rescue ownership outside the task being cancelled.
    let mut rescue_manager = PtyManager::new();
    let mut rescue = NativePtyFixtureCleanup::new(&mut rescue_manager);
    let session = rescue.retain_unpublished_session(session).unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _fixture = fixture;
        manager
            .sessions
            .lock()
            .await
            .insert("registered-abort".into(), session);
        write_test_session_metadata(
            &manager,
            "registered-abort",
            &_fixture.pid_dir().join("registered-abort-pty.pid"),
        )
        .await;
        ready_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    ready_rx
        .await
        .expect("session should register before cancellation");
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_fixture_root_reaped(&identity);
    assert!(!pid_dir.parent().unwrap().exists());
    rescue.finish().expect("rescue fixture cleanup");
}

#[tokio::test]
async fn fixture_preserves_failed_cleanup_metadata_without_adopting_disk_identity() {
    let mut unrelated_manager = PtyManager::new();
    let mut unrelated_fixture = NativePtyFixtureCleanup::new(&mut unrelated_manager);
    let mut unrelated_session = test_agent_pty_session(&mut unrelated_fixture, "unrelated-owner");
    let mut manager = PtyManager::new();
    let mut fixture = NativePtyFixtureCleanup::new(&mut manager);
    let pid_dir = fixture.pid_dir();
    let recovery_dir = pid_dir.parent().unwrap().to_path_buf();
    assert_ne!(pid_dir, unrelated_fixture.pid_dir());
    let session = test_agent_pty_session(&mut fixture, "owned-cleanup");
    let identity = session.managed_process.clone();
    let disk_only = pid_dir.join("disk-only-pty.pid");
    write_managed_process_identity(&disk_only, &unrelated_session.managed_process).unwrap();
    let original = std::fs::read(&disk_only).unwrap();
    manager
        .sessions
        .lock()
        .await
        .insert("owned-cleanup".into(), session);
    write_test_session_metadata(
        &manager,
        "owned-cleanup",
        &pid_dir.join("owned-cleanup-pty.pid"),
    )
    .await;

    let error = fixture
        .finish()
        .expect_err("disk-only metadata must prevent successful cleanup");
    assert!(error.contains("private PTY recovery metadata retained"));
    assert!(error.contains(&recovery_dir.display().to_string()));
    assert_fixture_root_reaped(&identity);
    assert_eq!(std::fs::read(&disk_only).unwrap(), original);
    assert!(!pid_dir.join("owned-cleanup-pty.pid").exists());
    assert!(
        unrelated_session.child.try_wait().unwrap().is_none(),
        "disk-only identity must not be signalled"
    );
    drop(fixture);
    assert_eq!(
        std::fs::read(&disk_only).unwrap(),
        original,
        "Drop must not erase failed-cleanup evidence"
    );
    unrelated_fixture
        .finish()
        .expect("unrelated fixture cleanup");
    // Only the deliberate disk-only record remains. Its actual owner has now
    // reaped the child, so this regression can remove its known private evidence.
    std::fs::remove_file(disk_only).unwrap();
    std::fs::remove_dir(pid_dir).unwrap();
    std::fs::remove_dir(recovery_dir).unwrap();
}
