use crate::user_environment::{agent_environment, find_tool_on_path};
use std::{
    collections::HashMap,
    fmt,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use thiserror::Error;

const TASK_ONLY_ENVIRONMENT_KEYS: &[&str] = &[
    "CLAUDE_TASK_ID",
    "OPENFORGE_AGENT_CONFIG",
    "OPENFORGE_AGENT_TOKEN",
    "OPENFORGE_BACKEND_TOKEN",
    "OPENFORGE_TASK_ID",
];

#[derive(Clone)]
pub(crate) struct ClaudeLaunchContext {
    executable: PathBuf,
    environment: HashMap<String, String>,
}

impl ClaudeLaunchContext {
    pub(crate) fn executable(&self) -> &Path {
        &self.executable
    }

    pub(crate) fn environment(&self) -> &HashMap<String, String> {
        &self.environment
    }

    pub(crate) fn home_dir(&self) -> Result<PathBuf, ClaudeLaunchContextError> {
        self.environment
            .get("HOME")
            .filter(|home| !home.is_empty())
            .map(PathBuf::from)
            .ok_or(ClaudeLaunchContextError::HomeUnavailable)
    }

    pub(crate) fn provider_state_paths(&self) -> Result<Vec<PathBuf>, ClaudeLaunchContextError> {
        if let Some(config_dir) = self
            .environment
            .get("CLAUDE_CONFIG_DIR")
            .filter(|path| !path.is_empty())
        {
            return Ok(vec![PathBuf::from(config_dir)]);
        }
        let home = self.home_dir()?;
        Ok(vec![home.join(".claude"), home.join(".claude.json")])
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        executable: impl Into<PathBuf>,
        environment: HashMap<String, String>,
    ) -> Self {
        Self {
            executable: executable.into(),
            environment,
        }
    }
}

impl fmt::Debug for ClaudeLaunchContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut environment_keys = self.environment.keys().collect::<Vec<_>>();
        environment_keys.sort_unstable();
        formatter
            .debug_struct("ClaudeLaunchContext")
            .field("executable", &self.executable)
            .field("environment_keys", &environment_keys)
            .finish()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ClaudeLaunchContextError {
    #[error("Claude executable is unavailable in the normal Agent Session environment")]
    ExecutableUnavailable,
    #[error("The normal Agent Session environment has no usable HOME directory")]
    HomeUnavailable,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ClaudeAuthenticationError {
    #[error(
        "Claude authentication is unavailable; authenticate Claude Code for normal Agent Sessions"
    )]
    Unavailable,
    #[error("Claude authentication check timed out")]
    TimedOut,
}

pub(crate) fn resolve_current_scoped_claude_launch_context(
) -> Result<ClaudeLaunchContext, ClaudeLaunchContextError> {
    resolve_scoped_claude_launch_context(agent_environment())
}

fn resolve_scoped_claude_launch_context(
    mut environment: HashMap<String, String>,
) -> Result<ClaudeLaunchContext, ClaudeLaunchContextError> {
    for key in TASK_ONLY_ENVIRONMENT_KEYS {
        environment.remove(*key);
    }
    let executable = environment
        .get("PATH")
        .and_then(|path| find_tool_on_path("claude", path))
        .ok_or(ClaudeLaunchContextError::ExecutableUnavailable)?;
    Ok(ClaudeLaunchContext {
        executable,
        environment,
    })
}

