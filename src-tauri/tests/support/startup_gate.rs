//! An owned image-preflight peer. Holding readiness is fixture input, not a sleep race.
use openforge_session_client::runtime::RuntimeDirectory;
use std::{
    fs,
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener},
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, Sender},
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub struct StartupGate {
    path: PathBuf,
    entered: Receiver<()>,
    disconnected: Receiver<()>,
    release: Sender<bool>,
    worker: Option<JoinHandle<()>>,
}
impl StartupGate {
    pub fn new(root: &Path) -> Self {
        let runtime = RuntimeDirectory::open(root).unwrap();
        let path = runtime.path().join("bootstrap-gate.sock");
        let listener = UnixListener::bind(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let (disconnected_tx, disconnected) = mpsc::channel();
        let (entered_tx, entered) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(30);
            let mut stream = loop {
                if release_rx.try_recv().is_ok() || Instant::now() >= deadline {
                    return;
                }
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("accepting owned startup gate: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut marker = [0; 7];
            stream.read_exact(&mut marker).unwrap();
            assert_eq!(&marker, b"entered");
            entered_tx.send(()).unwrap();
            stream.set_nonblocking(true).unwrap();
            loop {
                if let Ok(allowed) = release_rx.try_recv() {
                    // A cancelled bootstrap may have closed the peer already.
                    let _ = stream.write_all(&[u8::from(allowed)]);
                    return;
                }
                match stream.read(&mut [0]) {
                    Ok(0) => {
                        let _ = disconnected_tx.send(());
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    other => panic!("unexpected startup gate input: {other:?}"),
                }
                assert!(Instant::now() < deadline, "owned startup gate expired");
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        Self {
            path,
            entered,
            disconnected,
            release,
            worker: Some(worker),
        }
    }
    pub fn wait_until_entered(&self) {
        self.entered.recv_timeout(Duration::from_secs(20)).unwrap();
    }
    pub fn wait_until_disconnected(&self) {
        self.disconnected
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
    }
    pub fn finish(mut self, allowed: bool) {
        self.stop(allowed);
    }
    fn stop(&mut self, allowed: bool) {
        let _ = self.release.send(allowed);
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            fs::remove_file(&self.path).unwrap();
            if !std::thread::panicking() {
                result.unwrap();
            }
        }
    }
}
impl Drop for StartupGate {
    fn drop(&mut self) {
        self.stop(true);
    }
}
