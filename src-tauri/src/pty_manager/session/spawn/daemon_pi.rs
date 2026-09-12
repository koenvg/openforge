//! Pi command preparation stays in the Sidecar; no PTY handles cross this boundary.
use super::super::provider_adapter::{AgentPtyProviderAdapter, PiPtyAdapter};
use super::process::resolve_pty_cwd;
use crate::pty_manager::{
    daemon_shells::DaemonShells, terminal_environment, PtyError, PtyManager, PtySpawnContext,
    TerminalImageProtocol,
};
use openforge_session_protocol::{PreparedCommand, ShellCommand, TerminalOwner};

impl PtyManager {
    pub(super) async fn spawn_daemon_pi(
        &self,
        bridge: DaemonShells,
        mut adapter: PiPtyAdapter,
        context: PtySpawnContext<'_>,
        image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        let cwd = resolve_pty_cwd(context.cwd)?;
        adapter.prepare(&cwd)?;
        let mut env: std::collections::BTreeMap<String, String> = std::env::vars().collect();
        env.extend(crate::user_environment::user_environment());
        #[cfg(test)]
        env.extend(self.test_environment.clone());
        env.insert("PWD".into(), cwd.to_string_lossy().into_owned());
        env.extend(
            terminal_environment(image_protocol)
                .into_iter()
                .map(|(key, value)| (key.into(), value.into())),
        );
        // The daemon replaces the placeholder with its allocated instance before exec.
        env.extend(adapter.extra_env(context.task_id, 0));
        bridge
            .spawn(
                ShellCommand {
                    owner: TerminalOwner::Agent {
                        task_id: context.task_id.into(),
                    },
                    command: PreparedCommand {
                        program: adapter.command_name().into(),
                        args: adapter.command_args(),
                        cwd,
                        env,
                    },
                    columns: context.cols,
                    rows: context.rows,
                    image_protocol,
                },
                context.event_publisher,
            )
            .await
            .map_err(PtyError::SpawnFailed)
    }
}
