use super::*;
use crate::terminal_model::{GhosttyTerminalModel, TerminalModel};
use std::sync::mpsc;
use std::time::Duration;

#[tokio::test(flavor = "current_thread")]
async fn concurrent_desktop_and_attachment_resizes_keep_pty_and_model_dimensions_together() {
    let manager = PtyManager::new();
    let directory = tempfile::tempdir().expect("terminal directory");
    let key = "serialized-resize";
    manager
        .spawn_companion_test_agent_pty(key, directory.path(), "sleep 30")
        .await
        .expect("agent PTY");
    let attachment = manager
        .attach_agent_terminal(key)
        .await
        .expect("attachment");
    let (master, model) = {
        let sessions = manager.sessions.lock().await;
        let session = sessions.get(key).expect("session");
        (
            Arc::clone(&session.master),
            Arc::clone(session.terminal_model.as_ref().expect("terminal model")),
        )
    };

    let (first_reached_tx, first_reached_rx) = mpsc::channel();
    let (first_release_tx, first_release_rx) = mpsc::channel();
    manager
        .terminal_sessions
        .set_resize_model_gate(ResizeStartGate {
            reached_tx: first_reached_tx,
            release_rx: first_release_rx,
        });
    let (second_reached_tx, second_reached_rx) = mpsc::channel();
    let (second_release_tx, second_release_rx) = mpsc::channel();
    second_release_tx.send(()).expect("allow competing resize");
    let (first_ready_tx, first_ready_rx) = tokio::sync::oneshot::channel();
    let (second_ready_tx, second_ready_rx) = tokio::sync::oneshot::channel();
    let (progress_tx, progress_rx) = mpsc::channel();
    let (second_done_tx, second_done_rx) = mpsc::channel();

    // Always release the first request, even if a regression blocks the sole
    // executor thread. Channel handshakes establish the competing schedule;
    // timeouts only bound the wait for work that must remain blocked.
    let watchdog = std::thread::spawn(move || {
        let first_started = first_reached_rx
            .recv_timeout(Duration::from_secs(5))
            .is_ok();
        let _ = first_ready_tx.send(());
        let second_started = second_reached_rx
            .recv_timeout(Duration::from_secs(5))
            .is_ok();
        let _ = second_ready_tx.send(());
        let progressed = progress_rx.recv_timeout(Duration::from_secs(1)).is_ok();
        let second_finished_early = second_done_rx
            .recv_timeout(Duration::from_millis(500))
            .is_ok();
        let _ = first_release_tx.send(());
        (
            first_started,
            second_started,
            progressed,
            second_finished_early,
        )
    });
    let desktop_manager = manager.clone();
    let desktop = tokio::spawn(async move { desktop_manager.resize_pty(key, 120, 40).await });
    first_ready_rx
        .await
        .expect("first resize reached model boundary");
    manager
        .terminal_sessions
        .set_resize_start_gate(ResizeStartGate {
            reached_tx: second_reached_tx,
            release_rx: second_release_rx,
        });
    let mobile = tokio::spawn(async move {
        let result = attachment.resize(90, 30).await;
        let _ = second_done_tx.send(());
        result
    });
    second_ready_rx.await.expect("competing resize started");
    let keys = manager.get_session_keys().await;
    let _ = progress_tx.send(());
    desktop
        .await
        .expect("desktop task")
        .expect("desktop resize");
    mobile.await.expect("mobile task").expect("mobile resize");

    let (pty_size, model_replies) = tokio::task::spawn_blocking(move || {
        let pty_size = master
            .lock()
            .expect("master lock")
            .get_size()
            .expect("PTY size");
        (pty_size, model_dimensions(&model))
    })
    .await
    .expect("dimension observation");
    manager.kill_pty(key).await.expect("PTY cleanup");
    let (first_started, second_started, progressed, second_finished_early) =
        watchdog.join().expect("watchdog");

    assert_eq!((pty_size.cols, pty_size.rows), (90, 30));
    assert_eq!(model_replies, vec![b"\x1b[30;90R".to_vec()]);
    assert!(
        first_started && second_started,
        "both resize boundaries must be reached"
    );
    assert!(
        progressed,
        "executor and session lookup must remain available"
    );
    assert_eq!(keys, vec![key.to_string()]);
    assert!(
        !second_finished_early,
        "competing resize must wait for the model update"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn queued_attachment_resize_stays_with_its_resolved_instance() {
    let mut manager = PtyManager::new();
    let mut fixture = test_fixture::NativePtyFixtureCleanup::new(&mut manager);
    let key = "resize-instance";
    let original = modeled_agent_session(&mut fixture, key, 1);
    let original_master = Arc::clone(&original.master);
    let original_model = Arc::clone(original.terminal_model.as_ref().expect("original model"));
    manager
        .sessions
        .lock()
        .await
        .insert(key.to_string(), original);
    manager.attachment_hubs.lock().await.insert(
        key.to_string(),
        Arc::new(attachment::PtyAttachmentHub::new(1, 1024, 8)),
    );
    let queued = manager
        .attach_agent_terminal(key)
        .await
        .expect("queued attachment");
    let stale = manager
        .attach_agent_terminal(key)
        .await
        .expect("stale attachment");
    let (reached_tx, reached_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    manager
        .terminal_sessions
        .set_resize_start_gate(ResizeStartGate {
            reached_tx,
            release_rx,
        });
    let resize = tokio::spawn(async move { queued.resize(120, 40).await });
    tokio::task::spawn_blocking(move || reached_rx.recv_timeout(Duration::from_secs(5)))
        .await
        .expect("gate observer")
        .expect("instance resolved before PTY I/O");

    let replacement = modeled_agent_session(&mut fixture, key, 2);
    let replacement_master = Arc::clone(&replacement.master);
    let replacement_model = Arc::clone(
        replacement
            .terminal_model
            .as_ref()
            .expect("replacement model"),
    );
    let original = manager
        .sessions
        .lock()
        .await
        .insert(key.to_string(), replacement)
        .expect("original session");
    // Keep the original process alive until the queued operation completes.
    manager
        .sessions
        .lock()
        .await
        .insert("retired-resize-instance".to_string(), original);
    let stale_result = stale.resize(90, 30).await;
    release_tx.send(()).expect("release original resize");
    let resize_result = resize.await.expect("queued resize task");
    let dimensions = tokio::task::spawn_blocking(move || {
        let original_size = original_master
            .lock()
            .expect("original lock")
            .get_size()
            .expect("original size");
        let replacement_size = replacement_master
            .lock()
            .expect("replacement lock")
            .get_size()
            .expect("replacement size");
        (
            original_size,
            model_dimensions(&original_model),
            replacement_size,
            model_dimensions(&replacement_model),
        )
    })
    .await
    .expect("dimension observation");
    manager.kill_all().await;

    resize_result.expect("queued resize succeeds for the resolved instance");
    assert!(matches!(
        stale_result,
        Err(attachment::AgentTerminalAttachmentError::StaleAttachment)
    ));
    assert_eq!((dimensions.0.cols, dimensions.0.rows), (120, 40));
    assert_eq!(dimensions.1, vec![b"\x1b[40;120R".to_vec()]);
    assert_eq!((dimensions.2.cols, dimensions.2.rows), (80, 24));
    assert_eq!(dimensions.3, vec![b"\x1b[24;80R".to_vec()]);
    fixture.finish().expect("fixture cleanup");
}

#[cfg(unix)]
#[tokio::test]
async fn failed_pty_resizes_propagate_without_resizing_the_model() {
    use std::os::fd::AsRawFd;

    let mut manager = PtyManager::new();
    let mut fixture = test_fixture::NativePtyFixtureCleanup::new(&mut manager);
    let key = "failed-resize";
    let session = modeled_agent_session(&mut fixture, key, 1);
    let master = Arc::clone(&session.master);
    let model = Arc::clone(session.terminal_model.as_ref().expect("model"));
    let expected_error = tokio::task::spawn_blocking(move || {
        let master = master.lock().expect("master lock");
        let fd = master.as_raw_fd().expect("Unix master descriptor");
        let non_terminal = std::fs::File::open("/dev/null").expect("non-terminal device");
        // SAFETY: Both descriptors are live and the master lock excludes other
        // users. dup2 replaces only this test-owned descriptor with another
        // valid descriptor, so the master's eventual close remains valid.
        let result = unsafe { libc::dup2(non_terminal.as_raw_fd(), fd) };
        assert_eq!(result, fd, "replace test master with a non-terminal");
        master
            .resize(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect_err("non-terminal resize must fail")
            .to_string()
    })
    .await
    .expect("fault setup");
    manager
        .sessions
        .lock()
        .await
        .insert(key.to_string(), session);
    manager.attachment_hubs.lock().await.insert(
        key.to_string(),
        Arc::new(attachment::PtyAttachmentHub::new(1, 1024, 8)),
    );
    let attachment = manager
        .attach_agent_terminal(key)
        .await
        .expect("attachment");

    let desktop_result = manager.resize_pty(key, 120, 40).await;
    let mobile_result = attachment.resize(90, 30).await;
    let dimensions = tokio::task::spawn_blocking(move || model_dimensions(&model))
        .await
        .expect("model observation");
    manager.kill_all().await;

    let Err(PtyError::IoError(error)) = desktop_result else {
        panic!("desktop resize must propagate the PTY I/O error");
    };
    assert_eq!(error.to_string(), expected_error);
    assert!(matches!(
        mobile_result,
        Err(attachment::AgentTerminalAttachmentError::ResizeFailed)
    ));
    assert_eq!(dimensions, vec![b"\x1b[24;80R".to_vec()]);
    fixture.finish().expect("fixture cleanup");
}

fn modeled_agent_session(
    fixture: &mut test_fixture::NativePtyFixtureCleanup,
    key: &str,
    instance_id: u64,
) -> PtySession {
    let mut session = test_agent_pty_session(fixture, key);
    session.instance_id = instance_id;
    let (model, _feeder) = crate::terminal_model::TerminalModelSession::start(
        key.to_string(),
        instance_id,
        crate::terminal_model::TerminalModelOptions::new(80, 24),
    )
    .expect("terminal model");
    session.terminal_model = Some(Arc::new(model));
    session
}

// Clamp to the bottom-right corner and query the cursor to observe the actual
// model grid through the terminal protocol. Call only from a blocking worker.
fn model_dimensions(model: &crate::terminal_model::TerminalModelSession) -> Vec<Vec<u8>> {
    let snapshot = model.snapshot().expect("model snapshot barrier");
    let mut restored = GhosttyTerminalModel::decode_snapshot(&snapshot).expect("restore model");
    restored
        .feed(b"\x1b[999;999H\x1b[6n")
        .expect("query dimensions");
    restored.take_protocol_replies()
}
