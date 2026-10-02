use super::support::{wait_for_output, ShellTestHarness};
use crate::pty_manager::{
    managed_process::ManagedProcessIdentity, shell_session_key, TerminalSessionLifecycleState,
};
use futures::FutureExt;
use portable_pty::CommandBuilder;
use std::{panic::AssertUnwindSafe, time::Duration};
use sysinfo::{Pid, ProcessStatus, System};

fn process_is_live(pid: u32) -> bool {
    System::new_all()
        .process(Pid::from_u32(pid))
        .is_some_and(|process| process.status() != ProcessStatus::Zombie)
}

#[tokio::test]
async fn shell_fixture_cleanup_stops_owned_tree_after_assertion_or_timeout() {
    for timeout in [false, true] {
        let harness = ShellTestHarness::new();
        let unrelated = ShellTestHarness::new();
        let task_id = "fixture-owned-tree";
        let key = shell_session_key(task_id, Some(2));
        // Deliberately reuse the same key in another manager to check ownership.
        unrelated
            .spawn_long_running(task_id, Some(2))
            .await
            .unwrap();
        let unrelated_pid_file = unrelated.pid_dir.join(format!("{key}.pid"));
        let unrelated_record = std::fs::read(&unrelated_pid_file).unwrap();
        let child_pid_file = harness.temp_dir.path().join("child-pid");
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            &format!(
                "sleep 30 & echo $! > '{}'; printf 'child-ready'; wait",
                child_pid_file.display()
            ),
        ]);
        harness
            .spawn_with_publisher(
                task_id,
                Some(2),
                crate::app_events::RuntimeEventPublisher::new(None, None),
                command,
            )
            .await
            .unwrap();
        wait_for_output(
            &harness.manager,
            &key,
            "child-ready",
            Duration::from_secs(5),
        )
        .await;
        let child_pid = std::fs::read_to_string(&child_pid_file)
            .unwrap()
            .trim()
            .parse::<u32>()
            .unwrap();
        let observer = harness.manager.clone();
        let root_pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
        let pid_dir = harness.pid_dir.clone();
        // Disk records alone do not grant the fixture ownership of another tree.
        std::fs::write(pid_dir.join("unrelated-pty.pid"), &unrelated_record).unwrap();
        let result = AssertUnwindSafe(async move {
            let _harness = harness;
            if timeout {
                tokio::time::timeout(Duration::from_millis(1), std::future::pending::<()>())
                    .await
                    .expect("injected shell timeout");
            } else {
                std::panic::panic_any(42_u32);
            }
        })
        .catch_unwind()
        .await;
        let primary = result.expect_err("original failure should survive fixture teardown");
        if timeout {
            assert!(primary
                .downcast::<String>()
                .unwrap()
                .contains("injected shell timeout"));
        } else {
            assert_eq!(*primary.downcast::<u32>().unwrap(), 42);
        }
        assert!(!observer.pty_buffer_state(&key).await.is_live);
        assert!(!process_is_live(root_pid), "owned root survived teardown");
        assert!(
            !process_is_live(child_pid),
            "owned descendant survived teardown"
        );
        assert!(!pid_dir.join(format!("{key}.pid")).exists());
        assert_eq!(
            std::fs::read(pid_dir.join("unrelated-pty.pid")).unwrap(),
            unrelated_record
        );
        // Unclaimed records are evidence of unknown completion, not ownership.
        std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
        assert!(
            unrelated.manager.pty_buffer_state(&key).await.is_live,
            "another manager's same-key shell must survive"
        );
        assert_eq!(std::fs::read(unrelated_pid_file).unwrap(), unrelated_record);
        unrelated
            .manager
            .kill_pty(&key)
            .await
            .expect("unrelated fixture cleanup");
    }
}

