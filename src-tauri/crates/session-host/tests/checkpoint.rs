use openforge_session_host::*;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Resources(Arc<Mutex<ResourceState>>);
#[derive(Default)]
struct ResourceState {
    sessions: Vec<BackendSession>,
    writes: Vec<Vec<u8>>,
    next: u64,
}
impl HostBackend for Resources {
    async fn set_terminal_color_profile(
        &self,
        _profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        Ok(())
    }

    async fn inventory(&self) -> Result<Vec<BackendSession>, HostError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .sessions
            .iter()
            .map(|session| BackendSession {
                instance: session.instance,
                session_key: session.session_key.clone(),
                state: session.state,
            })
            .collect())
    }
    async fn spawn_prepared(&self, request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        let mut resources = self.0.lock().unwrap();
        resources.next += 1;
        let instance = PtyInstanceId::new(resources.next).unwrap();
        resources.sessions.push(BackendSession {
            instance,
            session_key: request.owner.session_key(),
            state: HostedSessionState::Live,
        });
        Ok(instance)
    }
    async fn terminate_exact(&self, session: &HostedSession) -> Result<(), HostError> {
        for resource in &mut self.0.lock().unwrap().sessions {
            if resource.instance == session.pty.instance {
                resource.state = HostedSessionState::Exited;
            }
        }
        Ok(())
    }
    async fn operate(&self, _session: &HostedSession, action: &IoAction) -> Result<(), HostError> {
        if let IoAction::Write(bytes) = action {
            self.0.lock().unwrap().writes.push(bytes.clone());
            if bytes == b"unknown" {
                return Err(HostError::OutcomeUnknown);
            }
        }
        Ok(())
    }
    async fn attach(&self, _session: &HostedSession) -> Result<BackendAttachment, HostError> {
        Err(HostError::RecoveryUnavailable)
    }
}
fn request() -> SpawnRequest {
    SpawnRequest {
        owner: TerminalOwner::Shell {
            task_id: "checkpoint".into(),
            index: Some(0),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![],
            env: Default::default(),
            cwd: "/tmp".into(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }
}
fn operation(value: &str) -> OperationId {
    OperationId::parse(value).unwrap()
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap()
}

#[test]
fn corrupt_checkpoint_cannot_reset_receipts_counters_identity_or_capacity() {
    let bytes = runtime().block_on(async {
        let installation = InstallationId::parse("validated-installation").unwrap();
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                retained_sessions: 4,
                ..HostLimits::default()
            },
        )));
        let host = InProcessHost::new(
            Resources::default(),
            installation.clone(),
            Arc::clone(&state),
        );
        let controller = host.connect(&installation).await.unwrap().controller;
        let pty = host
            .spawn(&controller, operation("spawn"), request())
            .await
            .unwrap();
        host.io(
            &controller,
            operation("input"),
            IoRequest {
                pty,
                sequence: 1,
                action: IoAction::Write(b"retained".to_vec()),
            },
        )
        .await
        .unwrap();
        let bytes = state.lock().await.checkpoint().unwrap();
        bytes
    });
    let valid: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let mut cases = Vec::new();
    for field in ["sessions", "inputSequences", "operations"] {
        let mut duplicate = valid.clone();
        let rows = duplicate[field].as_array_mut().unwrap();
        rows.push(rows[0].clone());
        cases.push((format!("duplicate {field}"), duplicate));
    }
    for (path, value) in [
        ("/format", serde_json::json!(999)),
        ("/generation", serde_json::json!(0)),
        ("/generation", serde_json::json!(u64::MAX)),
        ("/generation", serde_json::json!(u64::MAX - 1)),
        ("/installation", serde_json::Value::Null),
        ("/retainedBytes", serde_json::json!(0)),
        ("/limits/operations", serde_json::json!(0)),
        ("/limits/retainedRequestBytes", serde_json::json!(0)),
        ("/sessions/0/pty/installation", serde_json::json!("foreign")),
        ("/sessions/0/pty/lifetime", serde_json::json!("foreign")),
        ("/sessions/0/next_io_sequence", serde_json::json!(1)),
        ("/inputSequences/0/1", serde_json::json!(0)),
    ] {
        let mut corrupt = valid.clone();
        *corrupt.pointer_mut(path).unwrap() = value;
        cases.push((path.into(), corrupt));
    }
    for (name, corrupt) in cases {
        assert!(
            HostState::restore_checkpoint(&serde_json::to_vec(&corrupt).unwrap()).is_err(),
            "accepted {name}"
        );
    }
    assert!(matches!(
        HostState::restore_checkpoint(&vec![b' '; MAX_HOST_CHECKPOINT_BYTES + 1]),
        Err(HostError::Capacity)
    ));
    assert!(
        HostState::restore_checkpoint(&bytes).is_ok(),
        "valid original remains usable"
    );
}

