use super::*;
use crate::pty_manager::managed_process::ManagedProcessIdentity;
use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::session::spawn::process::{AgentProcessRequest, SpawnedPty};
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use futures::FutureExt;
use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use sysinfo::{Pid, ProcessStatus, System};

struct RegistrationFixture {
    manager: PtyManager,
    cleanup: NativePtyFixtureCleanup,
}

impl RegistrationFixture {
    fn new() -> Self {
        let mut manager = PtyManager::new();
        let cleanup = NativePtyFixtureCleanup::new(&mut manager);
        Self { manager, cleanup }
    }

    fn create_process(&mut self) -> SpawnedPty {
        self.create_process_with(|session| session)
    }

    fn create_process_with(&mut self, mutate: impl FnOnce(PtySession) -> PtySession) -> SpawnedPty {
        let spawned = self
            .manager
            .create_agent_process(
                &RegistrationTestAdapter,
                AgentProcessRequest {
                    task_id: "stale-registration-stage",
                    cwd: &self.cleanup.pid_dir(),
                    cols: 80,
                    rows: 24,
                    terminal_image_protocol: None,
                    event_publisher: crate::app_events::RuntimeEventPublisher::default(),
                },
            )
            .expect("process creation stage should succeed");
        let SpawnedPty {
            reader,
            session,
            pid_file,
            terminal_model_feeder,
        } = spawned;
        let session = mutate(session);
        let session = self
            .cleanup
            .retain_unpublished_session(session)
            .expect("unpublished process evidence should persist");
        SpawnedPty {
            reader,
            session,
            pid_file,
            terminal_model_feeder,
        }
    }
}

fn assert_root_reaped(identity: &ManagedProcessIdentity) {
    assert!(
        System::new_all()
            .process(Pid::from_u32(identity.root_pid as u32))
            .is_none(),
        "owned root should be reaped, not left as a zombie"
    );
}

fn process_is_live(identity: &ManagedProcessIdentity) -> bool {
    System::new_all()
        .process(Pid::from_u32(identity.root_pid as u32))
        .is_some_and(|process| process.status() != ProcessStatus::Zombie)
}

struct RegistrationTestAdapter;

impl AgentPtyProviderAdapter for RegistrationTestAdapter {
    fn label(&self) -> &'static str {
        "RegistrationTest"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        vec![
            "-lc".to_string(),
            "printf stale-registration; exec sleep 30".to_string(),
        ]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{task_id}-pty.pid")
    }
}

#[tokio::test]
async fn stale_session_registration_reaps_the_unpublished_process() {
    let mut fixture = RegistrationFixture::new();
    let manager = fixture.manager.clone();
    let task_id = "stale-registration-stage";
    let adapter = RegistrationTestAdapter;
    let (stale_token, lifecycle_lock) = manager.begin_agent_spawn(task_id, adapter.label()).await;
    let lifecycle_guard = lifecycle_lock.lock().await;
    let spawned = fixture.create_process();
    let SpawnedPty {
        reader,
        session,
        pid_file,
        terminal_model_feeder: _,
    } = spawned;
    let (current_token, current_lock) = manager.begin_agent_spawn(task_id, adapter.label()).await;

    let result = manager
        .register_spawned_session(SessionRegistrationRequest {
            session_key: task_id,
            generation: stale_token.generation,
            session,
            replacement_label: stale_token.label,
            stale_error: stale_token.stale_error(task_id, "before session registration completed"),
        })
        .await;

    assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
    assert!(!manager.sessions.lock().await.contains_key(task_id));
    assert!(!pid_file.exists());
    assert_eq!(
        manager.agent_spawn_generations.lock().await.get(task_id),
        Some(&current_token.generation)
    );

    drop(reader);
    manager
        .finish_agent_spawn(task_id, current_token)
        .await
        .expect("newest generation should remain completable");
    drop(lifecycle_guard);
    drop(lifecycle_lock);
    drop(current_lock);
    fixture
        .cleanup
        .finish()
        .expect("fixture cleanup should succeed");
}

