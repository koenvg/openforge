use openforge_session_host::*;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Backend(Arc<Mutex<Resources>>);

#[derive(Default)]
struct Resources {
    next_instance: u64,
    sessions: Vec<BackendSession>,
    writes: usize,
    resizes: usize,
}

impl HostBackend for Backend {
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

    async fn set_terminal_color_profile(
        &self,
        _profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        Ok(())
    }

    async fn spawn_prepared(&self, request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        let mut resources = self.0.lock().unwrap();
        resources.next_instance += 1;
        let instance = PtyInstanceId::new(resources.next_instance).unwrap();
        resources.sessions.push(BackendSession {
            instance,
            session_key: request.owner.session_key(),
            state: HostedSessionState::Live,
        });
        Ok(instance)
    }

    async fn terminate_exact(&self, session: &HostedSession) -> Result<(), HostError> {
        let mut resources = self.0.lock().unwrap();
        resources
            .sessions
            .retain(|item| item.instance != session.pty.instance);
        Ok(())
    }

    async fn operate(&self, _: &HostedSession, action: &IoAction) -> Result<(), HostError> {
        let mut resources = self.0.lock().unwrap();
        match action {
            IoAction::Write(_) => resources.writes += 1,
            IoAction::Resize { .. } => resources.resizes += 1,
        }
        if matches!(action, IoAction::Write(bytes) if bytes == b"unknown") {
            return Err(HostError::OutcomeUnknown);
        }
        Ok(())
    }

    async fn attach(&self, _: &HostedSession) -> Result<BackendAttachment, HostError> {
        Err(HostError::RecoveryUnavailable)
    }
}

fn operation(ordinal: u64) -> OperationId {
    OperationId::ordered(1, ordinal).unwrap()
}

fn shell(index: u32) -> SpawnRequest {
    SpawnRequest {
        owner: TerminalOwner::Shell {
            task_id: "retention".into(),
            index: Some(index),
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

#[test]
fn acknowledging_terminal_color_profile_releases_retained_bytes() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::new()));
        let installation = InstallationId::parse("profile-retention").unwrap();
        let host = InProcessHost::new(Backend::default(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        host.set_terminal_color_profile(&controller, operation(1), TerminalColorProfile::default())
            .await
            .unwrap();

        assert_eq!(
            state.lock().await.capacity().retained_request_bytes,
            std::mem::size_of::<TerminalColorProfile>()
        );
        host.acknowledge_operations(&controller, 1, 1)
            .await
            .unwrap();
        assert_eq!(state.lock().await.capacity().retained_request_bytes, 0);
    });
}

#[test]
fn sustained_completed_input_and_resize_leave_room_for_a_new_terminal() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let limit = 8;
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                operations: limit,
                live_sessions: 4,
                retained_sessions: 4,
                ..HostLimits::default()
            },
        )));
        let backend = Backend::default();
        let installation = InstallationId::parse("retention-test").unwrap();
        let host = InProcessHost::new(backend.clone(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        let first = host
            .spawn(&controller, operation(1), shell(0))
            .await
            .unwrap();
        let second = host
            .spawn(&controller, operation(2), shell(1))
            .await
            .unwrap();
        host.acknowledge_operations(&controller, 1, 2)
            .await
            .unwrap();
        let mut ordinal = 3;
        for sequence in 1..=u64::try_from(limit * 11).unwrap() {
            for pty in [&first, &second] {
                let action = if sequence % 2 == 0 {
                    IoAction::Resize {
                        columns: 80,
                        rows: 24,
                    }
                } else {
                    IoAction::Write(b"x".to_vec())
                };
                let result = host
                    .io(
                        &controller,
                        operation(ordinal),
                        IoRequest {
                            pty: pty.clone(),
                            sequence,
                            action,
                        },
                    )
                    .await;
                assert_eq!(
                    result,
                    Ok(()),
                    "completed operation {ordinal} must not exhaust lifetime capacity"
                );
                host.acknowledge_operations(&controller, 1, ordinal)
                    .await
                    .unwrap();
                ordinal += 1;
            }
        }
        host.spawn(&controller, operation(ordinal), shell(2))
            .await
            .unwrap();
        assert_eq!(host.reconcile(&controller).await.unwrap().len(), 3);
        {
            let resources = backend.0.lock().unwrap();
            assert_eq!(resources.writes, limit * 11);
            assert_eq!(resources.resizes, limit * 11);
        }
        let capacity = state.lock().await.capacity();
        assert!(capacity.operations <= limit);
        assert!(capacity.retained_request_bytes <= capacity.limits.retained_request_bytes);
    });
}