#[test]
fn restored_ledger_preserves_receipts_input_order_and_lifetime_while_fencing_old_controllers() {
    runtime().block_on(async {
        let installation = InstallationId::parse("checkpoint-installation").unwrap();
        let resources = Resources::default();
        let ledger = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                live_sessions: 2,
                retained_sessions: 4,
                exit_history: 4,
                ..HostLimits::default()
            },
        )));
        let host = InProcessHost::new(resources.clone(), installation.clone(), Arc::clone(&ledger));
        let old = host.connect(&installation).await.unwrap().controller;
        let pty = host
            .spawn(&old, operation("spawn"), request())
            .await
            .unwrap();
        let first = IoRequest {
            pty: pty.clone(),
            sequence: 1,
            action: IoAction::Write(b"once".to_vec()),
        };
        let uncertain = IoRequest {
            pty: pty.clone(),
            sequence: 2,
            action: IoAction::Write(b"unknown".to_vec()),
        };
        host.io(&old, operation("first"), first.clone())
            .await
            .unwrap();
        assert_eq!(
            host.io(&old, operation("uncertain"), uncertain.clone())
                .await,
            Err(HostError::OutcomeUnknown)
        );
        let bytes = ledger.lock().await.checkpoint().unwrap();
        let restored = HostState::restore_checkpoint(&bytes).unwrap();
        assert_eq!(restored.lifetime(), &pty.lifetime);
        let restored = Arc::new(tokio::sync::Mutex::new(restored));
        let resumed = InProcessHost::new(
            resources.clone(),
            installation.clone(),
            Arc::clone(&restored),
        );
        assert_eq!(
            resumed.reconcile(&old).await,
            Err(HostError::StaleController)
        );
        let current = resumed.connect(&installation).await.unwrap().controller;
        assert_eq!(
            resumed
                .spawn(&current, operation("spawn"), request())
                .await
                .unwrap(),
            pty
        );
        resumed
            .io(&current, operation("first"), first)
            .await
            .unwrap();
        assert_eq!(
            resumed
                .io(&current, operation("uncertain"), uncertain)
                .await,
            Err(HostError::OutcomeUnknown)
        );
        assert_eq!(
            resumed.reconcile(&current).await.unwrap()[0].next_io_sequence,
            Some(3)
        );
        assert_eq!(
            resumed
                .io(
                    &current,
                    operation("gap"),
                    IoRequest {
                        pty: pty.clone(),
                        sequence: 4,
                        action: IoAction::Write(b"gap".to_vec()),
                    }
                )
                .await,
            Err(HostError::OutOfOrder)
        );
        resumed
            .io(
                &current,
                operation("next"),
                IoRequest {
                    pty: pty.clone(),
                    sequence: 3,
                    action: IoAction::Write(b"next".to_vec()),
                },
            )
            .await
            .unwrap();
        let mut conflict = request();
        conflict.columns = 100;
        assert_eq!(
            resumed.spawn(&current, operation("spawn"), conflict).await,
            Err(HostError::OperationConflict)
        );
        assert_eq!(resources.0.lock().unwrap().next, 1);
        assert_eq!(
            resources.0.lock().unwrap().writes,
            [b"once".to_vec(), b"unknown".to_vec(), b"next".to_vec()]
        );
        let second = restored.lock().await.checkpoint().unwrap();
        let twice = HostState::restore_checkpoint(&second).unwrap();
        assert_eq!(twice.lifetime(), &pty.lifetime);
        assert_eq!(twice.capacity().operations, 4);
    });
}

