use crate::{
    app_events::RuntimeEventPublisher, db::acquire_db,
    github_runtime::task_pr_discovery::tests::support::Fixture,
    test_support::daemon::DaemonFixture,
};
use openforge_session_protocol::{PreparedCommand, ShellCommand, TerminalOwner};
use std::time::Duration;

#[tokio::test]
#[ignore = "build the Session Daemon first; run with OPENFORGE_TEST_DAEMON"]
async fn daemon_events_link_without_views_and_deliver_output_during_slow_github() {
    let f = Fixture::new(true, Some("test-token")).await;
    let daemon = DaemonFixture::new();
    let manager = daemon.shells();
    manager.configure_pr_discovery(f.discovery.clone());
    let owner = TerminalOwner::Shell {
        task_id: f.task_id.clone(),
        index: Some(0),
    };
    let key = owner.session_key();
    let bridge = manager.daemon_shells.as_ref().unwrap().for_key(&key);
    let mut events = f.bus.sender().subscribe();
    bridge.spawn(ShellCommand {
        owner,
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf 'https://github.com/acme/widgets/pull/4'; sleep 0.1; printf '2\\n'; while [ ! -e release-output ]; do sleep 0.01; done; printf 'AFTER_SLOW_REQUEST\\n'; while [ ! -e finish ]; do sleep 0.01; done".into()],
            cwd: f.dir.path().into(), env: std::collections::BTreeMap::new(),
        }, columns:80, rows:24, image_protocol:None,
    }, RuntimeEventPublisher::new(None, Some(f.bus.sender()))).await.unwrap();
    f.calls(1).await;
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
    std::fs::write(f.dir.path().join("release-output"), "go").unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        use base64::Engine;
        let mut bytes = Vec::new();
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name == format!("pty-model-output-{key}") {
                bytes.extend(
                    base64::engine::general_purpose::STANDARD
                        .decode(event.payload["data"].as_str().unwrap())
                        .unwrap(),
                );
                if String::from_utf8_lossy(&bytes).contains("AFTER_SLOW_REQUEST") {
                    break;
                }
            }
        }
    })
    .await
    .expect("GitHub must not hold the daemon transport lock or stall output");
    f.release_requests(1);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name == "task-pull-request-updated" {
                assert_eq!(event.payload["task_id"], f.task_id);
                break;
            }
        }
    })
    .await
    .expect("verified link notification without polling");
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
    std::fs::write(f.dir.path().join("finish"), "go").unwrap();
    drop(bridge);
    drop(manager);
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with OPENFORGE_TEST_DAEMON"]
async fn daemon_reconnect_ignores_recovered_history_but_links_new_live_output() {
    let f = Fixture::new(false, Some("test-token")).await;
    let daemon = DaemonFixture::new();
    let client = openforge_session_client::Client::connect(daemon.root.path()).unwrap();
    let owner = TerminalOwner::Agent {
        task_id: f.task_id.clone(),
    };
    let key = owner.session_key();
    client.spawn("while-app-absent", &ShellCommand {
        owner, command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf 'https://github.com/acme/widgets/pull/99\\nhttps://git'; touch history-ready; while [ ! -e live ]; do sleep 0.01; done; printf 'hub.com/acme/widgets/pull/44\\nhttps://github.com/acme/widgets/pull/43\\n'; while [ ! -e finish ]; do sleep 0.01; done".into()],
            cwd: f.dir.path().into(), env: std::collections::BTreeMap::new(),
        }, columns:80, rows:24, image_protocol:None,
    }).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !f.dir.path().join("history-ready").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let mut manager = crate::pty_manager::PtyManager::new();
    manager.enable_daemon_pi(
        daemon.root.path().into(),
        daemon.executable.clone(),
        key.clone(),
    );
    manager.configure_pr_discovery(f.discovery.clone());
    let bridge = manager.daemon_shells.as_ref().unwrap().for_key(&key);
    let mut events = f.bus.sender().subscribe();
    let snapshot = bridge
        .buffer(RuntimeEventPublisher::new(None, Some(f.bus.sender())))
        .await
        .unwrap();
    assert!(snapshot.snapshot.is_some());
    f.discovery.settled().await;
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
    std::fs::write(f.dir.path().join("live"), "go").unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if events.recv().await.unwrap().event_name == "task-pull-request-updated" {
                break;
            }
        }
    })
    .await
    .unwrap();
    f.discovery.settled().await;
    let prs = acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pr_number, 43);
    std::fs::write(f.dir.path().join("finish"), "go").unwrap();
    drop(bridge);
    drop(manager);
}

fn pty(instance: u64) -> openforge_session_host::PtyIdentity {
    openforge_session_host::PtyIdentity {
        installation: openforge_session_host::InstallationId::parse("install").unwrap(),
        lifetime: openforge_session_host::DaemonLifetimeId::parse("lifetime").unwrap(),
        instance: openforge_session_host::PtyInstanceId::new(instance).unwrap(),
    }
}

fn batch(
    gap: bool,
    events: Vec<openforge_session_protocol::Event>,
) -> openforge_session_protocol::EventBatch {
    openforge_session_protocol::EventBatch {
        cursor: 1,
        gap,
        retained_bytes: 0,
        events,
    }
}

#[test]
fn output_from_a_known_pty_does_not_refresh_inventory() {
    use openforge_session_protocol::Event;
    let known = std::collections::HashSet::from([pty(1)]);
    let output = Event::Output {
        pty: pty(1),
        sequence: 1,
        data: b"idle".to_vec(),
    };
    let recovery = Event::RecoveryRequired { pty: pty(1) };
    assert!(!super::changes_sessions(
        &known,
        &batch(false, vec![output, recovery])
    ));
}

#[test]
fn spawn_exit_or_gap_refreshes_inventory() {
    use openforge_session_protocol::Event;
    let known = std::collections::HashSet::from([pty(1)]);
    let spawned = Event::Output {
        pty: pty(2),
        sequence: 1,
        data: Vec::new(),
    };
    let exited = Event::Exited {
        pty: pty(1),
        code: 0,
    };
    assert!(super::changes_sessions(
        &known,
        &batch(false, vec![spawned])
    ));
    assert!(super::changes_sessions(&known, &batch(false, vec![exited])));
    assert!(super::changes_sessions(&known, &batch(true, Vec::new())));
}
