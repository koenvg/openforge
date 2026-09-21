use super::*;
use crate::{db::acquire_db, github_runtime::task_pr_discovery::tests::support::Fixture};
use openforge_session_protocol::{PreparedCommand, TerminalOwner};

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn daemon_agent_exit_discovers_without_daemon_output_integration() {
    let f = Fixture::new(false, Some("test-token")).await;
    let root = tempfile::Builder::new()
        .prefix("pr-exit-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let bridge = DaemonShells::with_selection(
        root.path().into(),
        executable,
        String::new(),
        [(f.task_id.clone(), "pi".into())].into(),
        Arc::new(std::sync::RwLock::new(TerminalColorProfile::default())),
    )
    .for_key(&f.task_id);
    bridge.configure_completion(f.local.clone());
    acquire_db(&f.db)
        .create_agent_session(
            "implementation",
            &f.task_id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .unwrap();
    let publisher = RuntimeEventPublisher::new(None, Some(f.bus.sender()));
    let mut events = f.bus.sender().subscribe();
    let instance = bridge
        .spawn(
            ShellCommand {
                owner: TerminalOwner::Agent {
                    task_id: f.task_id.clone(),
                },
                command: PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec!["-c".into(), "read reply; exit 0".into()],
                    cwd: f.dir.path().into(),
                    env: Default::default(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
            publisher.clone(),
        )
        .await
        .unwrap();
    acquire_db(&f.db)
        .set_agent_session_pty_instance_id("implementation", instance)
        .unwrap();
    let (client, _) = bridge.session_client().await.unwrap().unwrap();
    bridge
        .write(b"done\n".to_vec(), publisher.clone())
        .await
        .unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while events.recv().await.unwrap().event_name != "task-pull-request-updated" {}
    })
    .await;
    let _ = bridge.terminate(publisher).await;
    let _ = client.shutdown_empty();
    result.expect("current daemon exit should discover and notify without output parsing");
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn daemon_hyperlink_links_before_shell_exit_without_a_terminal_view() {
    assert_daemon_hyperlink_links(false).await;
    assert_daemon_hyperlink_links(true).await;
}

async fn assert_daemon_hyperlink_links(agent: bool) {
    let f = Fixture::new(false, Some("test-token")).await;
    let root = tempfile::Builder::new()
        .prefix("pr-link-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let owner = if agent {
        acquire_db(&f.db)
            .create_agent_session(
                "implementation",
                &f.task_id,
                None,
                "implementing",
                "running",
                "pi",
            )
            .unwrap();
        TerminalOwner::Agent {
            task_id: f.task_id.clone(),
        }
    } else {
        TerminalOwner::Shell {
            task_id: f.task_id.clone(),
            index: Some(0),
        }
    };
    let key = owner.session_key();
    let bridge = if agent {
        DaemonShells::with_selection(
            root.path().into(),
            executable,
            String::new(),
            [(key.clone(), "pi".into())].into(),
            Arc::new(std::sync::RwLock::new(TerminalColorProfile::default())),
        )
    } else {
        DaemonShells::new(
            root.path().into(),
            executable,
            key.clone(),
            Arc::new(std::sync::RwLock::new(TerminalColorProfile::default())),
        )
    }
    .for_key(&key);
    bridge.configure_completion(f.local.clone());
    bridge.configure_pr_discovery(f.discovery.clone());
    let publisher = RuntimeEventPublisher::new(None, Some(f.bus.sender()));
    let mut events = f.bus.sender().subscribe();
    let instance = bridge.spawn(ShellCommand {
        owner,
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "read start; printf '\\033]8;;https://github.com/acme/widgets/pull/42\\007PR #42\\033]8;;\\007'; read done".into()],
            cwd: f.dir.path().into(),
            env: Default::default(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }, publisher.clone()).await.unwrap();
    if agent {
        acquire_db(&f.db)
            .set_agent_session_pty_instance_id("implementation", instance)
            .unwrap();
    }
    let (client, _) = bridge.session_client().await.unwrap().unwrap();
    bridge
        .write(b"start\n".to_vec(), publisher.clone())
        .await
        .unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while events.recv().await.unwrap().event_name != "task-pull-request-updated" {}
        assert!(bridge.session().await.unwrap().unwrap().exit_code.is_none());
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            1
        );
    })
    .await;
    let _ = bridge.terminate(publisher).await;
    let _ = client.shutdown_empty();
    result.expect("live hyperlink must link before shell exit");
}
