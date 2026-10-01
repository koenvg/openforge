use super::*;
use openforge_session_host::{
    DaemonLifetimeId, InstallationId, PreparedCommand, PtyInstanceId, TerminalOwner,
};
use std::collections::BTreeMap;

fn spawn(script: &str) -> (Process, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "reader".into(),
            index: Some(1),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            cwd: root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let pty = PtyIdentity {
        installation: InstallationId::parse("reader-installation").unwrap(),
        lifetime: DaemonLifetimeId::parse("reader-lifetime").unwrap(),
        instance: PtyInstanceId::new(1).unwrap(),
    };
    let process = Process::spawn(
        &command,
        pty,
        SharedJournal::default(),
        TerminalColorProfile::default(),
    )
    .unwrap();
    (process, root)
}

fn wait_for_text(process: &Process, text: &[u8]) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !process.recover(0).is_ok_and(|snapshot| {
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

#[test]
fn a_stop_request_releases_a_reader_blocked_on_an_idle_pty() {
    let (mut process, _root) = spawn("printf 'READY\\n'; exec sleep 30");
    wait_for_text(&process, b"READY");
    process.reader.stop();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !process.reader_done.load(Ordering::Acquire) {
        assert!(Instant::now() < deadline, "stopped reader stayed blocked");
        std::thread::sleep(Duration::from_millis(5));
    }
    process.terminate().unwrap();
}

#[test]
fn input_that_overflows_the_pty_is_written_once_the_child_reads() {
    let (mut process, _root) = spawn(
        "stty raw -echo; printf 'READY\\n'; sleep 1; printf 'COUNT:%s\\n' $(head -c 65536 | wc -c)",
    );
    wait_for_text(&process, b"READY");
    let _ = process.operate(&IoAction::Write(vec![b'x'; 65536]));
    assert!(
        process.writer.lock().unwrap().has_pending(),
        "the PTY accepted all input without backpressure"
    );
    wait_for_text(&process, b"COUNT:65536");
    process.terminate().unwrap();
}

#[test]
fn a_pause_does_not_wait_for_a_reader_blocked_on_an_idle_pty() {
    let (process, root) = spawn(
        "printf 'READY\\n'; while [ ! -e go ]; do sleep 0.01; done; printf 'AFTER\\n'; exec sleep 30",
    );
    wait_for_text(&process, b"READY");
    let paused = process
        .reader_gate
        .pause(Duration::from_millis(200))
        .unwrap();
    std::fs::write(root.path().join("go"), "").unwrap();
    drop(paused);
    wait_for_text(&process, b"AFTER");
}
