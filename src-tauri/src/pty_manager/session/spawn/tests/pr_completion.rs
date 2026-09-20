use crate::{
    app_events::RuntimeEventPublisher,
    db::acquire_db,
    github_runtime::task_pr_discovery::tests::support::Fixture,
    pty_manager::{
        session::provider_adapter::AgentPtyProviderAdapter, PtyError, PtyManager, PtySpawnContext,
    },
};
use std::{collections::HashMap, path::Path, time::Duration};

struct CompletingAgent;
impl AgentPtyProviderAdapter for CompletingAgent {
    fn label(&self) -> &'static str {
        "completion-test"
    }
    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }
    fn command_args(&self) -> Vec<String> {
        vec!["-c".into(), "read reply; exit 0".into()]
    }
    fn prepare(&mut self, _: &Path) -> Result<(), PtyError> {
        Ok(())
    }
    fn extra_env(&self, _: &str, _: u64) -> HashMap<String, String> {
        HashMap::new()
    }
    fn pid_file_name(&self, task: &str) -> String {
        format!("{task}-pty.pid")
    }
}

#[tokio::test]
async fn successful_local_agent_exit_links_first_pr_without_hooks_or_output() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut manager = PtyManager::new();
    manager.set_pid_dir(f.dir.path().join("pids"));
    manager.configure_pr_discovery(f.discovery.clone());
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
    let mut events = f.bus.sender().subscribe();
    let instance = manager
        .spawn_agent_pty(
            CompletingAgent,
            PtySpawnContext {
                task_id: &f.task_id,
                cwd: f.dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: RuntimeEventPublisher::new(None, Some(f.bus.sender())),
            },
            None,
        )
        .await
        .unwrap();
    acquire_db(&f.db)
        .set_agent_session_pty_instance_id("implementation", instance)
        .unwrap();
    manager.write_pty(&f.task_id, b"done\n").await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while events.recv().await.unwrap().event_name != "task-pull-request-updated" {}
    })
    .await
    .expect("exit-only completion must notify without polling");
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
}
