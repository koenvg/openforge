use super::support::{
    model_event_fixture, wait_for_file_removal, wait_for_model_output, wait_for_model_shutdown,
    wait_for_output, ShellTestHarness,
};
use crate::pty_manager::pids::shell_session_key;
use crate::terminal_model::{
    TerminalModelQueueSaturationGate, TerminalModelTestFault,
    TERMINAL_MODEL_QUEUE_SATURATION_TEST_BYTES,
};
use portable_pty::CommandBuilder;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn ghostty_authority_tracks_live_shell_without_changing_replay_or_lifecycle() {
    let harness = ShellTestHarness::new();
    let task_id = "ghostty-authority-shell";
    let session_key = shell_session_key(task_id, Some(0));
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-lc");
    command.arg("printf 'ghostty-output'; exec sleep 30");

    let instance_id = harness
        .spawn_with_publisher(
            task_id,
            Some(0),
            crate::app_events::RuntimeEventPublisher::new(None, None),
            command,
        )
        .await
        .expect("shell PTY should spawn with Ghostty authority");

    wait_for_output(
        &harness.manager,
        &session_key,
        "ghostty-output",
        Duration::from_secs(5),
    )
    .await;
    harness
        .manager
        .resize_pty(&session_key, 100, 30)
        .await
        .expect("normal PTY resize should still succeed");

    {
        let sessions = harness.manager.sessions.lock().await;
        let session = sessions.get(&session_key).expect("live shell session");
        assert_eq!(session.instance_id, instance_id);
        let model = session
            .terminal_model
            .as_ref()
            .expect("Ghostty model should own the live instance");
        let snapshot = model.snapshot().expect("canonical snapshot should encode");
        let portable = model.portable_vt().expect("portable VT should format");
        assert!(snapshot.starts_with(b"GHOSTSNP"));
        assert!(portable
            .windows(b"ghostty-output".len())
            .any(|part| part == b"ghostty-output"));
    }

    harness
        .manager
        .kill_pty(&session_key)
        .await
        .expect("normal PTY cleanup should still succeed");
    assert!(!harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_creation_failure_terminates_session_and_preserves_shell_key() {
    let harness = ShellTestHarness::new();
    harness
        .manager
        .set_terminal_model_test_fault(TerminalModelTestFault::CreateFailure);
    let task_id = "ghostty-create-failure";
    let session_key = shell_session_key(task_id, Some(0));
    let (event_publisher, mut events) = model_event_fixture();

    let failed_instance = harness
        .spawn_with_publisher(
            task_id,
            Some(0),
            event_publisher,
            super::support::long_running_shell_command(),
        )
        .await
        .expect("PTY spawn should complete before the asynchronous model failure is handled");

    wait_for_model_shutdown(&mut events, &session_key, failed_instance).await;
    assert!(!harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
    wait_for_file_removal(&harness.pid_dir.join(format!("{session_key}.pid"))).await;

    let replacement_instance = harness
        .spawn_long_running(task_id, Some(0))
        .await
        .expect("the same Shell Session Key should accept a replacement PTY");
    assert_ne!(replacement_instance, failed_instance);
    assert_eq!(
        harness
            .manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(replacement_instance),
    );
    harness
        .manager
        .terminate_failed_terminal_model(&session_key, failed_instance)
        .await
        .expect("a stale model failure should be ignored");
    assert_eq!(
        harness
            .manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(replacement_instance),
        "the failed PTY instance must not terminate its successor",
    );
    harness
        .manager
        .kill_pty(&session_key)
        .await
        .expect("replacement PTY should be cleaned up");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_queue_saturation_backpressures_and_recovers_the_session() {
    let harness = ShellTestHarness::new();
    let queue_gate = TerminalModelQueueSaturationGate::new();
    harness
        .manager
        .set_terminal_model_test_fault(TerminalModelTestFault::BlockFirstCommand(
            queue_gate.clone(),
        ));
    let task_id = "ghostty-queue-saturation";
    let session_key = shell_session_key(task_id, Some(0));
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg(format!(
        "head -c {} /dev/zero | tr '\\0' x; printf model-queue-recovered; exec sleep 30",
        TERMINAL_MODEL_QUEUE_SATURATION_TEST_BYTES
    ));

    let (event_publisher, events) = model_event_fixture();
    let instance_id = harness
        .spawn_with_publisher(task_id, Some(0), event_publisher, command)
        .await
        .expect("Ghostty PTY should spawn");

    let recovery = tokio::spawn(wait_for_model_output(
        events,
        session_key.clone(),
        instance_id,
        b"model-queue-recovered",
    ));
    let blocked_gate = queue_gate.clone();
    tokio::task::spawn_blocking(move || blocked_gate.wait_until_queue_saturated())
        .await
        .expect("queue saturation wait should join");
    queue_gate.release_first_command();
    recovery
        .await
        .expect("model output wait should join after queue recovery");

    let terminal_model = harness
        .manager
        .sessions
        .lock()
        .await
        .get(&session_key)
        .and_then(|session| session.terminal_model.as_ref().map(Arc::clone))
        .expect("recovered authoritative session should retain its model");
    assert!(
        terminal_model.queue_saturated_for_test(),
        "the worker must observe a full command queue before recovery",
    );
    let snapshot = tokio::task::spawn_blocking(move || terminal_model.portable_snapshot())
        .await
        .expect("model snapshot task should join")
        .expect("the model worker should drain its saturated queue");
    assert_eq!(snapshot.instance_id, instance_id);
    assert!(snapshot
        .portable_vt
        .windows(b"model-queue-recovered".len())
        .any(|window| window == b"model-queue-recovered"));

    assert_eq!(
        harness
            .manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(instance_id),
    );
    harness
        .manager
        .kill_pty(&session_key)
        .await
        .expect("recovered PTY should be cleaned up");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_worker_panic_terminates_the_affected_session() {
    let harness = ShellTestHarness::new();
    harness
        .manager
        .set_terminal_model_test_fault(TerminalModelTestFault::PanicOnFirstCommand);
    let task_id = "ghostty-worker-panic";
    let session_key = shell_session_key(task_id, Some(0));
    let (event_publisher, mut events) = model_event_fixture();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("printf panic-trigger; exec sleep 30");

    let instance_id = harness
        .spawn_with_publisher(task_id, Some(0), event_publisher, command)
        .await
        .expect("PTY should spawn before its model worker panics");

    wait_for_model_shutdown(&mut events, &session_key, instance_id).await;
    assert!(!harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
    wait_for_file_removal(&harness.pid_dir.join(format!("{session_key}.pid"))).await;
}
