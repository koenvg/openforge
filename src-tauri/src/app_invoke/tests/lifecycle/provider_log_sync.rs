use super::support::*;
use crate::app_events::AppEventEnvelope;
use base64::Engine;
use std::{fs, time::Duration};
fn output(task_id: &str, data: &str) -> AppEventEnvelope {
    AppEventEnvelope {
        id: None,
        event_name: format!("pty-output-{task_id}"),
        payload: serde_json::json!({ "data": data }),
        meta: None,
    }
}

fn daemon_output(task_id: &str, data: &str) -> AppEventEnvelope {
    AppEventEnvelope {
        id: None,
        event_name: format!("pty-model-output-{task_id}"),
        payload: serde_json::json!({
            "instance_id": 1,
            "start_sequence": 1,
            "sequence": 1,
            "data": base64::engine::general_purpose::STANDARD.encode(data),
        }),
        meta: None,
    }
}

#[tokio::test(start_paused = true)]
async fn daemon_provider_log_waits_for_delayed_terminal_output() {
    let temp = tempfile::tempdir().unwrap();
    let log_path = temp.path().join("provider.log");
    let (events, mut receiver) = tokio::sync::broadcast::channel(16);
    let writer_path = log_path.clone();
    let writer = tokio::spawn(async move {
        // Virtual time exceeds the removed polling budget without slowing the suite.
        tokio::time::sleep(Duration::from_secs(2)).await;
        let record = "provider=pi\narg1=Daemon prompt\nopenforge-provider-record=complete\n";
        fs::write(writer_path, record).unwrap();
        events
            .send(daemon_output("task", "openforge-provider-log=ready\r\n"))
            .unwrap();
        record
    });

    let log = read_provider_log_record_after_daemon_output(
        &mut receiver,
        "task",
        &log_path,
        "pi",
        "Daemon prompt",
    )
    .await;
    assert_eq!(log, writer.await.unwrap());
}

#[tokio::test(start_paused = true)]
async fn provider_log_waits_for_delayed_readiness() {
    let temp = tempfile::tempdir().unwrap();
    let log_path = temp.path().join("provider.log");
    let (events, mut receiver) = tokio::sync::broadcast::channel(16);
    let writer_path = log_path.clone();
    let writer = tokio::spawn(async move {
        // Virtual time exceeds the old polling budget without slowing the suite.
        tokio::time::sleep(Duration::from_secs(2)).await;
        let record = "provider=pi\narg1=Start with plugin prompt contribution\nopenforge-provider-record=complete\n";
        fs::write(writer_path, record).unwrap();
        events
            .send(output("task", "openforge-provider-log=ready\r\n"))
            .unwrap();
        record
    });

    let log = read_provider_log_record_after_ready(
        &mut receiver,
        "task",
        &log_path,
        "pi",
        "Start with plugin prompt contribution",
    )
    .await;
    assert_eq!(log, writer.await.unwrap());
}

#[tokio::test]
async fn provider_log_waits_for_its_own_complete_ready_signal() {
    let temp = tempfile::tempdir().unwrap();
    let log_path = temp.path().join("provider.log");
    let (events, mut receiver) = tokio::sync::broadcast::channel(16);
    let partial = "provider=pi\narg1=Start with plugin prompt contribution\n";
    fs::write(&log_path, partial).unwrap();

    let waiting = read_provider_log_record_after_ready(
        &mut receiver,
        "task",
        &log_path,
        "pi",
        "Start with plugin prompt contribution",
    );
    tokio::pin!(waiting);
    assert!(futures::poll!(&mut waiting).is_pending());

    events
        .send(output("other-task", "openforge-provider-log=ready\r\n"))
        .unwrap();
    assert!(futures::poll!(&mut waiting).is_pending());

    events
        .send(output("task", "openforge-provider-log="))
        .unwrap();
    assert!(futures::poll!(&mut waiting).is_pending());

    let complete = format!(
        "{partial}## Plugin Template\nPreserve plugin-owned reviewer brief\nopenforge-provider-record=complete\n"
    );
    fs::write(&log_path, &complete).unwrap();
    // Even a complete file is not a substitute for this provider's ready signal.
    assert!(futures::poll!(&mut waiting).is_pending());
    events.send(output("task", "ready\r\n")).unwrap();
    assert_eq!(waiting.await, complete);
}

#[tokio::test]
#[should_panic(expected = "should contain completed \"pi\" record")]
async fn provider_log_rejects_incomplete_record_after_readiness() {
    let temp = tempfile::tempdir().unwrap();
    let log_path = temp.path().join("provider.log");
    let (events, mut receiver) = tokio::sync::broadcast::channel(16);
    fs::write(&log_path, "provider=pi\narg1=expected prompt\n").unwrap();
    events
        .send(output("task", "openforge-provider-log=ready\r\n"))
        .unwrap();

    read_provider_log_record_after_ready(&mut receiver, "task", &log_path, "pi", "expected prompt")
        .await;
}

#[tokio::test(start_paused = true)]
#[should_panic(expected = "provider PTY should confirm its log is ready")]
async fn provider_log_times_out_when_provider_never_signals_readiness() {
    let temp = tempfile::tempdir().unwrap();
    let log_path = temp.path().join("provider.log");
    let (_events, mut receiver) = tokio::sync::broadcast::channel(16);

    read_provider_log_record_after_ready(&mut receiver, "task", &log_path, "pi", "expected prompt")
        .await;
}
