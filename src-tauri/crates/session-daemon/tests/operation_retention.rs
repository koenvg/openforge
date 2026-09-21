use openforge_session_client::Client;
use openforge_session_protocol::{PreparedCommand, ShellCommand, TerminalOwner};

fn shell(index: u32) -> ShellCommand {
    ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "operation-retention".into(),
            index: Some(index),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "exec cat".into()],
            env: Default::default(),
            cwd: "/tmp".into(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }
}

#[test]
fn sustained_managed_mutations_keep_daemon_capacity_available() {
    let root = tempfile::Builder::new()
        .prefix("of-operation-window-")
        .tempdir_in("/tmp")
        .unwrap();
    let client = Client::launch(
        std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
        root.path(),
    )
    .unwrap();
    client.enable_operation_retirement().unwrap();
    let first = client.spawn_ordered(&shell(0)).unwrap();
    let second = client.spawn_ordered(&shell(1)).unwrap();
    for sequence in 1..=5_200 {
        for session in [&first, &second] {
            if sequence % 2 == 0 {
                client
                    .resize_ordered(&session.pty, sequence, 80, 24)
                    .unwrap();
            } else {
                client
                    .write_ordered(&session.pty, sequence, b"x\n")
                    .unwrap();
            }
        }
    }
    let third = client.spawn_ordered(&shell(2)).unwrap();
    client.flush_operation_receipts().unwrap();
    let inventory = client.inventory().unwrap();
    assert_eq!(inventory.capacity.operation_receipts, 0);
    assert_eq!(inventory.capacity.retained_request_bytes, 0);
    assert_eq!(inventory.capacity.live_sessions, 3);
    assert!(inventory.capacity.operation_window.unwrap().retired_through > 10_240);
    for session in [&first, &second, &third] {
        client.terminate_ordered(&session.pty).unwrap();
    }
    client.flush_operation_receipts().unwrap();
    client.shutdown_empty().unwrap();
}

#[test]
fn rejected_requests_do_not_leave_ordinal_gaps_and_idle_receipts_are_retired() {
    let root = tempfile::Builder::new()
        .prefix("of-operation-rejections-")
        .tempdir_in("/tmp")
        .unwrap();
    let client = Client::launch(
        std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
        root.path(),
    )
    .unwrap();
    client.enable_operation_retirement().unwrap();
    let session = client.spawn_ordered(&shell(0)).unwrap();
    assert!(client.resize_ordered(&session.pty, 1, 0, 24).is_err());
    client
        .write_ordered(&session.pty, 1, b"after-refusal\n")
        .unwrap();
    assert!(client
        .write_ordered(&session.pty, 1, b"duplicate-sequence\n")
        .is_err());
    client
        .write_ordered(&session.pty, 2, b"after-order-refusal\n")
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while client.inventory().unwrap().capacity.operation_receipts != 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "idle acknowledgement did not retire receipts"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let next = Client::connect(root.path()).unwrap();
    next.enable_operation_retirement().unwrap();
    assert!(client.write_ordered(&session.pty, 3, b"stale\n").is_err());
    next.write_ordered(&session.pty, 3, b"new-controller\n")
        .unwrap();
    next.terminate_ordered(&session.pty).unwrap();
    next.flush_operation_receipts().unwrap();
    next.shutdown_empty().unwrap();
}
