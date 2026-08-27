use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessStatus, System};

const PROCESS_IDENTITY_VERSION: u32 = 1;
const KILL_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RootReapMode {
    Poll,
    Wait,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedProcessIdentity {
    pub(super) version: u32,
    pub(super) root_pid: i32,
    pub(super) process_group_id: i32,
    pub(super) session_id: i32,
    pub(super) root_start_time: u64,
}

#[derive(Debug, Clone)]
struct ProcessSnapshot {
    pid: i32,
    parent_pid: Option<i32>,
    process_group_id: i32,
    session_id: Option<i32>,
    start_time: u64,
    terminated: bool,
}

impl ManagedProcessIdentity {
    pub(super) fn capture(root_pid: u32) -> Result<Self, String> {
        let root_pid = i32::try_from(root_pid)
            .map_err(|_| format!("managed process PID {root_pid} is out of range"))?;
        if root_pid <= 1 {
            return Err(format!(
                "managed process PID must be greater than 1, got {root_pid}"
            ));
        }
        let system = System::new_all();
        let Some(process) = system.process(Pid::from(root_pid as usize)) else {
            return Ok(Self {
                version: PROCESS_IDENTITY_VERSION,
                root_pid,
                process_group_id: root_pid,
                session_id: root_pid,
                root_start_time: 0,
            });
        };
        let process_group_id = process_group_id(root_pid)?;
        let session_id = session_id(root_pid)?;
        let identity = Self {
            version: PROCESS_IDENTITY_VERSION,
            root_pid,
            process_group_id,
            session_id,
            root_start_time: process.start_time(),
        };
        identity.validate()?;
        Ok(identity)
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if self.version != PROCESS_IDENTITY_VERSION {
            return Err(format!(
                "unsupported managed process identity version {}",
                self.version
            ));
        }
        if self.root_pid <= 1 || self.process_group_id <= 1 || self.session_id <= 1 {
            return Err(
                "managed process identity contains a PID, PGID, or SID that is not greater than 1"
                    .to_string(),
            );
        }
        Ok(())
    }
}

fn process_group_id(pid: i32) -> Result<i32, String> {
    if pid <= 1 {
        return Err(format!("process PID must be greater than 1, got {pid}"));
    }
    // SAFETY: libc::getpgid accepts a process identifier and does not dereference
    // pointers. The guard above restricts the lookup to one positive, non-system PID.
    let process_group_id = unsafe { libc::getpgid(pid) };
    if process_group_id < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(pid)
        } else {
            Err(format!(
                "failed to read process group for managed process {pid}: {error}"
            ))
        }
    } else {
        Ok(process_group_id)
    }
}

fn session_id(pid: i32) -> Result<i32, String> {
    if pid <= 1 {
        return Err(format!("process PID must be greater than 1, got {pid}"));
    }
    // SAFETY: libc::getsid accepts a process identifier and does not dereference
    // pointers. The guard above restricts the lookup to one positive, non-system PID.
    let session_id = unsafe { libc::getsid(pid) };
    if session_id < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(pid)
        } else {
            Err(format!(
                "failed to read session for managed process {pid}: {error}"
            ))
        }
    } else {
        Ok(session_id)
    }
}

#[derive(Clone, Copy, Debug)]
enum SignalTarget {
    Process(i32),
    ProcessGroup(i32),
}

#[derive(Clone, Copy, Debug)]
enum ManagedSignal {
    Terminate,
    Kill,
}

impl ManagedSignal {
    fn as_raw(self) -> i32 {
        match self {
            Self::Terminate => libc::SIGTERM,
            Self::Kill => libc::SIGKILL,
        }
    }
}

