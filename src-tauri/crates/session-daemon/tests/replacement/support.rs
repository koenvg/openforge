//! Shared real-process owner. Teardown policy changes belong to KVG-5313/KVG-5327;
//! keep scenario extraction independent of that policy.
use super::managed_process;
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::*;
use serde_json::{json, Value};
use std::{
    os::unix::{net::UnixStream, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    time::{Duration, Instant},
};

// A replacement preparation may wait for two cold executable startups.
// These are fixture waits, not the helper's execution deadline.
const STARTUP_WAIT: Duration = Duration::from_secs(30); // 10s startup + 20s loader startup
const STATUS_WAIT: Duration = Duration::from_secs(55); // 15s status + two 20s startups

// All scenarios stay in one test binary and share this lock, including 256-PTY workloads.
static FIXTURE_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Default)]
pub(super) struct FixtureOptions<'a> {
    pub executable: Option<&'a Path>,
    pub fd_limit: Option<libc::rlim_t>,
    pub checkpoint_byte_limit: Option<usize>,
    pub checkpoint_deadline_ms: Option<u64>,
    pub slow_stages: Option<&'a str>,
}

pub(super) struct Fixture {
    root: tempfile::TempDir,
    daemon: Child,
    tracked: Vec<managed_process::ManagedProcessIdentity>,
    _serial: std::sync::MutexGuard<'static, ()>,
}
impl Fixture {
    pub(super) fn new() -> (Self, Client) {
        Self::with_options(FixtureOptions::default())
    }

    pub(super) fn with_options(options: FixtureOptions<'_>) -> (Self, Client) {
        let FixtureOptions {
            executable,
            fd_limit,
            checkpoint_byte_limit,
            checkpoint_deadline_ms,
            slow_stages,
        } = options;
        let executable =
            executable.unwrap_or_else(|| Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")));
        let serial = FIXTURE_SERIAL
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = tempfile::Builder::new()
            .prefix("of-rx-")
            .tempdir_in("/tmp")
            .unwrap();
        let mut command = std::process::Command::new(executable);
        command
            .arg(root.path())
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(std::fs::File::create(root.path().join("fixture.log")).unwrap());
        if let Some(limit) = checkpoint_byte_limit {
            command.env("OPENFORGE_TEST_CHECKPOINT_BYTE_LIMIT", limit.to_string());
        }
        if let Some(limit) = checkpoint_deadline_ms {
            command.env("OPENFORGE_TEST_CHECKPOINT_DEADLINE_MS", limit.to_string());
        }
        if let Some(stages) = slow_stages {
            command.env("OPENFORGE_TEST_REPLACEMENT_SLOW_STAGES", stages);
        }
        // SAFETY: setsid is async-signal-safe; only the test-owned daemon's session changes.
        unsafe {
            command.pre_exec(move || {
                if let Some(limit) = fd_limit {
                    let mut current = std::mem::zeroed::<libc::rlimit>();
                    if libc::getrlimit(libc::RLIMIT_NOFILE, &mut current) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    current.rlim_cur = limit.min(current.rlim_max);
                    if libc::setrlimit(libc::RLIMIT_NOFILE, &current) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let daemon = command.spawn().unwrap();
        let fixture = Self {
            root,
            daemon,
            tracked: Vec::new(),
            _serial: serial,
        };
        let deadline = Instant::now() + STARTUP_WAIT;
        loop {
            if let Ok(client) = Client::connect(fixture.root.path()) {
                // These tests require verified replacement, not just ordinary serving readiness.
                if client
                    .capabilities()
                    .is_ok_and(|capabilities| capabilities.supports_replacement)
                {
                    return (fixture, client);
                }
            }
            assert!(Instant::now() < deadline, "test daemon did not start");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub(super) fn root(&self) -> &Path {
        self.root.path()
    }

    pub(super) fn daemon_pid(&self) -> u32 {
        self.daemon.id()
    }

    pub(super) fn track_process(&mut self, pid: u32) {
        self.tracked
            .push(managed_process::ManagedProcessIdentity::capture(pid).unwrap());
    }

    pub(super) fn tracked_processes(&self) -> &[managed_process::ManagedProcessIdentity] {
        &self.tracked
    }

    pub(super) fn rpc(&self, command: Value) -> Result<Value, Error> {
        let runtime = RuntimeDirectory::open(self.root.path())?;
        let mut stream = UnixStream::connect(runtime.socket_path())
            .map_err(openforge_session_client::runtime::io_error)?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write_frame(
            &mut stream,
            &Envelope {
                version: VERSION,
                body: json!({"token":runtime.credentials().token,"command":command}),
            },
        )?;
        read_frame::<_, Result<Value, Error>>(&mut stream)?
    }
    pub(super) fn status(&self, operation: &str, wanted: &str) -> Value {
        let deadline = Instant::now() + STATUS_WAIT;
        let mut last = String::new();
        loop {
            let response = self.rpc(json!({"kind":"replacementStatus","operation":operation}));
            last.clone_from(&format!("{response:?}"));
            if let Ok(response) = response {
                let status = &response["value"];
                let state = status["state"]["kind"].as_str().unwrap();
                if state == wanted {
                    return status.clone();
                }
                assert_ne!(state, "failed", "replacement failed: {status}");
            }
            assert!(
                Instant::now() < deadline,
                "replacement did not reach {wanted}: {last}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            if let Ok(log) = std::fs::read_to_string(self.root.path().join("fixture.log")) {
                for line in log.lines().filter(|line| {
                    line.contains("daemon")
                        || line.contains("initialization")
                        || line.contains("rollback")
                        || line.contains("recovery")
                        || line.contains("preflight")
                        || line.contains("replacement unavailable")
                }) {
                    eprintln!("fixture daemon: {line}");
                }
            }
        }
        if let Ok(client) = Client::connect(self.root.path()) {
            if let Ok(inventory) = client.inventory() {
                for session in inventory.sessions {
                    let _ = client
                        .terminate(&format!("cleanup-{}", session.pty.instance), &session.pty);
                }
            }
            let _ = client.shutdown_empty();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.daemon.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.daemon.try_wait().ok().flatten().is_none() {
            let _ = self.daemon.kill();
        }
        let _ = self.daemon.wait();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        for identity in &self.tracked {
            let result = runtime.block_on(
                managed_process::terminate_managed_process_tree_with_root_reaper(
                    identity,
                    Duration::from_millis(100),
                    |_| {},
                ),
            );
            assert!(
                result.is_ok(),
                "test-owned process cleanup failed: {result:?}"
            );
        }
    }
}
pub(super) fn wait_text(client: &Client, pty: &PtyIdentity, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !client.recover(pty).is_ok_and(|snapshot| {
        snapshot
            .portable_vt
            .windows(expected.len())
            .any(|bytes| bytes == expected.as_bytes())
    }) {
        assert!(
            Instant::now() < deadline,
            "expected PTY output {expected} did not arrive"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut libc::c_void, capacity: u32) -> i32;
}
pub(super) fn executable(pid: u32) -> PathBuf {
    let mut buffer = [0u8; 4096];
    // SAFETY: buffer is writable for exactly the supplied capacity; pid is test-owned.
    assert!(
        unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) } > 0
    );
    Path::new(
        std::ffi::CStr::from_bytes_until_nul(&buffer)
            .unwrap()
            .to_str()
            .unwrap(),
    )
    .into()
}
