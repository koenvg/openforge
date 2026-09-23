use openforge_session_client::{Client, EventSubscription};
use openforge_session_host::{PreparedCommand, SpawnRequest, TerminalOwner};
use openforge_session_protocol::{Error, Event, EventBatch};
use std::time::{Duration, Instant};

struct Fixture {
    root: tempfile::TempDir,
}
impl Fixture {
    fn launch() -> (Self, Client) {
        let root = tempfile::Builder::new()
            .prefix("of-subscribe-")
            .tempdir_in("/tmp")
            .unwrap();
        let client = Client::launch(
            std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            root.path(),
        )
        .unwrap();
        (Self { root }, client)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Ok(client) = Client::connect(self.root.path()) {
            for session in client.inventory().unwrap().sessions {
                let _ =
                    client.terminate(&format!("cleanup-{}", session.pty.instance), &session.pty);
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            while client.shutdown_empty().is_err() {
                assert!(Instant::now() < deadline, "fixture daemon did not stop");
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

fn next_within(subscription: &mut EventSubscription, limit: Duration) -> Result<EventBatch, Error> {
    let closer = subscription.closer().unwrap();
    let (done, finished) = std::sync::mpsc::channel::<()>();
    let watchdog = std::thread::spawn(move || {
        if finished.recv_timeout(limit).is_err() {
            closer.close();
        }
    });
    let result = subscription.recv();
    let _ = done.send(());
    watchdog.join().unwrap();
    result
}

fn shell(script: &str, cwd: &std::path::Path) -> SpawnRequest {
    SpawnRequest {
        owner: TerminalOwner::Shell {
            task_id: "subscribe".into(),
            index: Some(0),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            cwd: cwd.into(),
            env: Default::default(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }
}

#[test]
fn output_and_child_exit_are_pushed_to_a_subscriber() {
    let (fixture, client) = Fixture::launch();
    let mut subscription = client
        .subscribe(client.inventory().unwrap().cursor)
        .unwrap();
    assert!(next_within(&mut subscription, Duration::from_secs(5))
        .unwrap()
        .events
        .is_empty());
    let session = client
        .spawn(
            "spawn",
            &shell("printf 'PUSHED\\n'; exit 3", fixture.root.path()),
        )
        .unwrap();
    let mut output = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let code = loop {
        assert!(Instant::now() < deadline, "exit was not pushed");
        let batch = next_within(&mut subscription, Duration::from_secs(10)).unwrap();
        assert!(!batch.gap);
        let mut exited = None;
        for event in batch.events {
            match event {
                Event::Output { pty, data, .. } if pty == session.pty => output.extend(data),
                Event::Exited { pty, code } if pty == session.pty => exited = Some(code),
                _ => {}
            }
        }
        if let Some(code) = exited {
            break code;
        }
    };
    assert_eq!(code, 3);
    assert!(String::from_utf8_lossy(&output).contains("PUSHED"));
}

#[test]
fn a_new_controller_ends_older_subscriptions() {
    let (fixture, client) = Fixture::launch();
    let mut subscription = client
        .subscribe(client.inventory().unwrap().cursor)
        .unwrap();
    next_within(&mut subscription, Duration::from_secs(5)).unwrap();
    let _successor = Client::connect(fixture.root.path()).unwrap();
    assert!(matches!(
        next_within(&mut subscription, Duration::from_secs(5)),
        Err(Error::Transport(_))
    ));
    assert!(matches!(client.subscribe(0), Err(Error::StaleController)));
}
