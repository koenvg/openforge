use super::PrDiscoveryPtyFixture;
use crate::{
    app_events::RuntimeEventPublisher,
    pty_manager::{shell_session_key, PtySpawnContext},
};
use futures::FutureExt;
use std::{panic::AssertUnwindSafe, time::Duration};
use sysinfo::{Pid, ProcessStatus, System};

fn process_is_live(pid: u32) -> bool {
    System::new_all()
        .process(Pid::from_u32(pid))
        .is_some_and(|process| process.status() != ProcessStatus::Zombie)
}

async fn spawn_live_shell(fixture: &PrDiscoveryPtyFixture) -> String {
    let key = shell_session_key(&fixture.discovery.task_id, Some(0));
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "printf 'owned-ready'; exec sleep 30"]);
    fixture
        .manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id: &fixture.discovery.task_id,
                cwd: fixture.discovery.dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: RuntimeEventPublisher::default(),
            },
            Some(0),
            None,
            command,
        )
        .await
        .unwrap();
    super::super::support::wait_for_output(
        &fixture.manager,
        &key,
        "owned-ready",
        Duration::from_secs(5),
    )
    .await;
    key
}

#[tokio::test]
async fn pr_discovery_fixture_stops_only_owned_shell_after_assertion_or_timeout() {
    for timeout in [false, true] {
        let fixture = PrDiscoveryPtyFixture::new().await;
        let key = spawn_live_shell(&fixture).await;
        let unrelated = super::super::support::ShellTestHarness::new();
        unrelated
            .spawn_long_running(&fixture.discovery.task_id, Some(0))
            .await
            .unwrap();
        let unrelated_pid_file = unrelated.pid_dir.join(format!("{key}.pid"));
        let unrelated_record = std::fs::read(&unrelated_pid_file).unwrap();
        let observer = fixture.manager.clone();
        let pid_dir = observer.get_pid_dir().unwrap();
        let root_pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
        let result = AssertUnwindSafe(async move {
            let _fixture = fixture;
            if timeout {
                tokio::time::timeout(Duration::from_millis(1), std::future::pending::<()>())
                    .await
                    .expect("injected PR discovery timeout");
            } else {
                std::panic::panic_any(42_u32);
            }
        })
        .catch_unwind()
        .await;
        let cleaned = !observer.pty_buffer_state(&key).await.is_live && !process_is_live(root_pid);
        let metadata_removed = !pid_dir.exists();
        let unrelated_survived = unrelated.manager.pty_buffer_state(&key).await.is_live
            && std::fs::read(&unrelated_pid_file).unwrap() == unrelated_record;
        // Keep the red checkpoint safe, using only the manager that spawned this root.
        observer.kill_pty(&key).await.unwrap();
        unrelated.manager.kill_pty(&key).await.unwrap();
        let primary = result.expect_err("original failure should survive teardown");
        if timeout {
            assert!(primary
                .downcast::<String>()
                .unwrap()
                .contains("injected PR discovery timeout"));
        } else {
            assert_eq!(*primary.downcast::<u32>().unwrap(), 42);
        }
        assert!(cleaned, "owned PR discovery shell survived fixture failure");
        assert!(
            metadata_removed,
            "confirmed cleanup should remove private metadata"
        );
        assert!(
            unrelated_survived,
            "another manager's same-key shell must survive"
        );
    }
}

#[tokio::test]
async fn pr_discovery_fixture_cleanup_preserves_task_cancellation() {
    let fixture = PrDiscoveryPtyFixture::new().await;
    let key = spawn_live_shell(&fixture).await;
    let observer = fixture.manager.clone();
    let pid_dir = observer.get_pid_dir().unwrap();
    let pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let body = tokio::spawn(async move {
        let _fixture = fixture;
        entered_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    entered_rx.await.unwrap();
    body.abort();
    assert!(body.await.unwrap_err().is_cancelled());
    assert!(!observer.pty_buffer_state(&key).await.is_live);
    assert!(!process_is_live(pid), "cancelled fixture's shell survived");
    assert!(!pid_dir.exists());
}

#[tokio::test]
async fn pr_discovery_fixture_preserves_private_evidence_without_claiming_disk_only_processes() {
    let fixture = PrDiscoveryPtyFixture::new().await;
    let key = spawn_live_shell(&fixture).await;
    let observer = fixture.manager.clone();
    let pid_dir = observer.get_pid_dir().unwrap();
    let workspace = fixture.discovery.dir.path().to_path_buf();
    let owned_pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
    let unrelated = super::super::support::ShellTestHarness::new();
    unrelated
        .spawn_long_running("unclaimed", Some(0))
        .await
        .unwrap();
    let unrelated_key = shell_session_key("unclaimed", Some(0));
    let unrelated_pid = unrelated.manager.process_diagnostic_sessions().await[0]
        .pid
        .unwrap();
    let record = std::fs::read(unrelated.pid_dir.join(format!("{unrelated_key}.pid"))).unwrap();
    let evidence = pid_dir.join("unclaimed.pid");
    std::fs::write(&evidence, &record).unwrap();
    let primary = AssertUnwindSafe(async move {
        let _fixture = fixture;
        std::panic::panic_any(42_u32);
    })
    .catch_unwind()
    .await
    .unwrap_err();
    assert_eq!(*primary.downcast::<u32>().unwrap(), 42);
    assert!(!observer.pty_buffer_state(&key).await.is_live);
    assert!(!process_is_live(owned_pid));
    assert!(
        !workspace.exists(),
        "workspace teardown should still complete"
    );
    assert_eq!(std::fs::read(&evidence).unwrap(), record);
    assert!(
        process_is_live(unrelated_pid),
        "disk-only identity must not be signalled"
    );
    assert!(
        unrelated
            .manager
            .pty_buffer_state(&unrelated_key)
            .await
            .is_live
    );
    unrelated.manager.kill_pty(&unrelated_key).await.unwrap();
    // The deliberately unclaimed record has served its assertion. Remove only
    // this test's retained directory, never use it to discover process ownership.
    std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
}
