use super::*;
use crate::user_environment::user_environment;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
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

fn test_pty_session(
    fixture: &mut test_fixture::NativePtyFixtureCleanup,
    kind: PtySessionKind,
    pid_file_name: String,
) -> PtySession {
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .expect("openpty should succeed");
    let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
    // Prepare fallible I/O before spawning a child that needs a reaper.
    let writer = Arc::new(
        ordered_writer::OrderedPtyWriter::start(
            "test-session".to_string(),
            instance_id,
            pair.master
                .take_writer()
                .expect("take writer should succeed"),
        )
        .expect("ordered test writer should start"),
    );
    let mut cmd = CommandBuilder::new(get_shell_path());
    cmd.arg("-lc");
    cmd.arg("sleep 30");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .expect("spawn command should succeed");
    drop(pair.slave);
    let managed_process = child
        .process_id()
        .ok_or_else(|| "test child did not expose a PID".to_string())
        .and_then(ManagedProcessIdentity::capture)
        .unwrap_or_else(|error| {
            // Only this just-spawned, in-memory child handle is owned here.
            let _ = child.kill();
            let _ = child.wait();
            panic!("test process identity: {error}");
        });
    fixture
        .retain_unpublished_session(PtySession {
            managed_process,
            child,
            master: Arc::new(std::sync::Mutex::new(pair.master)),
            writer,
            instance_id,
            kind,
            pid_file_name,
            terminal_model: None,
        })
        .expect("fixture must own the child before returning a session")
}

fn test_agent_pty_session(
    fixture: &mut test_fixture::NativePtyFixtureCleanup,
    task_id: &str,
) -> PtySession {
    test_pty_session(
        fixture,
        PtySessionKind::Agent,
        format!("{}-pty.pid", task_id),
    )
}

fn test_shell_pty_session(
    fixture: &mut test_fixture::NativePtyFixtureCleanup,
    task_id: &str,
    terminal_index: u32,
) -> PtySession {
    test_pty_session(
        fixture,
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
mod native_fixture;
mod output_processing;
mod pid_cleanup;
mod resize;
mod teardown_cancellation;
