use super::{support::*, *};
use futures::FutureExt;
use std::{panic::AssertUnwindSafe, time::Duration};
use sysinfo::{Pid, ProcessStatus, System};

async fn started_provider_fixture(
    name: &str,
) -> (ProviderLifecycleFixture, tempfile::TempDir, String) {
    let fixture = ProviderLifecycleFixture::new(name).await;
    let (_repo_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&fixture.state().db);
        let project = db
            .create_project(
                "Fixture cleanup",
                repo_dir.to_str().expect("UTF-8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Fixture cleanup provider",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };
    invoke_ok(
        fixture.state(),
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir }),
    )
    .await;
    (fixture, _repo_temp, task_id)
}

#[tokio::test]
async fn provider_fixture_cleanup_preserves_assertion_and_timeout_failures() {
    for timeout in [false, true] {
        let (fixture, _repo_temp, task_id) =
            started_provider_fixture("provider_fixture_failure_cleanup").await;
        let observer = fixture.state().clone();
        let manager = observer.pty_manager.as_ref().unwrap();
        let pid = manager
            .agent_pty_pid(&task_id, None)
            .await
            .expect("provider PID");
        let pid_dir = fixture.pid_dir();
        let result = AssertUnwindSafe(async move {
            let _fixture = fixture;
            if timeout {
                tokio::time::timeout(Duration::from_millis(1), std::future::pending::<()>())
                    .await
                    .expect("injected fixture timeout");
            } else {
                std::panic::panic_any(42_u32);
            }
        })
        .catch_unwind()
        .await;
        let primary = result.expect_err("fixture failure must survive cleanup");
        if timeout {
            assert!(primary
                .downcast::<String>()
                .unwrap()
                .contains("injected fixture timeout"));
        } else {
            assert_eq!(*primary.downcast::<u32>().unwrap(), 42);
        }
        let buffer = invoke_ok(
            &observer,
            "get_pty_buffer",
            json!({ "shellSessionKey": task_id }),
        )
        .await;
        assert_eq!(
            buffer["isLive"], false,
            "failed fixture must stop its provider"
        );
        assert!(
            !pid_dir.exists(),
            "successful cleanup should remove private metadata"
        );
        assert!(!System::new_all()
            .process(Pid::from_u32(pid))
            .is_some_and(|p| p.status() != ProcessStatus::Zombie));

        // Teardown completes before releasing the shared fake-provider lock.
        ProviderLifecycleFixture::new("provider_fixture_after_failure")
            .await
            .finish()
            .expect("next fixture should acquire the provider lock");
    }
}

#[tokio::test]
async fn provider_fixture_cleanup_preserves_task_cancellation() {
    let (fixture, _repo_temp, task_id) =
        started_provider_fixture("provider_fixture_cancelled_cleanup").await;
    let observer = fixture.state().clone();
    let pid_dir = fixture.pid_dir();
    let pid = observer
        .pty_manager
        .as_ref()
        .unwrap()
        .agent_pty_pid(&task_id, None)
        .await
        .unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let body = tokio::spawn(async move {
        let _fixture = fixture;
        entered_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    entered_rx.await.unwrap();
    body.abort();
    assert!(body.await.expect_err("body was aborted").is_cancelled());
    let buffer = invoke_ok(
        &observer,
        "get_pty_buffer",
        json!({ "shellSessionKey": task_id }),
    )
    .await;
    assert_eq!(
        buffer["isLive"], false,
        "cancelled fixture must stop its provider"
    );
    assert!(!pid_dir.exists());
    assert!(!System::new_all()
        .process(Pid::from_u32(pid))
        .is_some_and(|p| p.status() != ProcessStatus::Zombie));
}