#[tokio::test]
async fn shell_fixture_cleanup_preserves_task_abort() {
    let harness = ShellTestHarness::new();
    let key = shell_session_key("fixture-aborted", Some(0));
    harness
        .spawn_long_running("fixture-aborted", Some(0))
        .await
        .unwrap();
    let observer = harness.manager.clone();
    let pid_dir = harness.pid_dir.clone();
    let pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let body = tokio::spawn(async move {
        let _harness = harness;
        entered_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    entered_rx.await.unwrap();
    body.abort();
    assert!(body.await.unwrap_err().is_cancelled());
    assert!(!observer.pty_buffer_state(&key).await.is_live);
    assert!(!process_is_live(pid));
    assert!(!pid_dir.exists());
}

#[tokio::test]
async fn shell_fixture_cleanup_preserves_private_recovery_on_identity_failure() {
    let harness = ShellTestHarness::new();
    let key = shell_session_key("fixture-identity-failure", Some(0));
    let instance = harness
        .spawn_long_running("fixture-identity-failure", Some(0))
        .await
        .unwrap();
    let pid_dir = harness.pid_dir.clone();
    let pid_file = pid_dir.join(format!("{key}.pid"));
    let record = std::fs::read(&pid_file).unwrap();
    let identity: ManagedProcessIdentity = serde_json::from_slice(&record).unwrap();
    let observer = harness.manager.clone();
    // Inject an unverifiable in-memory identity. Managed cleanup must fail closed.
    observer
        .sessions
        .lock()
        .await
        .get_mut(&key)
        .unwrap()
        .managed_process
        .root_start_time += 1;
    let result = AssertUnwindSafe(async move {
        let _harness = harness;
        std::panic::panic_any(42_u32);
    })
    .catch_unwind()
    .await;
    assert_eq!(*result.unwrap_err().downcast::<u32>().unwrap(), 42);
    assert!(
        process_is_live(identity.root_pid as u32),
        "mismatched identity must not be signalled"
    );
    assert_eq!(
        std::fs::read(&pid_file).unwrap(),
        record,
        "recovery record must survive fixture directory teardown"
    );
    assert!(observer
        .process_diagnostic_sessions()
        .await
        .iter()
        .any(|session| session.pty_instance_id == instance
            && session.lifecycle_state == TerminalSessionLifecycleState::ManagedRecovery));

    // Repair only the injected identity and use verified cleanup for this test's root.
    let mut retained = observer
        .terminal_sessions
        .take_managed_recovery_for_test(&key, instance)
        .await
        .unwrap();
    retained.managed_process = identity;
    observer
        .terminate_or_retain_unregistered_session(&key, retained)
        .await
        .expect("verified test recovery");
    observer
        .cleanup_stale_pids()
        .await
        .expect("private test metadata cleanup");
    std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
}

#[test]
fn shell_fixture_cleanup_works_after_runtime_shutdown() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let harness = runtime.block_on(async {
        let harness = ShellTestHarness::new();
        harness
            .spawn_long_running("fixture-runtime-shutdown", Some(0))
            .await
            .unwrap();
        harness
    });
    let pid = runtime.block_on(harness.manager.process_diagnostic_sessions())[0]
        .pid
        .unwrap();
    let pid_dir = harness.pid_dir.clone();
    drop(runtime);
    drop(harness);
    assert!(!process_is_live(pid));
    assert!(!pid_dir.exists());
}

#[tokio::test]
async fn shell_fixture_retains_recovery_when_failure_interrupts_in_flight_cleanup() {
    for cancelled in [false, true] {
        let harness = ShellTestHarness::new();
        let key = shell_session_key("fixture-in-flight-cleanup", Some(0));
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            "trap '' TERM HUP; printf 'resistant-ready'; while :; do sleep 1; done",
        ]);
        harness
            .spawn_with_publisher(
                "fixture-in-flight-cleanup",
                Some(0),
                crate::app_events::RuntimeEventPublisher::new(None, None),
                command,
            )
            .await
            .unwrap();
        wait_for_output(
            &harness.manager,
            &key,
            "resistant-ready",
            Duration::from_secs(5),
        )
        .await;
        let observer = harness.manager.clone();
        let pid_dir = harness.pid_dir.clone();
        let pid_file = pid_dir.join(format!("{key}.pid"));
        let record = std::fs::read(&pid_file).unwrap();
        let pid = observer.process_diagnostic_sessions().await[0].pid.unwrap();
        let cleanup_manager = observer.clone();
        let cleanup_key = key.clone();
        let cleanup = tokio::spawn(async move { cleanup_manager.kill_pty(&cleanup_key).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if observer
                    .process_diagnostic_sessions()
                    .await
                    .iter()
                    .any(|session| {
                        session.session_key == key
                            && session.lifecycle_state == TerminalSessionLifecycleState::Cleaning
                    })
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("public kill should enter cleaning");
        let primary_preserved = if cancelled {
            let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
            let body = tokio::spawn(async move {
                let _harness = harness;
                entered_tx.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            entered_rx.await.unwrap();
            body.abort();
            body.await.unwrap_err().is_cancelled()
        } else {
            let primary = AssertUnwindSafe(async move {
                let _harness = harness;
                std::panic::panic_any(42_u32);
            })
            .catch_unwind()
            .await
            .unwrap_err();
            primary.downcast::<u32>().is_ok_and(|value| *value == 42)
        };
        let retained = std::fs::read(&pid_file).is_ok_and(|contents| contents == record);
        // Stop the original executor's cleanup as runtime shutdown would do.
        cleanup.abort();
        let _ = cleanup.await;
        // Also keep the red checkpoint safe: restore only this known-owned record
        // if the old guard deleted it, then recover through verified managed cleanup.
        std::fs::create_dir_all(&pid_dir).unwrap();
        if !pid_file.exists() {
            std::fs::write(&pid_file, &record).unwrap();
        }
        observer
            .cleanup_stale_pids()
            .await
            .expect("verified private recovery should stop the tree");
        std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
        assert!(
            primary_preserved,
            "in-flight cleanup must not replace assertion or cancellation"
        );
        assert!(
            retained,
            "unconfirmed in-flight cleanup must retain its private identity metadata"
        );
        assert!(
            !process_is_live(pid),
            "verified recovery must stop the TERM-resistant root"
        );
    }
}