#[tokio::test]
async fn unpublished_fixture_cleanup_preserves_assertion_or_timeout() {
    for timeout in [false, true] {
        let mut fixture = RegistrationFixture::new();
        let spawned = fixture.create_process();
        let identity = spawned.managed_process().clone();
        let pid_dir = fixture.cleanup.pid_dir();
        assert!(process_is_live(&identity));
        let failure = AssertUnwindSafe(async move {
            let _fixture = fixture;
            let _spawned = spawned;
            if timeout {
                tokio::time::timeout(
                    std::time::Duration::from_millis(1),
                    std::future::pending::<()>(),
                )
                .await
                .expect("injected registration timeout");
            } else {
                std::panic::panic_any(42_u32);
            }
        })
        .catch_unwind()
        .await
        .expect_err("injected failure should survive teardown");
        if timeout {
            assert!(failure
                .downcast::<String>()
                .unwrap()
                .contains("injected registration timeout"));
        } else {
            assert_eq!(*failure.downcast::<u32>().unwrap(), 42);
        }
        assert!(!process_is_live(&identity));
        assert_root_reaped(&identity);
        assert!(!pid_dir.exists());
    }
}

#[tokio::test]
async fn unpublished_fixture_cleanup_preserves_cancellation_and_other_fixture() {
    let mut fixture = RegistrationFixture::new();
    let spawned = fixture.create_process();
    let identity = spawned.managed_process().clone();
    let pid_dir = fixture.cleanup.pid_dir();
    let mut unrelated = RegistrationFixture::new();
    let mut unrelated_spawned = unrelated.create_process();
    let unrelated_identity = unrelated_spawned.managed_process().clone();
    let unrelated_record = std::fs::read(unrelated.cleanup.pid_dir().join(format!(
        "unpublished-{}-pty.pid",
        unrelated_spawned.instance_id()
    )))
    .unwrap();
    // A copied disk record grants no ownership, even with the same session key.
    let copied_record = pid_dir.join("unrelated-pty.pid");
    std::fs::write(&copied_record, &unrelated_record).unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let body = tokio::spawn(async move {
        let _fixture = fixture;
        let _spawned = spawned;
        entered_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    entered_rx.await.unwrap();
    body.abort();
    assert!(body.await.unwrap_err().is_cancelled());
    assert!(!process_is_live(&identity));
    assert_root_reaped(&identity);
    assert!(process_is_live(&unrelated_identity));
    assert_eq!(std::fs::read(&copied_record).unwrap(), unrelated_record);
    assert_eq!(
        std::fs::read(unrelated.cleanup.pid_dir().join(format!(
            "unpublished-{}-pty.pid",
            unrelated_spawned.instance_id()
        )))
        .unwrap(),
        unrelated_record
    );
    // Remove only this test's intentionally unclaimed recovery record.
    std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
    unrelated.cleanup.finish().expect("other fixture cleanup");
    let _ = unrelated_spawned.session.child.try_wait();
    assert_root_reaped(&unrelated_identity);
}

#[tokio::test]
async fn unpublished_fixture_preserves_private_recovery_on_identity_failure() {
    for cancelled in [false, true] {
        let mut recovery_manager = PtyManager::new();
        let mut recovery = NativePtyFixtureCleanup::new(&mut recovery_manager);
        let mut fixture = RegistrationFixture::new();
        let mut original = None;
        let spawned = fixture.create_process_with(|session| {
            original = Some(session.managed_process.clone());
            // Arm verified fallback ownership before corrupting the tested identity.
            let mut session = recovery
                .retain_unpublished_session(session)
                .expect("verified fallback ownership should persist");
            session.managed_process.root_start_time += 1;
            session
        });
        let original = original.unwrap();
        let pid_dir = fixture.cleanup.pid_dir();
        let pid_file = pid_dir.join(format!("unpublished-{}-pty.pid", spawned.instance_id()));
        let record = std::fs::read(&pid_file).unwrap();
        if cancelled {
            let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
            let body = tokio::spawn(async move {
                let _fixture = fixture;
                entered_tx.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            entered_rx.await.unwrap();
            body.abort();
            assert!(body.await.unwrap_err().is_cancelled());
        } else {
            let failure = AssertUnwindSafe(async move {
                let _fixture = fixture;
                std::panic::panic_any(42_u32);
            })
            .catch_unwind()
            .await
            .unwrap_err();
            assert_eq!(*failure.downcast::<u32>().unwrap(), 42);
        }
        assert!(
            process_is_live(&original),
            "mismatched identity must not be signalled"
        );
        assert_eq!(std::fs::read(&pid_file).unwrap(), record);
        // The outer owner remains armed through every evidence assertion and await.
        recovery.finish().expect("verified fixture recovery");
        assert_root_reaped(&original);
        std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
    }
}

#[tokio::test]
async fn unpublished_fixture_cleans_up_cancelled_registration_future() {
    let mut fixture = RegistrationFixture::new();
    let manager = fixture.manager.clone();
    let spawned = fixture.create_process();
    let identity = spawned.managed_process().clone();
    let pid_dir = fixture.cleanup.pid_dir();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let body = tokio::spawn(async move {
        let _fixture = fixture;
        let sessions = manager.sessions.lock().await;
        let mut registration = Box::pin(manager.register_spawned_session(
            SessionRegistrationRequest {
                session_key: "stale-registration-stage",
                generation: 0,
                session: spawned.session,
                replacement_label: "RegistrationTest",
                stale_error: PtyError::SpawnFailed("injected stale generation".into()),
            },
        ));
        assert!(futures::poll!(&mut registration).is_pending());
        drop(sessions);
        entered_tx.send(()).unwrap();
        std::future::pending::<()>().await;
        drop(registration);
    });
    entered_rx.await.unwrap();
    body.abort();
    assert!(body.await.unwrap_err().is_cancelled());
    assert!(!process_is_live(&identity));
    assert_root_reaped(&identity);
    assert!(!pid_dir.exists());
}

#[test]
fn unpublished_fixture_cleanup_works_after_runtime_shutdown() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (fixture, identity, pid_dir) = runtime.block_on(async {
        let mut fixture = RegistrationFixture::new();
        let spawned = fixture.create_process();
        let identity = spawned.managed_process().clone();
        let pid_dir = fixture.cleanup.pid_dir();
        drop(spawned);
        (fixture, identity, pid_dir)
    });
    drop(runtime);
    drop(fixture);
    assert!(!process_is_live(&identity));
    assert_root_reaped(&identity);
    assert!(!pid_dir.exists());
}

#[tokio::test]
async fn identity_failure_regression_cleans_up_after_evidence_check_failure() {
    for cancelled in [false, true] {
        let mut recovery_manager = PtyManager::new();
        let mut recovery = NativePtyFixtureCleanup::new(&mut recovery_manager);
        let mut fixture = RegistrationFixture::new();
        let mut original = None;
        let spawned = fixture.create_process_with(|session| {
            original = Some(session.managed_process.clone());
            let mut session = recovery
                .retain_unpublished_session(session)
                .expect("verified fallback ownership should persist");
            session.managed_process.root_start_time += 1;
            session
        });
        let original = original.unwrap();
        let pid_dir = fixture.cleanup.pid_dir();
        let pid_file = pid_dir.join(format!("unpublished-{}-pty.pid", spawned.instance_id()));
        let record = std::fs::read(&pid_file).unwrap();
        let evidence_path = pid_file.clone();
        let expected_record = record.clone();
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let body = tokio::spawn(async move {
            let _recovery = recovery;
            let _spawned = spawned;
            drop(fixture);
            assert_eq!(std::fs::read(evidence_path).unwrap(), expected_record);
            entered_tx.send(()).unwrap();
            if cancelled {
                std::future::pending::<()>().await;
            } else {
                std::panic::panic_any(42_u32);
            }
        });
        entered_rx.await.unwrap();
        if cancelled {
            body.abort();
            assert!(body.await.unwrap_err().is_cancelled());
        } else {
            let failure = body.await.unwrap_err().into_panic();
            assert_eq!(*failure.downcast::<u32>().unwrap(), 42);
        }
        assert!(!process_is_live(&original));
        assert_root_reaped(&original);
        assert_eq!(
            std::fs::read(&pid_file).unwrap(),
            record,
            "verified fallback must not delete the mismatched recovery evidence"
        );
        std::fs::remove_dir_all(pid_dir.parent().unwrap()).unwrap();
    }
}
