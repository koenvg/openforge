use super::super::{
    live_events::CompanionStreamTermination,
    terminal_test_fixture::{
        attach_and_wait_until_ready, next_frame, send_attach, AuthenticatedTerminalServer,
        CancellationAccess, TestTerminalSocket,
    },
};
use crate::pty_manager::PtyManager;
use crate::test_support::daemon::DaemonFixture;
use futures::{SinkExt, StreamExt};
use std::{sync::Arc, time::Duration};
use tokio_tungstenite::tungstenite::Message;

fn manager(fixture: &DaemonFixture) -> PtyManager {
    let mut manager = PtyManager::new();
    manager.enable_daemon_pi(
        fixture.root.path().into(),
        fixture.executable.clone(),
        "KVG-3018".into(),
    );
    manager
}

async fn output_until(socket: &mut TestTerminalSocket, expected: &str) -> String {
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut output = String::new();
        loop {
            match socket.next().await.expect("open socket").expect("frame") {
                Message::Binary(bytes) => output.push_str(std::str::from_utf8(&bytes).unwrap()),
                Message::Text(control) => assert!(!control.contains("error"), "{control}"),
                frame => panic!("unexpected frame {frame:?}"),
            }
            if output.contains(expected) {
                return output;
            }
        }
    })
    .await
    .expect("terminal output deadline")
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn companion_reconnects_to_same_daemon_agent_after_backend_replacement() {
    let fixture = DaemonFixture::new();
    let first = manager(&fixture);
    let bridge = first.daemon_shells.as_ref().unwrap().for_key("KVG-3018");
    let instance = bridge.spawn(openforge_session_protocol::ShellCommand {
        owner: openforge_session_protocol::TerminalOwner::Agent { task_id: "KVG-3018".into() },
        command: openforge_session_protocol::PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "stty -echo; while IFS= read -r line; do case \"$line\" in size) stty size;; image) printf '\\033]1337;File=inline=1:SECRET_IMAGE\\007';; *) printf 'received:%s\\n' \"$line\";; esac; done".into()],
            cwd: fixture.root.path().into(),
            env: [("PATH".into(), "/usr/bin:/bin".into()), ("TERM".into(), "xterm-256color".into())].into(),
        },
        columns: 80, rows: 24, image_protocol: None,
    }, crate::app_events::RuntimeEventPublisher::new(None, None)).await.unwrap();
    let before = bridge.session().await.unwrap().unwrap();
    let access = Arc::new(CancellationAccess::default());
    let server = AuthenticatedTerminalServer::start_with_pty(first.clone(), access.clone()).await;
    let mut socket = server.connect().await;
    attach_and_wait_until_ready(&mut socket).await;
    socket
        .send(Message::Binary(b"before-replacement\n".to_vec()))
        .await
        .unwrap();
    output_until(&mut socket, "received:before-replacement").await;
    assert!(first.process_diagnostic_sessions().await.is_empty());

    access.cancel(CompanionStreamTermination::GatewayClosing);
    socket.close(None).await.ok();
    server.shutdown().await;
    drop(first);

    let second = manager(&fixture);
    let access = Arc::new(CancellationAccess::default());
    let server = AuthenticatedTerminalServer::start_with_pty(second.clone(), access.clone()).await;
    let mut socket = server.connect().await;
    attach_and_wait_until_ready(&mut socket).await;
    let current = second
        .daemon_shells
        .as_ref()
        .unwrap()
        .for_key("KVG-3018")
        .session()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.pty.instance.value(), instance);
    assert_eq!(current.pid, before.pid);
    assert!(bridge
        .write(b"stale\n".to_vec(), bridge.publisher())
        .await
        .is_err());
    // This fixture stores only the newest cancellation sender. Keep the first
    // channel alive so the registry, not a dropped test sender, replaces it.
    let _previous_access = access.current_sender();
    let mut replaced = socket;
    let mut socket = server.connect().await;
    attach_and_wait_until_ready(&mut socket).await;
    let replaced_control = next_frame(&mut replaced, "replaced attachment control").await;
    assert!(
        matches!(replaced_control, Message::Text(text) if text.contains("attachment_replaced"))
    );
    socket
        .send(Message::Text(
            r#"{"type":"resize","columns":100,"rows":30}"#.into(),
        ))
        .await
        .unwrap();
    let _ = replaced
        .send(Message::Text(
            r#"{"type":"resize","columns":120,"rows":40}"#.into(),
        ))
        .await;
    let _ = replaced
        .send(Message::Binary(b"stale-input\n".to_vec()))
        .await;
    socket
        .send(Message::Binary(b"size\n".to_vec()))
        .await
        .unwrap();
    output_until(&mut socket, "30 100").await;
    socket
        .send(Message::Binary(b"after-replacement\n".to_vec()))
        .await
        .unwrap();
    output_until(&mut socket, "received:after-replacement").await;
    socket
        .send(Message::Binary(b"image\n".to_vec()))
        .await
        .unwrap();
    let image = output_until(&mut socket, "[Image unavailable on mobile]").await;
    assert!(!image.contains("SECRET_IMAGE"));
    access.cancel(CompanionStreamTermination::AuthorizationRevoked);
    let control = next_frame(&mut socket, "authorization revocation control").await;
    assert!(matches!(control, Message::Text(text) if text.contains("authorization_revoked")));
    assert!(second
        .daemon_shells
        .as_ref()
        .unwrap()
        .for_key("KVG-3018")
        .session()
        .await
        .unwrap()
        .unwrap()
        .exit_code
        .is_none());
    let bridge = second.daemon_shells.as_ref().unwrap().for_key("KVG-3018");
    bridge.terminate(bridge.publisher()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while bridge.session().await.unwrap().unwrap().exit_code.is_none() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let mut exited = server.connect().await;
    send_attach(&mut exited).await;
    let response = next_frame(&mut exited, "exited terminal response").await;
    assert!(matches!(response, Message::Text(text) if text.contains("no_active_agent_terminal")));
    server.shutdown().await;
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn companion_never_attaches_to_a_shell_even_when_its_key_is_selected_as_an_agent() {
    let fixture = DaemonFixture::new();
    let shells = fixture.shells();
    let key = "KVG-3018-shell-0";
    let bridge = shells.daemon_shells.as_ref().unwrap().for_key(key);
    let command = bridge
        .prepare_shell(fixture.root.path().into(), 80, 24, None)
        .unwrap();
    bridge.spawn(command, bridge.publisher()).await.unwrap();
    let mut selected = PtyManager::new();
    selected.enable_daemon_pi(
        fixture.root.path().into(),
        fixture.executable.clone(),
        key.into(),
    );
    let server = AuthenticatedTerminalServer::start_with_pty(
        selected,
        Arc::new(CancellationAccess::default()),
    )
    .await;
    let mut socket = server.connect_task(key).await;
    send_attach(&mut socket).await;
    let response = next_frame(&mut socket, "shell terminal response").await;
    assert!(matches!(response, Message::Text(text) if text.contains("no_active_agent_terminal")));
    server.shutdown().await;
}
