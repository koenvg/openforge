use crate::{
    app_events::RuntimeEventPublisher,
    github_runtime::task_pr_discovery::tests::support::Fixture,
    pty_manager::{PtyManager, PtySpawnContext},
};

struct PrDiscoveryPtyFixture {
    // Tear down owned processes before the discovery workspace can disappear.
    cleanup: crate::pty_manager::test_fixture::NativePtyFixtureCleanup,
    manager: PtyManager,
    discovery: Fixture,
}

impl PrDiscoveryPtyFixture {
    async fn new() -> Self {
        let discovery = Fixture::new(false, Some("test-token")).await;
        let mut manager = PtyManager::new();
        let cleanup = crate::pty_manager::test_fixture::NativePtyFixtureCleanup::new(&mut manager);
        manager.configure_pr_discovery(discovery.discovery.clone());
        Self {
            cleanup,
            manager,
            discovery,
        }
    }
}

#[path = "pr_discovery_cleanup.rs"]
mod cleanup_tests;

#[tokio::test]
async fn live_local_shell_output_links_first_pr_without_any_terminal_view() {
    assert_live_shell_links("printf 'created https://github.com/acme/widgets/pull/42\\n'").await;
}

#[tokio::test]
async fn live_local_shell_hyperlink_links_first_pr_without_any_terminal_view() {
    assert_live_shell_links("printf 'Created \\033]8;;https://github.com/acme/widgets/pull/42\\007PR #42\\033]8;;\\007.\\n'").await;
}

async fn assert_live_shell_links(script: &str) {
    let mut fixture = PrDiscoveryPtyFixture::new().await;
    let f = &fixture.discovery;
    let manager = &fixture.manager;
    let mut events = f.bus.sender().subscribe();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg(script);
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
    fixture.cleanup.finish().expect("PR discovery PTY cleanup");
}

#[tokio::test]
async fn project_only_shell_cannot_claim_a_task_from_printed_text() {
    let mut fixture = PrDiscoveryPtyFixture::new().await;
    let f = &fixture.discovery;
    let manager = &fixture.manager;
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
    fixture.cleanup.finish().expect("project shell PTY cleanup");
}