pub(crate) async fn verify_claude_authentication(
    context: &ClaudeLaunchContext,
    timeout: Duration,
) -> Result<(), ClaudeAuthenticationError> {
    let mut command = tokio::process::Command::new(context.executable());
    command
        .args(["auth", "status"])
        .env_clear()
        .envs(context.environment())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    match tokio::time::timeout(timeout, command.status()).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(_)) | Ok(Err(_)) => Err(ClaudeAuthenticationError::Unavailable),
        Err(_) => Err(ClaudeAuthenticationError::TimedOut),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::os::unix::fs::PermissionsExt;

    fn write_executable(path: &std::path::Path) {
        std::fs::write(path, "#!/bin/sh\nexit 0\n").expect("write fake Claude");
        let mut permissions = std::fs::metadata(path)
            .expect("fake Claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("make fake Claude executable");
    }

    #[test]
    fn scoped_claude_launch_context_matches_the_normal_user_environment_without_task_credentials() {
        let bin = tempfile::tempdir().expect("temporary bin");
        let executable = bin.path().join("claude");
        write_executable(&executable);
        let secret_values = [
            "anthropic-secret",
            "oauth-secret",
            "aws-secret",
            "vertex-secret",
            "openforge-task-secret",
        ];
        let environment = HashMap::from([
            (
                "PATH".to_string(),
                bin.path().to_string_lossy().into_owned(),
            ),
            ("HOME".to_string(), "/Users/test".to_string()),
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                "/Users/test/custom-claude".to_string(),
            ),
            (
                "ANTHROPIC_API_KEY".to_string(),
                secret_values[0].to_string(),
            ),
            (
                "CLAUDE_CODE_OAUTH_TOKEN".to_string(),
                secret_values[1].to_string(),
            ),
            (
                "AWS_SECRET_ACCESS_KEY".to_string(),
                secret_values[2].to_string(),
            ),
            (
                "GOOGLE_APPLICATION_CREDENTIALS".to_string(),
                secret_values[3].to_string(),
            ),
            (
                "OPENFORGE_AGENT_TOKEN".to_string(),
                secret_values[4].to_string(),
            ),
            ("OPENFORGE_TASK_ID".to_string(), "task-1".to_string()),
            ("CLAUDE_TASK_ID".to_string(), "task-1".to_string()),
        ]);

        let context = resolve_scoped_claude_launch_context(environment).expect("launch context");

        assert_eq!(context.executable(), executable);
        assert_eq!(
            context.environment().get("HOME").map(String::as_str),
            Some("/Users/test")
        );
        assert_eq!(
            context
                .environment()
                .get("CLAUDE_CONFIG_DIR")
                .map(String::as_str),
            Some("/Users/test/custom-claude")
        );
        for key in [
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
        ] {
            assert!(context.environment().contains_key(key), "missing {key}");
        }
        for key in [
            "OPENFORGE_AGENT_CONFIG",
            "OPENFORGE_AGENT_TOKEN",
            "OPENFORGE_BACKEND_TOKEN",
            "OPENFORGE_TASK_ID",
            "CLAUDE_TASK_ID",
        ] {
            assert!(!context.environment().contains_key(key), "retained {key}");
        }

        let diagnostic = format!("{context:?}");
        for secret in secret_values {
            assert!(
                !diagnostic.contains(secret),
                "debug output exposed {secret}"
            );
        }
    }

    #[test]
    fn launch_context_errors_do_not_include_environment_values() {
        let secret = "credential-that-must-stay-private";
        let result = resolve_scoped_claude_launch_context(HashMap::from([
            ("PATH".to_string(), "/missing".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), secret.to_string()),
        ]));

        let error = result.expect_err("missing Claude should fail");
        assert_eq!(error, ClaudeLaunchContextError::ExecutableUnavailable);
        assert!(!error.to_string().contains(secret));
        assert!(!format!("{error:?}").contains(secret));
    }

    #[tokio::test]
    async fn authentication_probe_uses_the_resolved_environment_and_discards_output() {
        let bin = tempfile::tempdir().expect("temporary bin");
        let executable = bin.path().join("claude");
        std::fs::write(
            &executable,
            "#!/bin/sh\n[ \"$1\" = auth ] || exit 10\n[ \"$2\" = status ] || exit 11\n[ \"$HOME\" = /Users/test ] || exit 12\n[ \"$CLAUDE_CONFIG_DIR\" = /Users/test/custom-claude ] || exit 13\nprintf 'account@example.com\\n'\nprintf 'sensitive-provider-detail\\n' >&2\n",
        )
        .expect("write fake Claude");
        let mut permissions = std::fs::metadata(&executable)
            .expect("fake Claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("make fake Claude executable");
        let context = resolve_scoped_claude_launch_context(HashMap::from([
            (
                "PATH".to_string(),
                bin.path().to_string_lossy().into_owned(),
            ),
            ("HOME".to_string(), "/Users/test".to_string()),
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                "/Users/test/custom-claude".to_string(),
            ),
        ]))
        .expect("launch context");

        verify_claude_authentication(&context, std::time::Duration::from_secs(1))
            .await
            .expect("authenticated context");
    }

    #[tokio::test]
    async fn authentication_probe_rejects_an_unauthenticated_context() {
        let bin = tempfile::tempdir().expect("temporary bin");
        let executable = bin.path().join("claude");
        std::fs::write(&executable, "#!/bin/sh\nexit 1\n").expect("write fake Claude");
        let mut permissions = std::fs::metadata(&executable)
            .expect("fake Claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("make fake Claude executable");
        let context = resolve_scoped_claude_launch_context(HashMap::from([(
            "PATH".to_string(),
            bin.path().to_string_lossy().into_owned(),
        )]))
        .expect("launch context");

        assert_eq!(
            verify_claude_authentication(&context, std::time::Duration::from_secs(1)).await,
            Err(ClaudeAuthenticationError::Unavailable)
        );
    }

    #[tokio::test]
    async fn authentication_probe_times_out_without_waiting_for_the_provider() {
        let bin = tempfile::tempdir().expect("temporary bin");
        let executable = bin.path().join("claude");
        std::fs::write(&executable, "#!/bin/sh\nsleep 5\n").expect("write fake Claude");
        let mut permissions = std::fs::metadata(&executable)
            .expect("fake Claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("make fake Claude executable");
        let context = resolve_scoped_claude_launch_context(HashMap::from([(
            "PATH".to_string(),
            format!("{}:/bin", bin.path().display()),
        )]))
        .expect("launch context");
        let started = std::time::Instant::now();

        assert_eq!(
            verify_claude_authentication(&context, std::time::Duration::from_millis(25)).await,
            Err(ClaudeAuthenticationError::TimedOut)
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[tokio::test]
    async fn authenticated_fake_claude_shares_login_but_keeps_conversations_distinct() {
        let root = tempfile::tempdir().expect("fixture root");
        let bin = root.path().join("bin");
        let config = root.path().join("claude-config");
        std::fs::create_dir_all(&bin).expect("fixture bin");
        std::fs::create_dir_all(config.join("conversations")).expect("conversation directory");
        std::fs::write(config.join("authenticated"), "signed-in").expect("fake login");
        let executable = bin.join("claude");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
if [ "$1" = auth ] && [ "$2" = status ]; then
  [ -n "$ANTHROPIC_API_KEY" ] && [ -f "$CLAUDE_CONFIG_DIR/authenticated" ]
  exit $?
fi
if [ ! -f "$CLAUDE_CONFIG_DIR/authenticated" ]; then
  touch "$CLAUDE_CONFIG_DIR/onboarding"
  exit 20
fi
mode=new
conversation=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session-id) conversation="$2"; shift 2 ;;
    --resume) mode=resume; conversation="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$conversation" ] || exit 21
state="$CLAUDE_CONFIG_DIR/conversations/$conversation"
if [ "$mode" = resume ] && [ ! -f "$state" ]; then exit 22; fi
printf '%s\n' "$ANTHROPIC_API_KEY" >> "$state"
"#,
        )
        .expect("write fake Claude");
        let mut permissions = std::fs::metadata(&executable)
            .expect("fake Claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("make fake Claude executable");
        let normal_environment = HashMap::from([
            (
                "PATH".to_string(),
                format!("{}:/usr/bin:/bin", bin.display()),
            ),
            (
                "HOME".to_string(),
                root.path().to_string_lossy().into_owned(),
            ),
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                config.to_string_lossy().into_owned(),
            ),
            (
                "ANTHROPIC_API_KEY".to_string(),
                "fake-provider-auth".to_string(),
            ),
            ("OPENFORGE_AGENT_TOKEN".to_string(), "task-only".to_string()),
        ]);
        let scoped_context =
            resolve_scoped_claude_launch_context(normal_environment.clone()).expect("context");
        verify_claude_authentication(&scoped_context, Duration::from_secs(1))
            .await
            .expect("fake Claude is authenticated");

        async fn run_fake(
            executable: &Path,
            environment: &HashMap<String, String>,
            args: &[String],
        ) -> std::process::ExitStatus {
            tokio::process::Command::new(executable)
                .args(args)
                .env_clear()
                .envs(environment)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .expect("run fake Claude")
        }

        let normal_args = crate::pty_manager::build_claude_args(
            "normal turn",
            Some("normal-conversation"),
            false,
            &root.path().join("normal-settings.json"),
            None,
        );
        std::fs::write(config.join("conversations/normal-conversation"), "")
            .expect("existing normal conversation");
        let scoped_a = crate::pty_manager::build_scoped_claude_args(
            "review A",
            "scoped-a",
            false,
            &root.path().join("scoped-settings.json"),
            "(version 1)",
            &executable,
        );
        let scoped_b = crate::pty_manager::build_scoped_claude_args(
            "review B",
            "scoped-b",
            false,
            &root.path().join("scoped-settings.json"),
            "(version 1)",
            &executable,
        );
        let normal = run_fake(&executable, &normal_environment, &normal_args);
        let first = run_fake(&executable, scoped_context.environment(), &scoped_a[3..]);
        let second = run_fake(&executable, scoped_context.environment(), &scoped_b[3..]);
        let (normal_status, first_status, second_status) = tokio::join!(normal, first, second);
        assert!(normal_status.success());
        assert!(first_status.success());
        assert!(second_status.success());

        let resume_a = crate::pty_manager::build_scoped_claude_args(
            "continue A",
            "scoped-a",
            true,
            &root.path().join("scoped-settings.json"),
            "(version 1)",
            &executable,
        );
        assert!(
            run_fake(&executable, scoped_context.environment(), &resume_a[3..])
                .await
                .success()
        );

        assert!(!config.join("onboarding").exists());
        assert_eq!(
            std::fs::read_to_string(config.join("conversations/normal-conversation")).unwrap(),
            "fake-provider-auth\n"
        );
        assert_eq!(
            std::fs::read_to_string(config.join("conversations/scoped-a")).unwrap(),
            "fake-provider-auth\nfake-provider-auth\n"
        );
        assert_eq!(
            std::fs::read_to_string(config.join("conversations/scoped-b")).unwrap(),
            "fake-provider-auth\n"
        );
    }
}
