use super::*;
use openforge_session_protocol::{PreparedCommand, TerminalOwner};

#[tokio::test]
#[ignore = "build the Session Daemon first; isolated daemon contract test"]
async fn daemon_input_refusal_and_reconnect_preserve_live_terminal_and_diagnostics() {
    let root = tempfile::Builder::new()
        .prefix("of-sidecar-retention-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let owner = TerminalOwner::Shell {
        task_id: "retention".into(),
        index: Some(0),
    };
    let key = owner.session_key();
    let bridge =
        DaemonShells::new(root.path().into(), executable.clone(), key.clone()).for_key(&key);
    let publisher = RuntimeEventPublisher::new(None, None);
    let instance = bridge
        .spawn(
            ShellCommand {
                owner,
                command: PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec![
                        "-c".into(),
                        "while IFS= read -r line; do printf 'received:%s\\n' \"$line\"; done"
                            .into(),
                    ],
                    env: Default::default(),
                    cwd: root.path().into(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
            publisher.clone(),
        )
        .await
        .unwrap();
    let (client, before) = bridge.session_client().await.unwrap().unwrap();
    let _cleanup = TestDaemonCleanup(root.path().to_path_buf());
    let oversized = vec![b'x'; openforge_session_host::MAX_REQUEST_BYTES + 1];
    let error = bridge
        .write(oversized, publisher.clone())
        .await
        .unwrap_err();
    assert!(error.contains("invalid session request"), "{error}");
    bridge
        .write(b"after-refusal\n".to_vec(), publisher.clone())
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let buffer = bridge.buffer(publisher.clone()).await.unwrap();
        assert!(buffer.is_live);
        assert_eq!(buffer.instance_id, Some(instance));
        let snapshot = buffer
            .snapshot
            .as_ref()
            .expect("live terminal supplies an authoritative snapshot");
        let replay = base64::engine::general_purpose::STANDARD
            .decode(&snapshot.compatibility_data)
            .unwrap();
        if String::from_utf8_lossy(&replay).contains("received:after-refusal") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "output did not continue after input refusal"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    client.flush_operation_receipts().unwrap();
    let diagnostics = bridge.inventory(publisher.clone()).await.unwrap();
    assert_eq!(diagnostics["capacity"]["operationReceipts"], 0);
    assert_eq!(diagnostics["capacity"]["retainedRequestBytes"], 0);
    assert!(
        diagnostics["capacity"]["operationWindow"]["retiredThrough"]
            .as_u64()
            .unwrap()
            >= 2
    );
    assert!(!diagnostics.to_string().contains("after-refusal"));
    let next = DaemonShells::new(root.path().into(), executable, key.clone()).for_key(&key);
    let (next_client, after) = next.session_client().await.unwrap().unwrap();
    assert_eq!(after.pty, before.pty);
    assert_eq!(after.pid, before.pid);
    assert!(bridge
        .write(b"stale-input\n".to_vec(), publisher.clone())
        .await
        .is_err());
    next.write(b"after-reconnect\n".to_vec(), publisher.clone())
        .await
        .unwrap();
    next.terminate(publisher).await.unwrap();
    next_client.shutdown_empty().unwrap();
}

struct TestDaemonCleanup(PathBuf);
impl Drop for TestDaemonCleanup {
    fn drop(&mut self) {
        // This root belongs exclusively to the test. Never discover production daemons.
        if let Ok(client) = Client::connect(&self.0) {
            if client.enable_operation_retirement().is_ok() {
                if let Ok(inventory) = client.inventory() {
                    for session in inventory.sessions {
                        if session.exit_code.is_none() {
                            let _ = client.terminate_ordered(&session.pty);
                        }
                    }
                }
            }
            let _ = client.shutdown_empty();
        }
    }
}
