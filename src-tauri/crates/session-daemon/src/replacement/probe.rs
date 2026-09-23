use super::{images, version, STATE_FORMAT};
use openforge_session_protocol::{Error, VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    os::{fd::AsRawFd, unix::process::CommandExt},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const CODEC: &str = "ghostty-de9fd9b0-worker-v1";
const READY_MARKER: &[u8] = b"image-preflight-ready\n";
// Cold copied images can wait behind macOS XProtect before entering main.
// Only this startup phase gets a separate budget; responsive probes retain
// their two-second execution deadline.
#[cfg(target_os = "macos")]
pub(super) const MAX_STARTUP_WAIT: Duration = Duration::from_secs(20);
#[cfg(not(target_os = "macos"))]
const MAX_STARTUP_WAIT: Duration = Duration::from_secs(2);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Contract {
    protocol: u32,
    state_format: u32,
    authority_codec: String,
    architecture: String,
    pub image_version: String,
    pub sha256: String,
    state_digest: Option<String>,
}
pub(super) fn describe(state: Option<&[u8]>) -> Result<(), Error> {
    if state.is_none() {
        // stderr stays empty for state probes. The image marker separates
        // loader startup from the unchanged bounded contract computation.
        std::io::stderr()
            .write_all(READY_MARKER)
            .map_err(|_| refused())?;
    }
    let contract = Contract {
        protocol: VERSION,
        state_format: STATE_FORMAT,
        authority_codec: CODEC.into(),
        architecture: std::env::consts::ARCH.into(),
        image_version: version::current()?,
        sha256: images::digest(&std::env::current_exe().map_err(|_| refused())?)?,
        state_digest: state.map(|bytes| format!("{:x}", Sha256::digest(bytes))),
    };
    serde_json::to_writer(std::io::stdout().lock(), &contract).map_err(|_| refused())
}
pub(super) fn run(path: &Path, state: Option<&[u8]>) -> Result<Contract, Error> {
    // Compute the descriptor ceiling before fork, outside the async-signal-safe section.
    let descriptor_limit = unsafe { libc::getdtablesize() };
    if !(3..=1_048_576).contains(&descriptor_limit) {
        return Err(refused());
    }
    let mut command = Command::new(path);
    command
        .arg(if state.is_some() {
            "--check-state"
        } else {
            "--check-image"
        })
        .env_clear()
        .stdin(if state.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(if state.is_some() {
            Stdio::null()
        } else {
            Stdio::piped()
        });
    // SAFETY: only async-signal-safe libc calls run after fork. CLOEXEC preserves
    // Command's error pipe while lending no protected/session/checkpoint descriptors.
    unsafe {
        command.pre_exec(move || {
            // A private session/group bounds helper descendants without targeting the host.
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            for fd in 3..descriptor_limit {
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags < 0 {
                    let error = std::io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::EBADF) {
                        continue;
                    }
                    return Err(error);
                }
                if libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    let mut helper = Helper(Some(command.spawn().map_err(|error| {
        eprintln!("image preflight spawn failed: {error}");
        refused()
    })?));
    let child = helper.0.as_mut().ok_or_else(refused)?;
    let result = probe_child(child, state);
    helper.finish()?;
    result
}
fn probe_child(child: &mut std::process::Child, state: Option<&[u8]>) -> Result<Contract, Error> {
    let mut pipes = ProbePipes::new(child, state.unwrap_or_default())?;
    let expected_digest = state.map(|bytes| format!("{:x}", Sha256::digest(bytes)));
    let mut deadlines = ProbeDeadlines::new(state.is_some());
    loop {
        pipes.send_input()?;
        pipes.read_readiness(&mut deadlines)?;
        pipes.read_output(&mut deadlines)?;
        if let Some(success) = exited_without_reaping(child.id())? {
            if !success {
                return Err(refused());
            }
            // The leader remains an unreaped zombie, reserving its PID while we
            // stop descendants that might otherwise keep stdout open indefinitely.
            stop_group(child.id())?;
            if pipes.eof {
                return validate_contract(
                    &pipes.bytes,
                    pipes.sent == pipes.input.len(),
                    expected_digest,
                );
            }
        }
        deadlines.check(state.is_some(), pipes.bytes.len(), pipes.eof, pipes.sent)?;
        std::thread::sleep(Duration::from_millis(2));
    }
}
struct ProbePipes<'a> {
    stdout: std::process::ChildStdout,
    stdin: Option<std::process::ChildStdin>,
    stderr: Option<std::process::ChildStderr>,
    input: &'a [u8],
    sent: usize,
    bytes: Vec<u8>,
    eof: bool,
    stderr_bytes: Vec<u8>,
}
impl<'a> ProbePipes<'a> {
    fn new(child: &mut std::process::Child, input: &'a [u8]) -> Result<Self, Error> {
        let stdout = child.stdout.take().ok_or_else(refused)?;
        nonblocking(stdout.as_raw_fd())?;
        let stdin = child.stdin.take();
        let stderr = child.stderr.take();
        if let Some(stderr) = &stderr {
            nonblocking(stderr.as_raw_fd())?;
        }
        if let Some(stdin) = &stdin {
            nonblocking(stdin.as_raw_fd())?;
        }
        Ok(Self {
            stdout,
            stdin,
            stderr,
            input,
            sent: 0,
            bytes: Vec::new(),
            eof: false,
            stderr_bytes: Vec::new(),
        })
    }
    fn send_input(&mut self) -> Result<(), Error> {
        if let Some(pipe) = &mut self.stdin {
            match pipe.write(&self.input[self.sent..]) {
                Ok(count) => self.sent += count,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => return Err(refused()),
            }
            if self.sent == self.input.len() {
                self.stdin.take();
            }
        }
        Ok(())
    }
    fn read_readiness(&mut self, deadlines: &mut ProbeDeadlines) -> Result<(), Error> {
        let mut stderr_eof = false;
        if let Some(pipe) = &mut self.stderr {
            let mut buffer = [0; 64];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) => {
                        stderr_eof = true;
                        break;
                    }
                    Ok(count) => {
                        if self.stderr_bytes.len() + count > 256 {
                            return Err(Error::Capacity);
                        }
                        self.stderr_bytes.extend_from_slice(&buffer[..count]);
                        if self.stderr_bytes.starts_with(READY_MARKER) {
                            deadlines.ready();
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => return Err(refused()),
                }
            }
        }
        if stderr_eof {
            self.stderr.take();
        }
        Ok(())
    }
    fn read_output(&mut self, deadlines: &mut ProbeDeadlines) -> Result<(), Error> {
        let mut buffer = [0; 512];
        loop {
            match self.stdout.read(&mut buffer) {
                Ok(0) => {
                    self.eof = true;
                    break;
                }
                Ok(count) => {
                    if self.bytes.len() + count > 4096 {
                        return Err(Error::Capacity);
                    }
                    // Older compatible images do not emit the readiness marker.
                    // Their first output starts the same bounded response window.
                    deadlines.ready();
                    self.bytes.extend_from_slice(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(refused()),
            }
        }
        Ok(())
    }
}
struct ProbeDeadlines {
    startup: Instant,
    execution: Option<Instant>,
}
impl ProbeDeadlines {
    fn new(state: bool) -> Self {
        Self {
            startup: Instant::now() + MAX_STARTUP_WAIT,
            execution: state.then(|| Instant::now() + Duration::from_secs(5)),
        }
    }
    fn ready(&mut self) {
        self.execution
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(2));
    }
    fn check(&self, state: bool, stdout_bytes: usize, eof: bool, sent: usize) -> Result<(), Error> {
        if Instant::now() >= self.execution.unwrap_or(self.startup) {
            eprintln!(
                "image preflight deadline exceeded (state={}, ready={}, stdout_bytes={}, eof={}, sent={})",
                state, self.execution.is_some(), stdout_bytes, eof, sent
            );
            return Err(refused());
        }
        Ok(())
    }
}
fn validate_contract(
    bytes: &[u8],
    input_complete: bool,
    expected_digest: Option<String>,
) -> Result<Contract, Error> {
    let contract: Contract = serde_json::from_slice(bytes).map_err(|_| refused())?;
    if !input_complete
        || contract.protocol != VERSION
        || contract.state_format != STATE_FORMAT
        || contract.authority_codec != CODEC
        || contract.architecture != "aarch64"
        || contract.image_version.is_empty()
        || contract.image_version.len() > 256
        || contract.sha256.len() != 64
        || !contract.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        || contract.state_digest != expected_digest
    {
        return Err(refused());
    }
    Ok(contract)
}
struct Helper(Option<std::process::Child>);
impl Helper {
    fn finish(&mut self) -> Result<(), Error> {
        let Some(mut child) = self.0.take() else {
            return Ok(());
        };
        let stopped = stop_group(child.id());
        let reaped = child.wait().map_err(|error| {
            eprintln!("image preflight reap failed: {error}");
            refused()
        });
        stopped?;
        reaped.map(|_| ())
    }
}
impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}
fn stop_group(pid: u32) -> Result<(), Error> {
    // SAFETY: setsid created this private group; its leader is still alive or unreaped.
    if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } >= 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    // Darwin reports EPERM for a group containing only its unreaped zombie.
    // Do not hide a permission failure if any other member remains.
    if error.raw_os_error() == Some(libc::EPERM) && zombie_only_group(pid)? {
        return Ok(());
    }
    eprintln!("image preflight group cleanup failed: {error}");
    Err(refused())
}
#[cfg(target_os = "macos")]
fn zombie_only_group(pid: u32) -> Result<bool, Error> {
    if exited_without_reaping(pid)?.is_none() {
        return Ok(false);
    }
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_listpgrppids(
            group: libc::pid_t,
            buffer: *mut libc::c_void,
            bytes: libc::c_int,
        ) -> libc::c_int;
    }
    let mut members = [0i32; 2];
    // SAFETY: errno is thread-local; the two-PID buffer is writable for its full size.
    let count = unsafe {
        *libc::__error() = 0;
        proc_listpgrppids(
            pid as i32,
            members.as_mut_ptr().cast(),
            std::mem::size_of_val(&members) as i32,
        )
    };
    let error = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    Ok(count >= 0
        && (count > 0 || error == 0 || error == libc::ESRCH)
        && members
            .iter()
            .all(|member| *member == 0 || *member == pid as i32))
}
#[cfg(not(target_os = "macos"))]
fn zombie_only_group(_pid: u32) -> Result<bool, Error> {
    Ok(false)
}

#[cfg(target_os = "macos")]
fn exited_without_reaping(pid: u32) -> Result<Option<bool>, Error> {
    // SAFETY: siginfo_t is a plain output structure and waitid writes within its size.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    // SAFETY: PID identifies our child; WNOWAIT reserves it until group teardown.
    if unsafe {
        libc::waitid(
            libc::P_PID,
            pid,
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    } < 0
    {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EINTR) {
            return Ok(None);
        }
        eprintln!("image preflight waitid failed: {error}");
        return Err(refused());
    }
    if info.si_pid != 0 && (info.si_code != libc::CLD_EXITED || info.si_status != 0) {
        eprintln!(
            "image preflight child failed (code={}, status={})",
            info.si_code, info.si_status
        );
    }
    Ok((info.si_pid != 0).then_some(info.si_code == libc::CLD_EXITED && info.si_status == 0))
}
#[cfg(not(target_os = "macos"))]
fn exited_without_reaping(_pid: u32) -> Result<Option<bool>, Error> {
    Err(refused())
}

fn nonblocking(fd: i32) -> Result<(), Error> {
    // SAFETY: fd is owned by a live child pipe; only status flags change.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    // SAFETY: O_NONBLOCK is valid for these pipes and ownership is unchanged.
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(refused());
    }
    Ok(())
}
fn refused() -> Error {
    Error::UnsupportedReplacement
}
