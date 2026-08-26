use crate::app_events::{
    AppEventBus, AppEventFrame, AppEventSubscription, InMemoryAppEventAdapter,
    RuntimeEventPublisher,
};
use crate::backend_runtime::AppHandle;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use base64::Engine;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

pub(super) struct ShellTestHarness {
    pub(super) manager: PtyManager,
    pub(super) temp_dir: TempDir,
    pub(super) pid_dir: PathBuf,
}

impl ShellTestHarness {
    pub(super) fn new() -> Self {
        let mut manager = PtyManager::new();
        let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_dir = temp_dir.path().join("pids");
        manager.set_pid_dir(pid_dir.clone());
        Self {
            manager,
            temp_dir,
            pid_dir,
        }
    }

    pub(super) async fn spawn_long_running(
        &self,
        task_id: &str,
        terminal_index: Option<u32>,
    ) -> Result<u64, PtyError> {
        self.spawn_with_publisher(
            task_id,
            terminal_index,
            RuntimeEventPublisher::new(None, None),
            long_running_shell_command(),
        )
        .await
    }

    pub(super) async fn spawn_with_publisher(
        &self,
        task_id: &str,
        terminal_index: Option<u32>,
        event_publisher: RuntimeEventPublisher,
        command: CommandBuilder,
    ) -> Result<u64, PtyError> {
        self.manager
            .spawn_shell_pty_with_command(
                PtySpawnContext {
                    task_id,
                    cwd: self.temp_dir.path(),
                    cols: 80,
                    rows: 24,
                    event_publisher,
                },
                terminal_index,
                None,
                command,
            )
            .await
    }
}

pub(super) fn long_running_shell_command() -> CommandBuilder {
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("exec sleep 30");
    command
}

pub(super) fn model_event_fixture() -> (RuntimeEventPublisher, AppEventSubscription) {
    let bus = AppEventBus::new(32, 8);
    let app = AppHandle::new();
    app.set_app_event_adapter(Arc::new(InMemoryAppEventAdapter::new(bus.clone())));
    let events = bus.subscribe(None).expect("event subscription should open");
    (RuntimeEventPublisher::new(Some(app), None), events)
}

pub(super) async fn wait_for_model_output(
    mut events: AppEventSubscription,
    session_key: String,
    instance_id: u64,
    expected: &'static [u8],
) {
    assert!(
        !expected.is_empty(),
        "expected model output must not be empty"
    );
    let output_event = format!("pty-model-output-{session_key}");
    let mut observed = Vec::with_capacity(expected.len().saturating_mul(2));
    loop {
        let AppEventFrame::Event(event) = events
            .recv()
            .await
            .expect("model event stream should stay open")
        else {
            continue;
        };
        if event.event_name != output_event || event.payload["instance_id"] != instance_id {
            continue;
        }
        let encoded = event.payload["data"]
            .as_str()
            .expect("model output should contain base64 data");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("model output should contain valid base64 data");
        observed.extend_from_slice(&bytes);
        if observed
            .windows(expected.len())
            .any(|window| window == expected)
        {
            return;
        }
        let retained = expected.len().saturating_sub(1);
        if observed.len() > retained {
            observed.drain(..observed.len() - retained);
        }
    }
}

pub(super) async fn wait_for_output(
    manager: &PtyManager,
    session_key: &str,
    expected: &str,
    timeout: Duration,
) {
    tokio::time::timeout(timeout, async {
        loop {
            if manager
                .get_pty_buffer(session_key)
                .await
                .is_some_and(|output| output.contains(expected))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("PTY output should contain {expected:?} before timeout"));
}

pub(super) async fn wait_for_model_shutdown(
    events: &mut AppEventSubscription,
    session_key: &str,
    instance_id: u64,
) {
    let disabled_event = format!("pty-model-disabled-{session_key}");
    let exit_event = format!("pty-exit-{session_key}");
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut disabled = false;
        let mut exited = false;
        while !disabled || !exited {
            let AppEventFrame::Event(event) =
                events.recv().await.expect("event stream should stay open")
            else {
                continue;
            };
            if event.payload["instance_id"] != instance_id {
                continue;
            }
            disabled |= event.event_name == disabled_event;
            exited |= event.event_name == exit_event;
        }
    })
    .await
    .expect("failed Ghostty model should disable and terminate its PTY");
}

pub(super) async fn wait_for_file_removal(path: &Path) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while path.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("failed model cleanup should remove the PTY identity file");
}
