use super::*;
use openforge_session_host::TerminalRgbColor;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

#[test]
fn host_checkpoint_preserves_journal_credentials_registration_and_retry_outcomes() {
    let root = tempfile::tempdir().unwrap();
    let installation = InstallationId::parse("checkpoint-installation").unwrap();
    let runtime = crate::agent_config::AgentRuntime {
        directory: root.path().into(),
        port: 1234,
    };
    let mut host = Host::new(installation.clone(), runtime.clone()).unwrap();
    let controller = connect(&mut host, installation.clone());
    let initial_profile = TerminalColorProfile {
        foreground: TerminalRgbColor::new(17, 34, 51),
        ..Default::default()
    };
    host.handle(Command::SetTerminalColorProfile {
        controller: controller.clone(),
        operation: OperationId::parse("profile-initial").unwrap(),
        profile: initial_profile,
    })
    .unwrap();
    let command = ShellCommand {
        owner: TerminalOwner::Shell { task_id: "checkpoint".into(), index: Some(3) },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf 'READY\\n'; while IFS= read -r value; do printf 'VALUE:%s\\n' \"$value\"; done".into()],
            cwd: root.path().into(), env: BTreeMap::new(),
        }, columns: 80, rows: 24, image_protocol: None,
    };
    let spawn = Command::Spawn {
        controller: controller.clone(),
        operation: OperationId::parse("spawn").unwrap(),
        command: command.clone(),
    };
    let Response::Spawned(session) = host.handle(spawn).unwrap() else {
        panic!("spawn response");
    };
    assert_eq!(
        host.backend.color_profiles().unwrap(),
        (
            initial_profile,
            vec![(session.pty.clone(), initial_profile)]
        )
    );
    let mut updated_profile = initial_profile;
    updated_profile.background = TerminalRgbColor::new(68, 85, 102);
    host.handle(Command::SetTerminalColorProfile {
        controller: controller.clone(),
        operation: OperationId::parse("profile-updated").unwrap(),
        profile: updated_profile,
    })
    .unwrap();
    assert_eq!(
        host.backend.color_profiles().unwrap(),
        (
            updated_profile,
            vec![(session.pty.clone(), updated_profile)]
        )
    );
    let input = Command::Io {
        controller: controller.clone(),
        operation: OperationId::parse("input").unwrap(),
        pty: session.pty.clone(),
        sequence: 1,
        action: IoAction::Write(b"original\n".to_vec()),
    };
    host.handle(input).unwrap();
    wait_for_text(&host, &session.pty, b"VALUE:original");
    host.handle(Command::RegisterSidecar {
        controller: controller.clone(),
        endpoint: Some(SidecarEndpoint {
            port: 4321,
            token: "a".repeat(64),
        }),
    })
    .unwrap();
    let credential_path = std::fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .unwrap();
    let credential = std::fs::read(&credential_path).unwrap();
    let (checkpoint, pause) = host.checkpoint().unwrap();
    let mut missing_backend = serde_json::to_value(&checkpoint).unwrap();
    missing_backend["backend"]["records"] = serde_json::json!([]);
    assert!(
        Host::restore(
            serde_json::from_value(missing_backend).unwrap(),
            installation.clone(),
            runtime.clone()
        )
        .is_err(),
        "ledger sessions must not lose their backend records"
    );
    let events = serde_json::to_value(lock(&host.backend.journal).events(0).unwrap()).unwrap();
    let checkpoint = serde_json::from_slice(&serde_json::to_vec(&checkpoint).unwrap()).unwrap();
    let mut restored = Host::restore(checkpoint, installation.clone(), runtime).unwrap();
    assert_eq!(
        restored.backend.color_profiles().unwrap(),
        (
            updated_profile,
            vec![(session.pty.clone(), updated_profile)]
        )
    );
    assert_eq!(
        serde_json::to_value(lock(&restored.backend.journal).events(0).unwrap()).unwrap(),
        events
    );
    assert!(restored
        .sidecar
        .read()
        .unwrap()
        .as_ref()
        .is_some_and(|endpoint| endpoint.port == 4321 && endpoint.token == "a".repeat(64)));
    assert!(matches!(
        restored.handle(Command::Inventory {
            controller: controller.clone()
        }),
        Err(Error::StaleController)
    ));
    let current = connect(&mut restored, installation);
    restored
        .handle(Command::SetTerminalColorProfile {
            controller: current.clone(),
            operation: OperationId::parse("profile-updated").unwrap(),
            profile: updated_profile,
        })
        .unwrap();
    let Response::Spawned(retried) = restored
        .handle(Command::Spawn {
            controller: current.clone(),
            operation: OperationId::parse("spawn").unwrap(),
            command,
        })
        .unwrap()
    else {
        panic!("spawn retry response");
    };
    assert_eq!(retried.pid, session.pid);
    assert_eq!(retried.pty, session.pty);
    assert_eq!(retried.next_io_sequence, Some(2));
    restored
        .handle(Command::Io {
            controller: current,
            operation: OperationId::parse("input").unwrap(),
            pty: session.pty.clone(),
            sequence: 1,
            action: IoAction::Write(b"original\n".to_vec()),
        })
        .unwrap();
    drop(restored);
    assert_eq!(std::fs::read(&credential_path).unwrap(), credential);
    drop(pause);
    host.handle(Command::Io {
        controller,
        operation: OperationId::parse("sentinel").unwrap(),
        pty: session.pty.clone(),
        sequence: 2,
        action: IoAction::Write(b"sentinel\n".to_vec()),
    })
    .unwrap();
    wait_for_text(&host, &session.pty, b"VALUE:sentinel");
    let snapshot = host.backend.recover(&session.pty, 0).unwrap();
    assert_eq!(
        snapshot
            .portable_vt
            .windows(b"VALUE:original".len())
            .filter(|window| *window == b"VALUE:original")
            .count(),
        1
    );
    let pid = session.pid;
    drop(host);
    // SAFETY: signal zero only queries the known test-owned child.
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn backend_checkpoint_without_a_profile_restores_the_light_fallback() {
    let root = tempfile::tempdir().unwrap();
    let installation = InstallationId::parse("old-profile-checkpoint").unwrap();
    let runtime = crate::agent_config::AgentRuntime {
        directory: root.path().into(),
        port: 1234,
    };
    let mut host = Host::new(installation.clone(), runtime.clone()).unwrap();
    connect(&mut host, installation.clone());
    let (checkpoint, pause) = host.checkpoint().unwrap();
    let mut value = serde_json::to_value(checkpoint).unwrap();
    value["backend"]
        .as_object_mut()
        .unwrap()
        .remove("color_profile");

    let restored = Host::restore(
        serde_json::from_value(value).unwrap(),
        installation,
        runtime,
    )
    .unwrap();
    assert_eq!(
        restored.backend.color_profiles().unwrap(),
        (TerminalColorProfile::default(), Vec::new())
    );
    drop(restored);
    drop(pause);
}
fn connect(host: &mut Host, installation: InstallationId) -> Controller {
    let Response::Inventory(inventory) = host.handle(Command::Connect { installation }).unwrap()
    else {
        panic!("connect response");
    };
    inventory.controller
}
fn wait_for_text(host: &Host, pty: &PtyIdentity, text: &[u8]) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !host.backend.recover(pty, 0).is_ok_and(|snapshot| {
        snapshot
            .portable_vt
            .windows(text.len())
            .any(|window| window == text)
    }) {
        assert!(
            Instant::now() < deadline,
            "test PTY did not produce expected text"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}
