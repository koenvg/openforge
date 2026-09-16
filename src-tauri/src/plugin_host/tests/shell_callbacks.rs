use super::*;
use crate::test_support::daemon::DaemonFixture;
use serde_json::json;

fn host(manager: crate::pty_manager::PtyManager) -> PluginHost {
    let app = AppHandle::new();
    app.manage(manager);
    PluginHost::new(app)
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn plugin_shell_uses_shared_daemon_and_reattaches_without_a_second_owner() {
    let fixture = DaemonFixture::new();
    let manager = fixture.shells();
    let first = host(manager.clone());
    let request = json!({
        "taskId": "project-P-plugin", "terminalIndex": 2,
        "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    });
    let instance = first
        .handle_host_callback("openforge.shell.spawn", &request)
        .await
        .unwrap();
    let inventory = manager
        .daemon_shells
        .as_ref()
        .unwrap()
        .inventory(crate::app_events::RuntimeEventPublisher::new(None, None))
        .await
        .unwrap();
    // Clean up the legacy process too on a failing pre-migration run.
    if inventory["sessions"].as_array().unwrap().is_empty() {
        manager.kill_pty("project-P-plugin-shell-2").await.unwrap();
    }
    assert_eq!(
        inventory["sessions"],
        json!([{
            "key": "project-P-plugin-shell-2", "instanceId": instance, "isLive": true,
        }])
    );
    assert!(
        manager.process_diagnostic_sessions().await.is_empty(),
        "plugin must not own a local PTY"
    );
    drop(first);
    drop(manager);

    let second = host(fixture.shells());
    let buffer = second
        .handle_host_callback("openforge.shell.getBuffer", &request)
        .await
        .unwrap();
    assert_eq!(buffer["instanceId"], instance);
    assert_eq!(buffer["isLive"], true);
    assert_eq!(
        second
            .handle_host_callback("openforge.shell.spawn", &request)
            .await
            .unwrap(),
        instance
    );
    let mut bound = request;
    bound["instanceId"] = instance;
    second
        .handle_host_callback("openforge.shell.kill", &bound)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn plugin_shell_rejects_unbound_and_stale_mutations() {
    let fixture = DaemonFixture::new();
    let first = host(fixture.shells());
    let request = json!({ "taskId": "plugin", "terminalIndex": 0, "cwd": fixture.root.path(), "cols": 80, "rows": 24 });
    let instance = first
        .handle_host_callback("openforge.shell.spawn", &request)
        .await
        .unwrap();
    for method in [
        "openforge.shell.write",
        "openforge.shell.resize",
        "openforge.shell.kill",
    ] {
        let mut stale = request.clone();
        stale["data"] = json!("must-not-arrive\n");
        assert!(
            first.handle_host_callback(method, &stale).await.is_err(),
            "unbound {method}"
        );
        stale["instanceId"] = json!(instance.as_u64().unwrap() + 1);
        assert!(
            first.handle_host_callback(method, &stale).await.is_err(),
            "stale {method}"
        );
    }
    let second = host(fixture.shells());
    let buffer = second
        .handle_host_callback("openforge.shell.getBuffer", &request)
        .await
        .unwrap();
    assert_eq!(buffer["instanceId"], instance);
    let mut bound = request;
    bound["instanceId"] = instance;
    bound["data"] = json!("must-not-arrive\n");
    for method in [
        "openforge.shell.write",
        "openforge.shell.resize",
        "openforge.shell.kill",
    ] {
        assert!(
            first.handle_host_callback(method, &bound).await.is_err(),
            "old controller {method}"
        );
    }
    second
        .handle_host_callback("openforge.shell.kill", &bound)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn plugin_shell_callbacks_cannot_control_an_agent_with_a_colliding_key() {
    let fixture = DaemonFixture::new();
    let manager = fixture.shells();
    let bridge = manager
        .daemon_shells
        .as_ref()
        .unwrap()
        .for_key("plugin-shell-0");
    let mut command = bridge
        .prepare_shell(fixture.root.path().into(), 80, 24, None)
        .unwrap();
    command.owner = openforge_session_protocol::TerminalOwner::Agent {
        task_id: "plugin-shell-0".into(),
    };
    let instance = bridge.spawn(command, bridge.publisher()).await.unwrap();
    let host = host(manager);
    let request = json!({ "taskId": "plugin", "terminalIndex": 0, "instanceId": instance,
        "cwd": fixture.root.path(), "data": "must-not-arrive\n", "cols": 80, "rows": 24 });
    for method in [
        "openforge.shell.spawn",
        "openforge.shell.getBuffer",
        "openforge.shell.write",
        "openforge.shell.resize",
        "openforge.shell.kill",
    ] {
        assert!(
            host.handle_host_callback(method, &request).await.is_err(),
            "agent exposed through {method}"
        );
    }
}

#[tokio::test]
#[ignore = "requires built Session Daemon; consumer contract"]
async fn plugin_shell_delivers_output_input_geometry_and_scoped_stop() {
    use base64::Engine;
    let fixture = DaemonFixture::new();
    let app = AppHandle::new();
    app.manage(fixture.shells());
    let (sender, mut events) = tokio::sync::broadcast::channel(256);
    let host = PluginHost::with_app_event_sender(app, Some(sender));
    let mut request = json!({ "taskId": "plugin-io", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24 });
    request["instanceId"] = host
        .handle_host_callback("openforge.shell.spawn", &request)
        .await
        .unwrap();
    request["cols"] = json!(101);
    request["rows"] = json!(29);
    host.handle_host_callback("openforge.shell.resize", &request)
        .await
        .unwrap();
    request["data"] = json!("stty -echo; printf 'daemon-%s\\n' reply; stty size\n");
    host.handle_host_callback("openforge.shell.write", &request)
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut output = String::new();
        while !output.contains("daemon-reply") || !output.contains("29 101") {
            let event = events.recv().await.unwrap();
            if event.event_name != "pty-model-output-plugin-io-shell-3" {
                continue;
            }
            assert_eq!(event.payload["instance_id"], request["instanceId"]);
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(event.payload["data"].as_str().unwrap())
                .unwrap();
            output.push_str(&String::from_utf8_lossy(&bytes));
        }
    })
    .await
    .expect("plugin output deadline");
    let buffer = host
        .handle_host_callback("openforge.shell.getBuffer", &request)
        .await
        .unwrap();
    assert_eq!(buffer["isLive"], true);
    let replay = base64::engine::general_purpose::STANDARD
        .decode(buffer["snapshot"]["data"].as_str().unwrap())
        .unwrap();
    assert!(String::from_utf8_lossy(&replay).contains("daemon-reply"));
    host.handle_host_callback("openforge.shell.kill", &request)
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name == "pty-exit-plugin-io-shell-3" {
                assert_eq!(event.payload["instance_id"], request["instanceId"]);
                break;
            }
        }
    })
    .await
    .expect("plugin exit deadline");
    let buffer = host
        .handle_host_callback("openforge.shell.getBuffer", &request)
        .await
        .unwrap();
    assert_eq!(buffer["isLive"], false);
}
