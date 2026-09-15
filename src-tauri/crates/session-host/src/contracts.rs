use super::*;
use std::path::Path;

pub(super) fn operation(id: &str) -> OperationId {
    OperationId::parse(id).unwrap()
}
pub fn shell(cwd: &Path) -> SpawnRequest {
    SpawnRequest {
        owner: TerminalOwner::Shell { task_id: "host-contract".into(), index: Some(0) },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "stty -echo; printf 'host-ready\\n'; while IFS= read -r line; do if [ \"$line\" = size ]; then stty size; else printf 'host:%s\\n' \"$line\"; fi; done".into()],
            env: Default::default(),
            cwd: cwd.into(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }
}

pub async fn spawn_retry_contract(host: &impl PtyHost, installation: &InstallationId, cwd: &Path) {
    let connected = host.connect(installation).await.unwrap();
    assert!(connected.inventory.is_empty());
    assert!(!connected.supports_replacement);
    let request = shell(cwd);
    let first = host
        .spawn(&connected.controller, operation("spawn-1"), request.clone())
        .await
        .unwrap();
    let retry = host
        .spawn(&connected.controller, operation("spawn-1"), request.clone())
        .await
        .unwrap();
    assert_eq!(first, retry);
    let inventory = host.reconcile(&connected.controller).await.unwrap();
    assert_eq!(inventory.len(), 1);
    assert_eq!(inventory[0].pty, first);
    assert_eq!(inventory[0].state, HostedSessionState::Live);
    let mut conflict = request;
    conflict.columns = 100;
    assert_eq!(
        host.spawn(&connected.controller, operation("spawn-1"), conflict)
            .await,
        Err(HostError::OperationConflict)
    );
    host.terminate(&connected.controller, operation("stop-1"), &first)
        .await
        .unwrap();
    assert_eq!(
        host.reconcile(&connected.controller).await.unwrap()[0].state,
        HostedSessionState::Exited
    );
    // Losing the original spawn reply, even through termination, cannot launch another child.
    assert_eq!(
        host.spawn(&connected.controller, operation("spawn-1"), shell(cwd))
            .await
            .unwrap(),
        first
    );
}
pub async fn ordered_io_contract(host: &impl PtyHost, installation: &InstallationId, cwd: &Path) {
    let first = host.connect(installation).await.unwrap();
    let pty = host
        .spawn(&first.controller, operation("spawn-io"), shell(cwd))
        .await
        .unwrap();
    let mut attachment = host
        .attach_recover(&first.controller, &pty, None)
        .await
        .unwrap();
    assert_eq!(attachment.position.pty, pty);
    let connected = host.connect(installation).await.unwrap();
    assert_eq!(connected.inventory[0].pty, pty);
    assert_eq!(
        host.reconcile(&first.controller).await,
        Err(HostError::StaleController)
    );
    assert_eq!(attachment.recv().await, Err(HostError::StaleController));
    let mut attachment = host
        .attach_recover(&connected.controller, &pty, None)
        .await
        .unwrap();
    let input = IoRequest {
        pty: pty.clone(),
        sequence: 1,
        action: IoAction::Write(b"one\n".to_vec()),
    };
    host.io(&connected.controller, operation("input-1"), input.clone())
        .await
        .unwrap();
    host.io(&connected.controller, operation("input-1"), input)
        .await
        .unwrap();
    assert_eq!(
        host.io(
            &connected.controller,
            operation("input-gap"),
            IoRequest {
                pty: pty.clone(),
                sequence: 3,
                action: IoAction::Write(b"lost\n".to_vec()),
            }
        )
        .await,
        Err(HostError::OutOfOrder)
    );
    host.io(
        &connected.controller,
        operation("input-2"),
        IoRequest {
            pty: pty.clone(),
            sequence: 2,
            action: IoAction::Write(b"two\n".to_vec()),
        },
    )
    .await
    .unwrap();
    let mut output = Vec::new();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match attachment.recv().await.unwrap() {
                HostOutput::Output { data, .. } => output.extend(data),
                HostOutput::RecoveryRequired => {
                    attachment = host
                        .attach_recover(&connected.controller, &pty, None)
                        .await
                        .unwrap();
                    output = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        &attachment.snapshot.compatibility_data,
                    )
                    .unwrap();
                }
                other => panic!("unexpected terminal event: {other:?}"),
            }
            if String::from_utf8_lossy(&output).contains("host:two") {
                break;
            }
        }
    })
    .await
    .unwrap();
    let output = String::from_utf8_lossy(&output);
    assert_eq!(output.matches("host:one").count(), 1);
    assert_eq!(output.matches("host:two").count(), 1);
    assert!(output.find("host:one").unwrap() < output.find("host:two").unwrap());
    let mut foreign = pty.clone();
    foreign.lifetime = DaemonLifetimeId::parse("another-lifetime").unwrap();
    assert!(matches!(
        host.attach_recover(&connected.controller, &foreign, None)
            .await,
        Err(HostError::StalePty)
    ));
    assert!(matches!(
        host.attach_recover(
            &connected.controller,
            &pty,
            Some(OutputPosition {
                pty: foreign,
                sequence: 0
            })
        )
        .await,
        Err(HostError::StaleOutput)
    ));
    for phase in [
        ReplacementPhase::Prepare { executable: "/nonexistent/session-daemon".into() },
        ReplacementPhase::Commit,
        ReplacementPhase::Abort,
    ] {
        assert_eq!(
            host.replacement(&connected.controller, operation("replace-1"), phase)
                .await,
            Err(HostError::UnsupportedReplacement)
        );
    }
    assert_eq!(
        host.reconcile(&connected.controller).await.unwrap()[0].state,
        HostedSessionState::Live
    );
    host.terminate(&connected.controller, operation("stop-io"), &pty)
        .await
        .unwrap();
}
