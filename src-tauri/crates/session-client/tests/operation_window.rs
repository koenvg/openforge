use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_host::{
    ControllerGeneration, DaemonLifetimeId, OperationWindow, PtyInstanceId,
};
use openforge_session_protocol::*;
use std::{
    os::unix::{fs::PermissionsExt, net::UnixListener},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

#[derive(Default)]
struct Observed {
    operations: Mutex<Vec<OperationId>>,
    drop_input_reply: AtomicBool,
    corrupt_input_reply: AtomicBool,
    wrong_input_reply: AtomicBool,
    drop_ack_reply: AtomicBool,
    acknowledgements: AtomicUsize,
    retired: AtomicUsize,
    stop: AtomicBool,
}

struct Server {
    _root: tempfile::TempDir,
    observed: Arc<Observed>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    fn start() -> (Self, Client, PtyIdentity) {
        let root = tempfile::Builder::new()
            .prefix("of-client-window-")
            .tempdir_in("/tmp")
            .unwrap();
        let runtime = RuntimeDirectory::open(root.path()).unwrap();
        let listener = UnixListener::bind(runtime.socket_path()).unwrap();
        std::fs::set_permissions(
            runtime.socket_path(),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        listener.set_nonblocking(true).unwrap();
        let controller = Controller {
            installation: runtime.credentials().installation.clone(),
            lifetime: DaemonLifetimeId::parse("test-lifetime").unwrap(),
            generation: ControllerGeneration::new(1).unwrap(),
        };
        let pty = PtyIdentity {
            installation: controller.installation.clone(),
            lifetime: controller.lifetime.clone(),
            instance: PtyInstanceId::new(1).unwrap(),
        };
        let observed = Arc::new(Observed::default());
        let state = Arc::clone(&observed);
        let identity = pty.clone();
        let thread = std::thread::spawn(move || {
            let mut window = OperationWindow {
                stream: 1,
                admitted_through: 0,
                retired_through: 0,
            };
            while !state.stop.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(1));
                        continue;
                    }
                    Err(error) => panic!("accept: {error}"),
                };
                // macOS may inherit the listener's nonblocking flag on accepted sockets.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let request: Request = read_frame(&mut stream).unwrap();
                let response = match request.command {
                    Command::Connect { .. } | Command::Inventory { .. } => {
                        Response::Inventory(Inventory {
                            controller: controller.clone(),
                            cursor: 0,
                            sessions: vec![],
                            capacity: Capacity {
                                operation_window: Some(window),
                                operation_receipts: usize::try_from(
                                    window.admitted_through - window.retired_through,
                                )
                                .unwrap(),
                                operation_limit: 1024,
                                cleanup_receipts: 0,
                                cleanup_limit: 1024,
                                retained_request_bytes: 0,
                                request_byte_limit: 4 * 1024 * 1024,
                                live_sessions: 1,
                                live_limit: 1024,
                                retained_sessions: 1,
                                session_limit: 1024,
                            },
                        })
                    }
                    Command::OpenOperationStream { .. } => Response::OperationWindow(window),
                    Command::Io { operation, .. } => {
                        state.operations.lock().unwrap().push(operation);
                        window.admitted_through += 1;
                        if state.drop_input_reply.swap(false, Ordering::SeqCst) {
                            continue;
                        }
                        if state.corrupt_input_reply.swap(false, Ordering::SeqCst) {
                            let _ = write_frame(
                                &mut stream,
                                &Envelope {
                                    version: VERSION,
                                    body: "not a result",
                                },
                            );
                            continue;
                        }
                        if state.wrong_input_reply.swap(false, Ordering::SeqCst) {
                            let _ = write_frame(
                                &mut stream,
                                &Envelope {
                                    version: VERSION,
                                    body: Ok::<_, Error>(Response::OperationWindow(window)),
                                },
                            );
                            continue;
                        }
                        Response::Done
                    }
                    Command::Spawn {
                        operation, command, ..
                    } => {
                        state.operations.lock().unwrap().push(operation);
                        window.admitted_through += 1;
                        Response::Spawned(Session {
                            pty: identity.clone(),
                            session_key: command.owner.session_key(),
                            owner: command.owner,
                            cwd: Some(command.command.cwd),
                            pid: 1,
                            exit_code: None,
                            next_io_sequence: Some(1),
                        })
                    }
                    Command::AcknowledgeOperations { through, .. } => {
                        state.acknowledgements.fetch_add(1, Ordering::SeqCst);
                        assert!(through <= window.admitted_through);
                        window.retired_through = window.retired_through.max(through);
                        state.retired.store(
                            usize::try_from(window.retired_through).unwrap(),
                            Ordering::SeqCst,
                        );
                        if state.drop_ack_reply.swap(false, Ordering::SeqCst) {
                            continue;
                        }
                        Response::Done
                    }
                    other => panic!("unexpected command: {other:?}"),
                };
                let _ = write_frame(
                    &mut stream,
                    &Envelope {
                        version: VERSION,
                        body: Ok::<_, Error>(response),
                    },
                );
            }
        });
        let client = Client::connect(root.path()).unwrap();
        client.enable_operation_retirement().unwrap();
        (
            Self {
                _root: root,
                observed,
                thread: Some(thread),
            },
            client,
            pty,
        )
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.observed.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[test]
fn lost_or_corrupt_input_reply_does_not_retire_or_reissue_uncertain_input() {
    for corrupt in 0..3 {
        let (server, client, pty) = Server::start();
        match corrupt {
            0 => server
                .observed
                .drop_input_reply
                .store(true, Ordering::SeqCst),
            1 => server
                .observed
                .corrupt_input_reply
                .store(true, Ordering::SeqCst),
            _ => server
                .observed
                .wrong_input_reply
                .store(true, Ordering::SeqCst),
        }
        assert!(client.write_ordered(&pty, 1, b"once").is_err());
        assert_eq!(
            client.write_ordered(&pty, 2, b"must-not-send"),
            Err(Error::OutcomeUnknown)
        );
        client.flush_operation_receipts().unwrap();
        assert_eq!(server.observed.operations.lock().unwrap().len(), 1);
        assert_eq!(server.observed.retired.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn a_lost_acknowledgement_is_retried_without_reissuing_input() {
    let (server, client, pty) = Server::start();
    server.observed.drop_ack_reply.store(true, Ordering::SeqCst);
    client.write_ordered(&pty, 1, b"once").unwrap();
    let _ = client.flush_operation_receipts();
    client.flush_operation_receipts().unwrap();
    client.write_ordered(&pty, 2, b"next").unwrap();
    client.flush_operation_receipts().unwrap();
    assert_eq!(server.observed.operations.lock().unwrap().len(), 2);
    assert_eq!(server.observed.retired.load(Ordering::SeqCst), 2);
    assert!(server.observed.acknowledgements.load(Ordering::SeqCst) >= 3);
}

#[test]
fn concurrent_clones_allocate_one_contiguous_stream() {
    let (server, client, pty) = Server::start();
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let client = client.clone();
            let pty = pty.clone();
            scope.spawn(move || {
                for sequence in 1..=8 {
                    client.write_ordered(&pty, sequence, b"x").unwrap();
                }
            });
        }
    });
    client.flush_operation_receipts().unwrap();
    let operations = server.observed.operations.lock().unwrap();
    assert_eq!(operations.len(), 64);
    for (index, operation) in operations.iter().enumerate() {
        assert_eq!(
            operation,
            &OperationId::ordered(1, u64::try_from(index + 1).unwrap()).unwrap()
        );
    }
    assert_eq!(server.observed.retired.load(Ordering::SeqCst), 64);
}
