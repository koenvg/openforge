use super::*;
use crate::user_environment::user_environment;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

async fn write_test_session_metadata(manager: &PtyManager, session_key: &str, pid_file: &Path) {
    let identity = manager
        .sessions
        .lock()
        .await
        .get(session_key)
        .expect("test session should exist")
        .managed_process
        .clone();
    write_managed_process_identity(pid_file, &identity)
        .expect("test process metadata should write");
}

fn test_pty_session(kind: PtySessionKind, pid_file_name: String) -> PtySession {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).expect("openpty should succeed");

    let shell = get_shell_path();
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-lc");
    cmd.arg("sleep 30");
    let child = pair
        .slave
        .spawn_command(cmd)
        .expect("spawn command should succeed");
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .expect("take writer should succeed");

    PtySession {
        managed_process: ManagedProcessIdentity::capture(
            child.process_id().expect("test child PID"),
        )
        .expect("test process identity"),
        child,
        master: pair.master,
        writer: ordered_writer::OrderedPtyWriter::start("test-session".to_string(), 1, writer)
            .expect("ordered test writer should start"),
        instance_id: 1,
        authority: authority::TerminalAuthorityContract::xterm_authoritative(),
        kind,
        pid_file_name,
        shadow_model: None,
    }
}

fn test_agent_pty_session(task_id: &str) -> PtySession {
    test_pty_session(PtySessionKind::Agent, format!("{}-pty.pid", task_id))
}

fn test_shell_pty_session(task_id: &str, terminal_index: u32) -> PtySession {
    test_pty_session(
        PtySessionKind::Shell {
            task_id: task_id.to_string(),
        },
        shell_pid_file_name(task_id, Some(terminal_index)),
    )
}

mod command_building;
mod event_emitter;
mod lifecycle;
mod manager;
mod output_processing;
mod pid_cleanup;
