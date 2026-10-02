//! Owned transport interruption at the authenticated public subscription boundary.
//! Commands continue unchanged. A paused stream resumes through a real Subscribe
//! from its last delivered cursor, so only the daemon can report a journal gap.
use openforge_session_client::runtime::{check_peer, RuntimeDirectory};
use openforge_session_protocol::{
    read_frame, write_frame, Command, Envelope, Error, EventBatch, Request, Response, VERSION,
};
use std::collections::HashMap;
use std::net::Shutdown;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::{
    fs::PermissionsExt,
    net::{UnixListener, UnixStream},
};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::oneshot;

const LIMIT: Duration = super::DAEMON_SHELL_CONTRACT_TIMEOUT;

pub(super) struct Pause {
    pub parked: oneshot::Receiver<EventBatch>,
    pub release: mpsc::Sender<()>,
    pub resumed: oneshot::Receiver<EventBatch>,
}
struct ArmedPause {
    parked: oneshot::Sender<EventBatch>,
    release: mpsc::Receiver<()>,
    resumed: oneshot::Sender<EventBatch>,
}
#[derive(Default)]
struct Shared {
    stopping: AtomicBool,
    sockets: Mutex<HashMap<RawFd, UnixStream>>,
    pause: Mutex<Option<ArmedPause>>,
    release: Mutex<Option<mpsc::Sender<()>>>,
}

pub(super) struct SubscriptionGate {
    public: PathBuf,
    backing: PathBuf,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}
impl SubscriptionGate {
    pub fn new(root: &Path) -> Self {
        let runtime = RuntimeDirectory::open_existing(root).unwrap();
        runtime.check_socket().unwrap();
        let public = runtime.socket_path();
        let backing = public.with_file_name("interrupted.sock");
        std::fs::rename(&public, &backing).unwrap();
        let setup = (|| -> std::io::Result<UnixListener> {
            let listener = UnixListener::bind(&public)?;
            std::fs::set_permissions(&public, std::fs::Permissions::from_mode(0o600))?;
            listener.set_nonblocking(true)?;
            Ok(listener)
        })();
        let listener = setup.unwrap_or_else(|error| {
            let _ = std::fs::remove_file(&public);
            std::fs::rename(&backing, &public).expect("restore owned daemon socket");
            panic!("subscription relay setup: {error}");
        });
        let shared = Arc::new(Shared::default());
        let worker_shared = shared.clone();
        let worker_backing = backing.clone();
        let thread = std::thread::spawn(move || {
            let mut workers = Vec::new();
            while !worker_shared.stopping.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let shared = worker_shared.clone();
                        let backing = worker_backing.clone();
                        workers.push(std::thread::spawn(move || {
                            // Closure/EOF is expected when the app replaces a controller
                            // or the fixture interrupts its owned subscription.
                            if let Err(error) = relay(stream, &backing, &shared) {
                                if !shared.stopping.load(Ordering::Acquire) {
                                    eprintln!("subscription relay closed: {error}");
                                }
                            }
                        }));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("subscription relay accept: {error}"),
                }
            }
            for worker in workers {
                worker.join().expect("subscription relay worker");
            }
        });
        Self {
            public,
            backing,
            shared,
            thread: Some(thread),
        }
    }

    pub fn pause_next_batch(&self) -> Pause {
        let (parked_tx, parked) = oneshot::channel();
        let (release, release_rx) = mpsc::channel();
        let (resumed_tx, resumed) = oneshot::channel();
        let mut slot = self.shared.pause.lock().unwrap();
        assert!(slot.is_none(), "only one owned interruption at a time");
        *self.shared.release.lock().unwrap() = Some(release.clone());
        *slot = Some(ArmedPause {
            parked: parked_tx,
            release: release_rx,
            resumed: resumed_tx,
        });
        Pause {
            parked,
            release,
            resumed,
        }
    }
}
impl Drop for SubscriptionGate {
    fn drop(&mut self) {
        self.shared.stopping.store(true, Ordering::Release);
        if let Some(release) = self.shared.release.lock().unwrap().take() {
            let _ = release.send(());
        }
        for socket in self.shared.sockets.lock().unwrap().values() {
            let _ = socket.shutdown(Shutdown::Both);
        }
        let joined = self.thread.take().unwrap().join();
        let restored = std::fs::remove_file(&self.public)
            .and_then(|()| std::fs::rename(&self.backing, &self.public));
        if joined.is_err() || restored.is_err() {
            eprintln!("subscription relay teardown failed: restored={restored:?}");
            assert!(
                std::thread::panicking(),
                "subscription relay teardown failed"
            );
        }
    }
}

