use super::*;
use openforge_session_host::{DaemonLifetimeId, InstallationId, PreparedCommand, PtyInstanceId, TerminalOwner};
use std::collections::BTreeMap;

#[test]
fn abandoned_restore_does_not_consume_output_close_the_master_or_kill_the_serving_child() {
    let root = tempfile::tempdir().unwrap();
    let command = ShellCommand {
        owner: TerminalOwner::Shell { task_id: "checkpoint".into(), index: Some(2) },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf 'READY\\n'; while IFS= read -r value; do printf 'VALUE:%s\\n' \"$value\"; done".into()],
            cwd: root.path().into(), env: BTreeMap::new(),
        },
        columns: 80, rows: 24, image_protocol: None,
    };
    let pty = PtyIdentity {
        installation: InstallationId::parse("checkpoint-installation").unwrap(),
        lifetime: DaemonLifetimeId::parse("checkpoint-lifetime").unwrap(),
        instance: PtyInstanceId::new(1).unwrap(),
    };
    let journal = SharedJournal::default();
    let mut process = Process::spawn(&command, pty, Arc::clone(&journal)).unwrap();
    wait_for_text(&process, b"READY");
    let pid = process.pid();
    let pause = process.pause().unwrap();
    let before = process.recover(0).unwrap();
    let checkpoint = process.checkpoint(&pause).unwrap();
    let checkpoint = serde_json::from_slice(&serde_json::to_vec(&checkpoint).unwrap()).unwrap();
    let restored = Process::restore(checkpoint, journal).unwrap();
    assert_eq!(restored.pid(), pid);
    assert_eq!(serde_json::to_value(restored.recover(0).unwrap()).unwrap(), serde_json::to_value(before).unwrap());
    drop(restored);
    drop(pause);
    process.operate(&IoAction::Write(b"still-alive\n".to_vec())).unwrap();
    wait_for_text(&process, b"VALUE:still-alive");
    process.terminate().unwrap();
    drop(process);
    // SAFETY: signal zero only queries existence of the known test-owned PID.
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
}

fn wait_for_text(process: &Process, text: &[u8]) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if process.recover(0).is_ok_and(|snapshot| snapshot.portable_vt.windows(text.len()).any(|window| window == text)) {
            return;
        }
        assert!(Instant::now() < deadline, "test PTY did not produce expected text");
        std::thread::sleep(Duration::from_millis(5));
    }
}