#[test]
fn checkpoint_after_retirement_preserves_expiry_and_next_input_sequence() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::new()));
        let backend = Backend::default();
        let installation = InstallationId::parse("checkpoint-retirement").unwrap();
        let host = InProcessHost::new(backend.clone(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        let pty = host
            .spawn(&controller, operation(1), shell(0))
            .await
            .unwrap();
        host.io(
            &controller,
            operation(2),
            IoRequest {
                pty: pty.clone(),
                sequence: 1,
                action: IoAction::Write(b"once".to_vec()),
            },
        )
        .await
        .unwrap();
        host.acknowledge_operations(&controller, 1, 2)
            .await
            .unwrap();
        let checkpoint = state.lock().await.checkpoint().unwrap();
        let restored = Arc::new(tokio::sync::Mutex::new(
            HostState::restore_checkpoint(&checkpoint).unwrap(),
        ));
        let replacement = InProcessHost::new(backend.clone(), installation.clone(), restored);
        let connection = replacement.connect(&installation).await.unwrap();
        assert_eq!(connection.inventory[0].next_io_sequence, Some(2));
        assert_eq!(
            replacement
                .spawn(&connection.controller, operation(1), shell(0))
                .await,
            Err(HostError::OperationExpired)
        );
        replacement
            .io(
                &connection.controller,
                operation(3),
                IoRequest {
                    pty,
                    sequence: 2,
                    action: IoAction::Write(b"next".to_vec()),
                },
            )
            .await
            .unwrap();
        assert_eq!(backend.0.lock().unwrap().writes, 2);
    });
}

#[test]
fn retired_retries_conflicts_and_unknown_outcomes_never_execute_twice() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::new()));
        let backend = Backend::default();
        let installation = InstallationId::parse("safe-retry-retirement").unwrap();
        let host = InProcessHost::new(backend.clone(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        let pty = host
            .spawn(&controller, operation(1), shell(0))
            .await
            .unwrap();
        assert_eq!(
            host.spawn(&controller, operation(1), shell(0))
                .await
                .unwrap(),
            pty
        );
        assert_eq!(
            host.spawn(&controller, operation(1), shell(1)).await,
            Err(HostError::OperationConflict)
        );
        assert_eq!(
            host.acknowledge_operations(&controller, 1, 2).await,
            Err(HostError::OutOfOrder)
        );
        host.acknowledge_operations(&controller, 1, 1)
            .await
            .unwrap();
        host.acknowledge_operations(&controller, 1, 1)
            .await
            .unwrap();
        assert_eq!(
            host.spawn(&controller, operation(1), shell(0)).await,
            Err(HostError::OperationExpired)
        );
        let input = IoRequest {
            pty: pty.clone(),
            sequence: 1,
            action: IoAction::Write(b"unknown".to_vec()),
        };
        assert_eq!(
            host.io(&controller, operation(2), input.clone()).await,
            Err(HostError::OutcomeUnknown)
        );
        assert_eq!(
            host.io(&controller, operation(2), input).await,
            Err(HostError::OutcomeUnknown)
        );
        assert_eq!(
            host.acknowledge_operations(&controller, 1, 2).await,
            Err(HostError::OutcomeUnknown)
        );
        let checkpoint = state.lock().await.checkpoint().unwrap();
        let restored = HostState::restore_checkpoint(&checkpoint).unwrap();
        assert_eq!(restored.capacity().operations, 1);
        assert_eq!(backend.0.lock().unwrap().writes, 1);
        let next = host.connect(&installation).await.unwrap().controller;
        let window = host.open_operation_stream(&next).await.unwrap();
        assert_ne!(window.stream, 1);
        assert_eq!(
            host.spawn(&next, operation(2), shell(1)).await,
            Err(HostError::OperationExpired)
        );
        assert_eq!(
            host.acknowledge_operations(&controller, 1, 2).await,
            Err(HostError::StaleController)
        );
        assert_eq!(host.reconcile(&next).await.unwrap()[0].pty, pty);
    });
}

#[test]
fn completed_lifecycle_and_input_reclaim_count_and_byte_budgets() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                operations: 3,
                retained_request_bytes: 2048,
                exit_history: 1,
                retained_sessions: 3,
                ..HostLimits::default()
            },
        )));
        let backend = Backend::default();
        let installation = InstallationId::parse("lifecycle-retirement").unwrap();
        let host = InProcessHost::new(backend, installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        for round in 0..40 {
            let ordinal = round * 3 + 1;
            let pty = host
                .spawn(&controller, operation(ordinal), shell(0))
                .await
                .unwrap();
            host.acknowledge_operations(&controller, 1, ordinal)
                .await
                .unwrap();
            host.io(
                &controller,
                operation(ordinal + 1),
                IoRequest {
                    pty: pty.clone(),
                    sequence: 1,
                    action: IoAction::Write(vec![b'x'; 1024]),
                },
            )
            .await
            .unwrap();
            host.acknowledge_operations(&controller, 1, ordinal + 1)
                .await
                .unwrap();
            host.terminate(&controller, operation(ordinal + 2), &pty)
                .await
                .unwrap();
            host.acknowledge_operations(&controller, 1, ordinal + 2)
                .await
                .unwrap();
            let capacity = state.lock().await.capacity();
            assert_eq!(capacity.operations, 0);
            assert_eq!(capacity.retained_request_bytes, 0);
            state.lock().await.checkpoint().unwrap();
        }
    });
}