struct SocketLease<'a> {
    descriptor: RawFd,
    shared: &'a Shared,
}
impl Drop for SocketLease<'_> {
    fn drop(&mut self) {
        self.shared.sockets.lock().unwrap().remove(&self.descriptor);
    }
}
fn track<'a>(stream: &UnixStream, shared: &'a Shared) -> Result<SocketLease<'a>, Error> {
    let mut sockets = shared.sockets.lock().unwrap();
    if shared.stopping.load(Ordering::Acquire) {
        let _ = stream.shutdown(Shutdown::Both);
        return Err(Error::OutcomeUnknown);
    }
    let socket = stream
        .try_clone()
        .map_err(openforge_session_client::runtime::io_error)?;
    let descriptor = socket.as_raw_fd();
    sockets.insert(descriptor, socket);
    Ok(SocketLease { descriptor, shared })
}
fn upstream<'a>(
    backing: &Path,
    shared: &'a Shared,
) -> Result<(UnixStream, SocketLease<'a>), Error> {
    let stream =
        UnixStream::connect(backing).map_err(openforge_session_client::runtime::io_error)?;
    check_peer(&stream)?;
    stream
        .set_read_timeout(Some(LIMIT))
        .and_then(|()| stream.set_write_timeout(Some(LIMIT)))
        .map_err(openforge_session_client::runtime::io_error)?;
    let lease = track(&stream, shared)?;
    Ok((stream, lease))
}
fn send<T: serde::Serialize>(stream: &mut UnixStream, body: T) -> Result<(), Error> {
    write_frame(
        stream,
        &Envelope {
            version: VERSION,
            body,
        },
    )
}
fn relay(mut downstream: UnixStream, backing: &Path, shared: &Shared) -> Result<(), Error> {
    check_peer(&downstream)?;
    downstream
        .set_nonblocking(false)
        .and_then(|()| downstream.set_read_timeout(Some(LIMIT)))
        .and_then(|()| downstream.set_write_timeout(Some(LIMIT)))
        .map_err(openforge_session_client::runtime::io_error)?;
    let _downstream_lease = track(&downstream, shared)?;
    let mut request: Request = read_frame(&mut downstream)?;
    let subscription = matches!(request.command, Command::Subscribe { .. });
    let (mut daemon, mut _daemon_lease) = upstream(backing, shared)?;
    send(&mut daemon, &request)?;
    loop {
        let reply: Result<Response, Error> = read_frame(&mut daemon)?;
        send(&mut downstream, &reply)?;
        if !subscription || reply.is_err() {
            return Ok(());
        }
        if let Ok(Response::Events(batch)) = reply {
            let pause = shared.pause.lock().unwrap().take();
            if let Some(pause) = pause {
                // The app has this complete prefix. Close only our authenticated
                // upstream stream, not the daemon or its independent command loop.
                let _ = daemon.shutdown(Shutdown::Both);
                let _ = pause.parked.send(batch.clone());
                pause
                    .release
                    .recv_timeout(LIMIT)
                    .map_err(|_| Error::OutcomeUnknown)?;
                let Command::Subscribe { after, .. } = &mut request.command else {
                    unreachable!("subscription command");
                };
                *after = batch.cursor;
                (daemon, _daemon_lease) = upstream(backing, shared)?;
                send(&mut daemon, &request)?;
                let reply: Result<Response, Error> = read_frame(&mut daemon)?;
                if let Ok(Response::Events(batch)) = &reply {
                    let _ = pause.resumed.send(batch.clone());
                }
                // Forward the real reply unchanged, including its gap and exit.
                send(&mut downstream, &reply)?;
            }
        }
    }
}
