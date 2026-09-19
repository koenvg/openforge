use crate::{
    app_events::RuntimeEventPublisher,
    github_runtime::task_pr_discovery::tests::support::Fixture,
    pty_manager::{PtyManager, PtySpawnContext},
};

#[tokio::test]
async fn live_local_shell_output_links_first_pr_without_any_terminal_view() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut manager = PtyManager::new();
    manager.set_pid_dir(f.dir.path().join("pids"));
    manager.configure_pr_discovery(f.discovery.clone());
    let mut events = f.bus.sender().subscribe();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("printf 'created https://github.com/acme/widgets/pull/42\\n'");
    manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id: &f.task_id,
                cwd: f.dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: RuntimeEventPublisher::new(None, Some(f.bus.sender())),
            },
            Some(0),
            None,
            command,
        )
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut linked = false;
        let mut exited = false;
        while !linked || !exited {
            let event = events.recv().await.unwrap();
            linked |= event.event_name == "task-pull-request-updated";
            exited |= event.event_name.starts_with("pty-exit-");
        }
    })
    .await
    .expect("first PR linked and shell cleaned up without polling");
    let prs = crate::db::acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pr_number, 42);
}

#[tokio::test]
async fn project_only_shell_cannot_claim_a_task_from_printed_text() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut manager = PtyManager::new();
    manager.set_pid_dir(f.dir.path().join("pids"));
    manager.configure_pr_discovery(f.discovery.clone());
    let mut events = f.bus.sender().subscribe();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg(format!(
        "printf '{} https://github.com/acme/widgets/pull/42\\n'",
        f.task_id
    ));
    manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id: &f.project_id,
                cwd: f.dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: RuntimeEventPublisher::new(None, Some(f.bus.sender())),
            },
            Some(0),
            None,
            command,
        )
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !events
            .recv()
            .await
            .unwrap()
            .event_name
            .starts_with("pty-exit-")
        {}
    })
    .await
    .unwrap();
    f.discovery.settled().await;
    assert!(crate::db::acquire_db(&f.db)
        .get_all_pull_requests()
        .unwrap()
        .is_empty());
}
