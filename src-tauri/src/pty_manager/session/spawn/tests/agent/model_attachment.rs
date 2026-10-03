//! Model events and replay-to-live terminal attachments.

use super::support::LockCheckingAgentAdapter;
use crate::app_events::{AppEventBus, AppEventFrame, InMemoryAppEventAdapter};
use crate::backend_runtime::AppHandle;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use crate::pty_manager::{PtyManager, PtySpawnContext};
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn ghostty_agent_publishes_model_output_through_runtime_event_adapter() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "ghostty-agent-runtime-events";
    let bus = AppEventBus::new(32, 8);
    let app = AppHandle::new();
    app.set_app_event_adapter(Arc::new(InMemoryAppEventAdapter::new(bus.clone())));
    let mut events = bus.subscribe(None).expect("event subscription should open");
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_release_rx: None,
        script: "printf ghostty-agent-output",
        check_lock: true,
    };

    let instance_id = manager
        .spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(Some(app), None),
            },
            None,
        )
        .await
        .expect("Ghostty agent PTY should spawn");

    let model_event = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let AppEventFrame::Event(event) =
                events.recv().await.expect("event stream should stay open")
            else {
                continue;
            };
            if event.event_name == format!("pty-model-output-{task_id}") {
                return event;
            }
        }
    })
    .await
    .expect("Ghostty model output should reach the runtime event adapter");

    assert_eq!(model_event.payload["instance_id"], instance_id);
    assert_eq!(model_event.payload["sequence"], 1);
    assert!(model_event.payload["data"].is_string());
    manager
        .kill_pty(task_id)
        .await
        .expect("test PTY should be cleaned up");
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn agent_attachment_exposes_bounded_replay_then_gap_free_live_output() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "companion-agent-attachment";
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_release_rx: None,
        script:
            "stty -echo; printf ready; IFS= read -r _; printf before; IFS= read -r _; printf after",
        check_lock: true,
    };
    manager
        .spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await
        .expect("agent PTY");

    let event_timeout = Duration::from_secs(5);
    let mut before_replay = manager
        .attach_agent_terminal(task_id)
        .await
        .expect("running Agent attachment");
    if before_replay.replay().is_empty() {
        assert_eq!(
            tokio::time::timeout(event_timeout, before_replay.recv())
                .await
                .expect("readiness output deadline")
                .expect("readiness output"),
            crate::pty_manager::AgentTerminalEvent::Output(b"ready".to_vec()),
        );
    } else {
        assert_eq!(before_replay.replay(), b"ready");
    }
    before_replay
        .write_input(b"\n")
        .await
        .expect("release replay output");
    assert_eq!(
        tokio::time::timeout(event_timeout, before_replay.recv())
            .await
            .expect("replay output deadline")
            .expect("replay output"),
        crate::pty_manager::AgentTerminalEvent::Output(b"before".to_vec()),
    );

    let mut attachment = manager
        .attach_agent_terminal(task_id)
        .await
        .expect("running Agent attachment");
    assert_eq!(attachment.replay(), b"readybefore");
    drop(before_replay);
    assert!(manager.agent_terminal_available(task_id).await);
    attachment
        .write_input(b"\n")
        .await
        .expect("release live output");
    assert_eq!(
        tokio::time::timeout(event_timeout, attachment.recv())
            .await
            .expect("live output deadline")
            .expect("live output"),
        crate::pty_manager::AgentTerminalEvent::Output(b"after".to_vec()),
    );

    manager.kill_pty(task_id).await.expect("PTY cleanup");
    assert_eq!(
        tokio::time::timeout(event_timeout, attachment.recv())
            .await
            .expect("exit deadline")
            .expect("exit event"),
        crate::pty_manager::AgentTerminalEvent::Exited,
    );
    assert!(!manager.agent_terminal_available(task_id).await);
    cleanup.finish().expect("agent fixture PTY cleanup");
}