#[test]
fn full_window_reports_receipt_pressure_and_acknowledgement_restores_admission() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                operations: 1,
                ..HostLimits::default()
            },
        )));
        let installation = InstallationId::parse("capacity-reasons").unwrap();
        let host = InProcessHost::new(Backend::default(), installation.clone(), state);
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        host.spawn(&controller, operation(1), shell(0))
            .await
            .unwrap();
        let error = host
            .spawn(&controller, operation(2), shell(1))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("operation receipt"), "{error}");
        host.acknowledge_operations(&controller, 1, 1)
            .await
            .unwrap();
        host.spawn(&controller, operation(2), shell(1))
            .await
            .unwrap();
    });
}

#[test]
fn exhausted_legacy_checkpoint_can_be_fenced_without_replacing_live_ptys() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::with_limits(
            HostLimits {
                operations: 2,
                ..HostLimits::default()
            },
        )));
        let backend = Backend::default();
        let installation = InstallationId::parse("legacy-exhaustion").unwrap();
        let host = InProcessHost::new(backend.clone(), installation.clone(), Arc::clone(&state));
        let old = host.connect(&installation).await.unwrap().controller;
        let legacy_spawn = OperationId::parse("legacy-spawn").unwrap();
        let pty = host
            .spawn(&old, legacy_spawn.clone(), shell(0))
            .await
            .unwrap();
        host.io(
            &old,
            OperationId::parse("legacy-input").unwrap(),
            IoRequest {
                pty: pty.clone(),
                sequence: 1,
                action: IoAction::Write(b"before".to_vec()),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            host.spawn(&old, OperationId::parse("blocked").unwrap(), shell(1))
                .await,
            Err(HostError::Capacity)
        );
        let bytes = state.lock().await.checkpoint().unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            value.get("operationWindow").is_none(),
            "legacy checkpoint must retain its old shape"
        );
        let restored = Arc::new(tokio::sync::Mutex::new(
            HostState::restore_checkpoint(&bytes).unwrap(),
        ));
        let replacement = InProcessHost::new(backend.clone(), installation.clone(), restored);
        let next = replacement.connect(&installation).await.unwrap();
        assert_eq!(next.inventory[0].pty, pty);
        let window = replacement
            .open_operation_stream(&next.controller)
            .await
            .unwrap();
        assert_eq!(
            replacement
                .spawn(&next.controller, legacy_spawn, shell(0))
                .await,
            Err(HostError::OperationExpired)
        );
        replacement
            .io(
                &next.controller,
                OperationId::ordered(window.stream, 1).unwrap(),
                IoRequest {
                    pty,
                    sequence: 2,
                    action: IoAction::Write(b"after".to_vec()),
                },
            )
            .await
            .unwrap();
        assert_eq!(backend.0.lock().unwrap().writes, 2);
    });
}

#[test]
fn checkpoint_cannot_lose_or_rewind_the_retirement_boundary() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    let bytes = runtime.block_on(async {
        let state = Arc::new(tokio::sync::Mutex::new(HostState::new()));
        let installation = InstallationId::parse("checkpoint-window-validation").unwrap();
        let host = InProcessHost::new(Backend::default(), installation.clone(), Arc::clone(&state));
        let controller = host.connect(&installation).await.unwrap().controller;
        host.open_operation_stream(&controller).await.unwrap();
        host.spawn(&controller, operation(1), shell(0))
            .await
            .unwrap();
        host.acknowledge_operations(&controller, 1, 1)
            .await
            .unwrap();
        let bytes = state.lock().await.checkpoint().unwrap();
        bytes
    });
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let mut missing = value.clone();
    missing.as_object_mut().unwrap().remove("operationWindow");
    assert!(HostState::restore_checkpoint(&serde_json::to_vec(&missing).unwrap()).is_err());
    for (field, replacement) in [
        ("stream", 0),
        ("stream", 100),
        ("retiredThrough", 0),
        ("retiredThrough", 2),
        ("admittedThrough", 0),
        ("admittedThrough", 2),
    ] {
        let mut corrupt = value.clone();
        corrupt["operationWindow"][field] = serde_json::json!(replacement);
        assert!(
            HostState::restore_checkpoint(&serde_json::to_vec(&corrupt).unwrap()).is_err(),
            "accepted corrupt {field}"
        );
    }
}
