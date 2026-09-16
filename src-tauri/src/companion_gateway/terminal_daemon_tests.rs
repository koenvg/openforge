use super::*;
use crate::pty_manager::PtyManager;
use crate::test_support::daemon::DaemonFixture;

fn manager(fixture: &DaemonFixture) -> PtyManager {
    let mut manager = PtyManager::new();
    manager.enable_daemon_pi(
        fixture.root.path().into(),
        fixture.executable.clone(),
        "KVG-3018".into(),
    );
    manager
}

async fn server(
    manager: PtyManager,
    access: Arc<CancellationAccess>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("consumer-contract".into()),
        Arc::new(BearerAuthorizer),
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board: Arc::new(UnavailableCompanionProjectBoardSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            task_actions: Arc::new(
                super::super::task_actions::UnavailableCompanionTaskActionService,
            ),
            action_palette: Arc::new(
                super::super::action_palette::UnavailableCompanionActionPaletteService,
            ),
            task_creator: Arc::new(super::super::task_creation::UnavailableCompanionTaskCreator),
            task_start: Arc::new(super::super::task_start::UnavailableCompanionTaskStarter),
            pty_manager: manager,
            events: crate::app_events::AppEventBus::new(16, 8),
            stream_access: access,
        },
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    (
        address,
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() }),
    )
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
    let (address, running) = server(first.clone(), access.clone()).await;
    let mut socket = connect_terminal(address).await;
    tokio::time::timeout(
        Duration::from_secs(5),
        attach_and_wait_until_ready(&mut socket),
    )
    .await
    .expect("ready deadline");
    socket
        .send(Message::Binary(b"before-replacement\n".to_vec()))
        .await
        .unwrap();
    output_until(&mut socket, "received:before-replacement").await;
    assert!(first.process_diagnostic_sessions().await.is_empty());

    access.cancel(CompanionStreamTermination::GatewayClosing);
    socket.close(None).await.ok();
    running.abort();
    drop(first);

    let second = manager(&fixture);
    let access = Arc::new(CancellationAccess::default());
    let (address, running) = server(second.clone(), access.clone()).await;
    let mut socket = connect_terminal(address).await;
    tokio::time::timeout(
        Duration::from_secs(5),
        attach_and_wait_until_ready(&mut socket),
    )
    .await
    .expect("replacement ready deadline");
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
    let _previous_access = access.sender.lock().unwrap().clone();
    let mut replaced = socket;
    let mut socket = connect_terminal(address).await;
    tokio::time::timeout(
        Duration::from_secs(5),
        attach_and_wait_until_ready(&mut socket),
    )
    .await
    .expect("replacement attachment deadline");
    let replaced_control = tokio::time::timeout(Duration::from_secs(5), replaced.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
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
    let control = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
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
    let mut exited = connect_terminal(address).await;
    exited
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.into(),
        ))
        .await
        .unwrap();
    let response = tokio::time::timeout(Duration::from_secs(5), exited.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(response, Message::Text(text) if text.contains("no_active_agent_terminal")));
    running.abort();
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
    let (address, running) = server(selected, Arc::new(CancellationAccess::default())).await;
    let mut request = format!("ws://{address}/companion/v1/tasks/{key}/agent-terminal")
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        axum::http::header::AUTHORIZATION,
        "Bearer paired-device-credential".parse().unwrap(),
    );
    request
        .headers_mut()
        .insert(PROTOCOL_VERSION_HEADER, current_protocol_version_header());
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.into(),
        ))
        .await
        .unwrap();
    let response = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(response, Message::Text(text) if text.contains("no_active_agent_terminal")));
    running.abort();
}
