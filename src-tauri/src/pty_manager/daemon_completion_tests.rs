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