fn send_signal(target: SignalTarget, signal: ManagedSignal) -> std::io::Result<()> {
    let raw_target = match target {
        SignalTarget::Process(pid) if pid > 1 => pid,
        SignalTarget::Process(pid) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("process PID must be greater than 1, got {pid}"),
            ));
        }
        SignalTarget::ProcessGroup(process_group_id) if process_group_id > 1 => -process_group_id,
        SignalTarget::ProcessGroup(process_group_id) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("process group ID must be greater than 1, got {process_group_id}"),
            ));
        }
    };
    // SAFETY: libc::kill accepts integer identifiers without dereferencing pointers.
    // SignalTarget permits only individual PIDs above 1 or group IDs above 1 encoded
    // as values below -1; ManagedSignal permits only SIGTERM or SIGKILL.
    let result = unsafe { libc::kill(raw_target, signal.as_raw()) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

pub(super) fn force_kill_unverified_spawn(root_pid: u32) -> Result<(), String> {
    let root_pid = i32::try_from(root_pid)
        .map_err(|_| format!("unverified spawn PID {root_pid} is out of range"))?;
    let mut errors = Vec::new();
    for (target, description) in [
        (SignalTarget::ProcessGroup(root_pid), "process group"),
        (SignalTarget::Process(root_pid), "process"),
    ] {
        if let Err(error) = send_signal(target, ManagedSignal::Kill) {
            if error.raw_os_error() != Some(libc::ESRCH) {
                errors.push(format!(
                    "failed to SIGKILL unverified {description} {root_pid}: {error}"
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn process_snapshot() -> HashMap<i32, ProcessSnapshot> {
    let system = System::new_all();
    system
        .processes()
        .values()
        .filter_map(|process| {
            let pid = i32::try_from(usize::from(process.pid())).ok()?;
            if pid <= 1 {
                return None;
            }
            let parent_pid = process
                .parent()
                .and_then(|parent| i32::try_from(usize::from(parent)).ok());
            // SAFETY: libc::getpgid accepts an integer PID without pointer or lifetime
            // requirements. The filter above excludes reserved/system process IDs.
            let process_group_id = unsafe { libc::getpgid(pid) };
            let session_id = process
                .session_id()
                .and_then(|session| i32::try_from(usize::from(session)).ok());
            Some((
                pid,
                ProcessSnapshot {
                    pid,
                    parent_pid,
                    process_group_id,
                    session_id,
                    start_time: process.start_time(),
                    terminated: matches!(process.status(), ProcessStatus::Zombie),
                },
            ))
        })
        .collect()
}

fn verify_root_identity(
    identity: &ManagedProcessIdentity,
    processes: &HashMap<i32, ProcessSnapshot>,
) -> Result<(), String> {
    let Some(root) = processes.get(&identity.root_pid) else {
        return Ok(());
    };
    let current_group_or_session_is_available =
        root.process_group_id > 0 || root.session_id.is_some();
    if root.start_time != identity.root_start_time
        || (current_group_or_session_is_available
            && (root.session_id != Some(identity.session_id)
                || root.process_group_id != identity.process_group_id))
    {
        return Err(format!(
            "managed process identity mismatch for PID {} (recorded start={}, pgid={}, sid={}; current start={}, pgid={}, sid={:?}); refusing cleanup because the PID may have been reused",
            identity.root_pid,
            identity.root_start_time,
            identity.process_group_id,
            identity.session_id,
            root.start_time,
            root.process_group_id,
            root.session_id
        ));
    }
    Ok(())
}

fn collect_managed_processes(
    identity: &ManagedProcessIdentity,
    processes: &HashMap<i32, ProcessSnapshot>,
    tracked: &mut HashMap<i32, u64>,
) -> Result<Vec<ProcessSnapshot>, String> {
    verify_root_identity(identity, processes)?;

    for process in processes.values() {
        if process.session_id == Some(identity.session_id) {
            tracked.insert(process.pid, process.start_time);
        }
    }

    let mut changed = true;
    while changed {
        changed = false;
        for process in processes.values() {
            if process
                .parent_pid
                .is_some_and(|parent| tracked.contains_key(&parent))
                && !tracked.contains_key(&process.pid)
            {
                tracked.insert(process.pid, process.start_time);
                changed = true;
            }
        }
    }

    Ok(tracked
        .iter()
        .filter_map(|(pid, start_time)| {
            let process = processes.get(pid)?;
            (process.start_time == *start_time && !process.terminated).then(|| process.clone())
        })
        .collect())
}

fn signal_processes(processes: &[ProcessSnapshot], signal: ManagedSignal) -> Result<(), String> {
    let own_pid = i32::try_from(std::process::id()).unwrap_or(i32::MAX);
    let own_process_group_id = process_group_id(own_pid).ok();
    let mut attempted_groups = HashSet::new();
    let mut successfully_signaled_groups = HashSet::new();
    let mut errors = Vec::new();

    for process in processes {
        if process.pid == own_pid {
            errors.push(format!("refusing to signal sidecar PID {own_pid}"));
            continue;
        }
        if process.process_group_id > 1
            && Some(process.process_group_id) != own_process_group_id
            && attempted_groups.insert(process.process_group_id)
        {
            match send_signal(SignalTarget::ProcessGroup(process.process_group_id), signal) {
                Ok(()) => {
                    successfully_signaled_groups.insert(process.process_group_id);
                }
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {}
                Err(error) => errors.push(format!(
                    "failed to signal managed process group {}: {}",
                    process.process_group_id, error
                )),
            }
        }
    }

    for process in processes {
        if process.pid == own_pid
            || successfully_signaled_groups.contains(&process.process_group_id)
        {
            continue;
        }
        match send_signal(SignalTarget::Process(process.pid), signal) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {}
            Err(error) => errors.push(format!(
                "failed to signal managed PID {}: {}",
                process.pid, error
            )),
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

async fn wait_for_managed_exit(
    identity: &ManagedProcessIdentity,
    tracked: &mut HashMap<i32, u64>,
    timeout: Duration,
    root_reaper: &mut impl FnMut(RootReapMode),
) -> Result<Vec<ProcessSnapshot>, String> {
    wait_for_managed_exit_with_snapshot(
        identity,
        tracked,
        timeout,
        root_reaper,
        &mut process_snapshot,
    )
    .await
}

async fn wait_for_managed_exit_with_snapshot(
    identity: &ManagedProcessIdentity,
    tracked: &mut HashMap<i32, u64>,
    timeout: Duration,
    root_reaper: &mut impl FnMut(RootReapMode),
    snapshot_processes: &mut impl FnMut() -> HashMap<i32, ProcessSnapshot>,
) -> Result<Vec<ProcessSnapshot>, String> {
    let deadline = Instant::now() + timeout;
    loop {
        root_reaper(RootReapMode::Poll);
        let processes = snapshot_processes();
        let remaining = collect_managed_processes(identity, &processes, tracked)?;
        if remaining.is_empty() {
            root_reaper(RootReapMode::Poll);
            return Ok(remaining);
        }
        if Instant::now() >= deadline {
            root_reaper(RootReapMode::Poll);
            let processes = snapshot_processes();
            return collect_managed_processes(identity, &processes, tracked);
        }
        tokio::time::sleep(PROCESS_POLL_INTERVAL).await;
    }
}

pub(super) async fn terminate_managed_process_tree(
    identity: &ManagedProcessIdentity,
    term_timeout: Duration,
) -> Result<(), String> {
    terminate_managed_process_tree_with_root_reaper(identity, term_timeout, |_| {}).await
}

pub(super) async fn terminate_managed_process_tree_with_root_reaper(
    identity: &ManagedProcessIdentity,
    term_timeout: Duration,
    mut root_reaper: impl FnMut(RootReapMode),
) -> Result<(), String> {
    identity.validate()?;
    root_reaper(RootReapMode::Poll);
    let processes = process_snapshot();
    let mut tracked = HashMap::from([(identity.root_pid, identity.root_start_time)]);
    let managed = collect_managed_processes(identity, &processes, &mut tracked)?;
    if managed.is_empty() {
        return Ok(());
    }

    signal_processes(&managed, ManagedSignal::Terminate)?;
    let remaining =
        wait_for_managed_exit(identity, &mut tracked, term_timeout, &mut root_reaper).await?;
    if remaining.is_empty() {
        return Ok(());
    }

    signal_processes(&remaining, ManagedSignal::Kill)?;
    root_reaper(RootReapMode::Wait);
    let remaining = wait_for_managed_exit(
        identity,
        &mut tracked,
        KILL_CONFIRMATION_TIMEOUT,
        &mut root_reaper,
    )
    .await?;
    if remaining.is_empty() {
        Ok(())
    } else {
        let pids = remaining
            .iter()
            .map(|process| process.pid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        Err(format!(
            "managed process tree still has live PIDs after SIGKILL: {pids}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::path::Path;
    use std::process::{Child, Command, Stdio};

    fn process_is_alive(pid: i32) -> bool {
        let system = System::new_all();
        system
            .process(Pid::from(pid as usize))
            .is_some_and(|process| !matches!(process.status(), ProcessStatus::Zombie))
    }

    fn wait_for_file(path: &Path) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !path.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        path.exists()
    }

    fn wait_for_pid(path: &Path) -> Option<i32> {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Ok(contents) = std::fs::read_to_string(path) {
                if let Ok(pid) = contents.trim().parse() {
                    return Some(pid);
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn spawn_forking_root(descendant_pid_file: &Path) -> Child {
        let script = format!(
            "trap '' TERM; (trap '' TERM; exec sleep 30) & echo $! > '{}'; wait",
            descendant_pid_file.display()
        );
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: the pre_exec closure runs after fork and calls only libc::setsid,
        // an async-signal-safe operation, then immediately captures errno on failure.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        command.spawn().expect("forking root should spawn")
    }

    fn kill_and_reap_spawned_root(root: &mut Child) {
        force_kill_unverified_spawn(root.id())
            .expect("spawned test process tree should accept SIGKILL");
        let _ = root.wait();
    }

    fn spawn_ready_forking_root(
        descendant_pid_file: &Path,
    ) -> (Child, ManagedProcessIdentity, i32) {
        let mut root = spawn_forking_root(descendant_pid_file);
        let descendant_pid = match wait_for_pid(descendant_pid_file) {
            Some(pid) => pid,
            None => {
                kill_and_reap_spawned_root(&mut root);
                panic!("child PID file did not contain a PID");
            }
        };
        let identity = match ManagedProcessIdentity::capture(root.id()) {
            Ok(identity) => identity,
            Err(error) => {
                kill_and_reap_spawned_root(&mut root);
                panic!("identity should capture: {error}");
            }
        };
        (root, identity, descendant_pid)
    }

    #[test]
    fn identity_capture_rejects_reserved_pid() {
        let error = ManagedProcessIdentity::capture(0)
            .expect_err("PID zero must not produce managed process identity");

        assert!(
            error.contains("greater than 1"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn identity_validation_rejects_reserved_system_process_ids() {
        let identity = ManagedProcessIdentity {
            version: PROCESS_IDENTITY_VERSION,
            root_pid: 1,
            process_group_id: 1,
            session_id: 1,
            root_start_time: 0,
        };

        let error = identity
            .validate()
            .expect_err("PID 1 must never be accepted for managed cleanup");

        assert!(
            error.contains("greater than 1"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn unverified_spawn_kill_reports_invalid_pid() {
        let error = force_kill_unverified_spawn(0)
            .expect_err("PID zero must never be passed to libc::kill");

        assert!(
            error.contains("greater than 1"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn term_timeout_kill_terminates_root_and_long_lived_descendant() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let descendant_pid_file = temp_dir.path().join("descendant.pid");
        let (mut root, identity, descendant_pid) = spawn_ready_forking_root(&descendant_pid_file);

        let result = terminate_managed_process_tree(&identity, Duration::from_millis(100)).await;
        if result.is_err() {
            force_kill_unverified_spawn(root.id())
                .expect("failed cleanup process tree should accept SIGKILL");
        }
        let _ = root.wait();

        assert!(result.is_ok(), "cleanup failed: {result:?}");
        assert!(
            !process_is_alive(identity.root_pid),
            "root process survived cleanup"
        );
        assert!(
            !process_is_alive(descendant_pid),
            "descendant process survived cleanup"
        );
    }

    #[tokio::test]
    async fn deadline_rechecks_processes_after_root_reaping() {
        let pid = 4_242;
        let identity = ManagedProcessIdentity {
            version: PROCESS_IDENTITY_VERSION,
            root_pid: pid,
            process_group_id: pid,
            session_id: pid,
            root_start_time: 7,
        };
        let live_root = ProcessSnapshot {
            pid,
            parent_pid: None,
            process_group_id: pid,
            session_id: Some(pid),
            start_time: identity.root_start_time,
            terminated: false,
        };
        let root_reaper_calls = std::cell::Cell::new(0);
        let root_reaped = std::cell::Cell::new(false);
        let mut root_reaper = |_| {
            root_reaper_calls.set(root_reaper_calls.get() + 1);
            if root_reaper_calls.get() == 2 {
                root_reaped.set(true);
            }
        };
        let mut snapshot_processes = || {
            if root_reaped.get() {
                HashMap::new()
            } else {
                HashMap::from([(pid, live_root.clone())])
            }
        };
        let mut tracked = HashMap::from([(pid, identity.root_start_time)]);

        let remaining = wait_for_managed_exit_with_snapshot(
            &identity,
            &mut tracked,
            Duration::ZERO,
            &mut root_reaper,
            &mut snapshot_processes,
        )
        .await
        .expect("managed process observation should succeed");

        assert!(
            remaining.is_empty(),
            "a root reaped at the deadline must not be reported from the stale snapshot"
        );
    }

    #[tokio::test]
    async fn cleanup_reaps_signaled_root_while_confirming_tree_exit() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let descendant_pid_file = temp_dir.path().join("descendant.pid");
        let (mut root, identity, _) = spawn_ready_forking_root(&descendant_pid_file);
        let mut root_reaped = false;

        let result = terminate_managed_process_tree_with_root_reaper(
            &identity,
            Duration::from_millis(100),
            |mode| match mode {
                RootReapMode::Poll => {
                    if root.try_wait().ok().flatten().is_some() {
                        root_reaped = true;
                    }
                }
                RootReapMode::Wait => {
                    root.wait().expect("SIGKILLed root should be reaped");
                    root_reaped = true;
                }
            },
        )
        .await;
        if result.is_err() {
            force_kill_unverified_spawn(root.id())
                .expect("failed cleanup process tree should accept SIGKILL");
        }
        let _ = root.wait();

        assert!(result.is_ok(), "cleanup failed: {result:?}");
        assert!(
            root_reaped,
            "cleanup should reap the signaled root before reporting tree exit"
        );
    }

    #[tokio::test]
    async fn graceful_handler_receives_one_term_before_timeout() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let marker_file = temp_dir.path().join("term-marker.txt");
        let ready_file = temp_dir.path().join("term-handler-ready.txt");
        let code = r#"
import os, signal, time
marker = os.environ["MARKER"]
ready = os.environ["READY"]
def handle_term(_signum, _frame):
    with open(marker, "a", encoding="utf-8") as output:
        output.write("term\n")
        output.flush()
        os.fsync(output.fileno())
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    time.sleep(0.2)
    with open(marker, "a", encoding="utf-8") as output:
        output.write("graceful\n")
    raise SystemExit(0)
signal.signal(signal.SIGTERM, handle_term)
with open(ready, "w", encoding="utf-8") as output:
    output.write("ready\n")
    output.flush()
    os.fsync(output.fileno())
while True:
    time.sleep(1)
"#;
        let mut command = Command::new("python3");
        command
            .args(["-c", code])
            .env("MARKER", &marker_file)
            .env("READY", &ready_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: the pre_exec closure runs after fork and calls only libc::setsid,
        // an async-signal-safe operation, then immediately captures errno on failure.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut root = command.spawn().expect("TERM handler root should spawn");
        let identity = match ManagedProcessIdentity::capture(root.id()) {
            Ok(identity) => identity,
            Err(error) => {
                kill_and_reap_spawned_root(&mut root);
                panic!("identity should capture: {error}");
            }
        };
        if !wait_for_file(&ready_file) {
            kill_and_reap_spawned_root(&mut root);
            panic!("TERM handler did not become ready");
        }

        terminate_managed_process_tree(&identity, Duration::from_secs(1))
            .await
            .expect("graceful TERM cleanup should succeed");
        let _ = root.try_wait();

        let markers = std::fs::read_to_string(&marker_file).expect("TERM markers should read");
        assert_eq!(markers, "term\ngraceful\n");
    }
    #[tokio::test]
    async fn start_identity_mismatch_refuses_to_signal_reused_pid() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let descendant_pid_file = temp_dir.path().join("descendant.pid");
        let (mut root, mut identity, _) = spawn_ready_forking_root(&descendant_pid_file);
        identity.root_start_time = identity.root_start_time.saturating_sub(1);

        let result = terminate_managed_process_tree(&identity, Duration::from_millis(10)).await;

        assert!(result.is_err());
        assert!(process_is_alive(
            i32::try_from(root.id()).expect("PID should fit")
        ));
        force_kill_unverified_spawn(root.id())
            .expect("mismatched identity process tree should accept SIGKILL");
        let _ = root.wait();
    }
}