#[test]
fn spawn_reconciles_settled_exits_before_admission_without_a_client_inventory() {
    runtime().block_on(async {
        let installation = InstallationId::parse("reconcile-before-spawn").unwrap();
        let resources = Resources::default();
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                live_sessions: 3,
                retained_sessions: 4,
                exit_history: 2,
                ..HostLimits::default()
            },
        )));
        let host = InProcessHost::new(resources.clone(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        let mut first = None;
        for index in 0..3 {
            let mut next = request();
            next.owner = TerminalOwner::Shell {
                task_id: "capacity".into(),
                index: Some(index),
            };
            let pty = host
                .spawn(&controller, operation(&format!("spawn-{index}")), next)
                .await
                .unwrap();
            first.get_or_insert(pty);
        }
        resources.0.lock().unwrap().sessions[0].state = HostedSessionState::Exited;
        let mut next = request();
        next.owner = TerminalOwner::Shell {
            task_id: "capacity".into(),
            index: Some(3),
        };
        let pty = host
            .spawn(&controller, operation("spawn-3"), next)
            .await
            .unwrap();
        assert_ne!(pty, first.unwrap());
        assert_eq!(resources.0.lock().unwrap().next, 4);
    });
}

#[test]
fn retained_history_and_live_refusals_have_distinct_reasons() {
    runtime().block_on(async {
        let installation = InstallationId::parse("history-diagnostic").unwrap();
        let resources = Resources::default();
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                live_sessions: 2,
                retained_sessions: 1,
                exit_history: 1,
                ..HostLimits::default()
            },
        )));
        let host = InProcessHost::new(resources.clone(), installation.clone(), state);
        let controller = host.connect(&installation).await.unwrap().controller;
        let window = host.open_operation_stream(&controller).await.unwrap();
        host.spawn(
            &controller,
            OperationId::ordered(window.stream, 1).unwrap(),
            request(),
        )
        .await
        .unwrap();
        resources.0.lock().unwrap().sessions[0].state = HostedSessionState::Exited;
        let mut second = request();
        second.owner = TerminalOwner::Shell {
            task_id: "history".into(),
            index: Some(1),
        };
        assert_eq!(
            host.spawn(
                &controller,
                OperationId::ordered(window.stream, 2).unwrap(),
                second
            )
            .await,
            Err(HostError::CapacityExceeded(CapacityKind::RetainedHistory)),
        );
    });
}

#[test]
fn validated_legacy_checkpoint_can_expand_limits_without_changing_identity_or_receipts() {
    let (saved, pty) = runtime().block_on(async {
        let installation = InstallationId::parse("legacy-capacity").unwrap();
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                live_sessions: 32,
                retained_sessions: 128,
                exit_history: 128,
                cleanup_reserve: 32,
                ..HostLimits::default()
            },
        )));
        let host = InProcessHost::new(
            Resources::default(),
            installation.clone(),
            Arc::clone(&state),
        );
        let controller = host.connect(&installation).await.unwrap().controller;
        let pty = host
            .spawn(&controller, operation("legacy-spawn"), request())
            .await
            .unwrap();
        let bytes = state.lock().await.checkpoint().unwrap();
        (bytes, pty)
    });
    let mut restored = HostState::restore_checkpoint(&saved).unwrap();
    assert_eq!(restored.capacity().limits.live_sessions, 32);
    restored.expand_session_limits(896, 1024, 128, 128).unwrap();
    assert_eq!(restored.capacity().limits.live_sessions, 896);
    assert_eq!(restored.capacity().limits.retained_sessions, 1024);
    assert_eq!(restored.capacity().limits.cleanup_reserve, 128);
    assert_eq!(restored.retained_sessions().next().unwrap().pty, pty);
    assert_eq!(
        restored.expand_session_limits(32, 128, 128, 32),
        Err(HostError::UnsupportedReplacement)
    );
    let roundtrip = HostState::restore_checkpoint(&restored.checkpoint().unwrap()).unwrap();
    assert_eq!(roundtrip.retained_sessions().next().unwrap().pty, pty);
    assert_eq!(roundtrip.capacity().operations, 1);
}
