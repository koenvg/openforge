use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use thiserror::Error;

pub(crate) const REVIEW_READ_ONLY: &str = "review-read-only";
const POLICY_HOOK_ARGUMENT: &str = "--openforge-session-policy-hook";
const SCOPED_LIFECYCLE_HOOK_SOURCE: &str = r#"
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
  let rawInput = '';
  for await (const chunk of process.stdin) rawInput += chunk;
  const eventType = process.argv[1];
  const sessionId = process.env.OPENFORGE_SCOPED_SESSION_ID;
  const instance = Number(process.env.OPENFORGE_PTY_INSTANCE_ID);
  const configPath = process.env.OPENFORGE_AGENT_CONFIG;
  const stateDir = process.env.CLAUDE_CONFIG_DIR;
  if (!sessionId || !Number.isSafeInteger(instance) || instance < 1 || !configPath || !stateDir) return;
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const turnPath = path.join(stateDir, '.openforge-turn-id');
  let turnId = null;
  if (eventType === 'user-prompt-submit') {
    let prompt = '';
    try {
      const hookInput = JSON.parse(rawInput);
      if (typeof hookInput.prompt === 'string') prompt = hookInput.prompt;
      else if (typeof hookInput.tool_input?.prompt === 'string') prompt = hookInput.tool_input.prompt;
    } catch {}
    const marker = /\n\n<!-- openforge-turn-id:([A-Za-z0-9._:-]{1,128}) -->\s*$/.exec(prompt);
    turnId = marker?.[1] || crypto.randomUUID();
    await fs.writeFile(turnPath, turnId, { mode: 0o600 });
  } else {
    try { turnId = (await fs.readFile(turnPath, 'utf8')).trim() || null; } catch {}
  }
  const response = await fetch(`http://127.0.0.1:${config.port}/hooks/scoped-agent-lifecycle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ eventType, ptyInstanceId: instance, turnId }),
  });
  if (!response.ok) throw new Error('scoped lifecycle hook rejected');
})().catch(() => { console.error('[openforge] scoped lifecycle hook failed'); process.exitCode = 1; });
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionToolPolicy {
    ReviewReadOnly,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum SessionToolPolicyError {
    #[error("Unsupported Session Tool Policy {0:?}")]
    UnknownPolicy(String),
    #[error("Session Tool Policy {policy:?} does not support provider {provider:?}")]
    UnsupportedProvider { policy: String, provider: String },
    #[error("review-read-only requires the macOS process sandbox")]
    UnsupportedPlatform,
    #[error("Session Tool Policy settings failed: {0}")]
    Settings(String),
}

impl SessionToolPolicy {
    pub(crate) fn resolve(name: &str, provider: &str) -> Result<Self, SessionToolPolicyError> {
        let policy = match name {
            REVIEW_READ_ONLY => Self::ReviewReadOnly,
            _ => return Err(SessionToolPolicyError::UnknownPolicy(name.to_string())),
        };
        if provider != "claude-code" {
            return Err(SessionToolPolicyError::UnsupportedProvider {
                policy: name.to_string(),
                provider: provider.to_string(),
            });
        }
        if !cfg!(target_os = "macos") {
            return Err(SessionToolPolicyError::UnsupportedPlatform);
        }
        Ok(policy)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ToolDecision {
    Allow,
    Deny(String),
}

pub(crate) struct ReviewReadOnlyEnvironment {
    pub settings_path: PathBuf,
    pub provider_state_dir: PathBuf,
}

impl ToolDecision {
    fn hook_output(&self) -> Value {
        match self {
            Self::Allow => json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }),
            Self::Deny(reason) => json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason
                }
            }),
        }
    }
}

pub(crate) fn authorize_review_read_only(tool_name: &str, tool_input: &Value) -> ToolDecision {
    match tool_name {
        "Read" | "Grep" | "Glob" => ToolDecision::Allow,
        "Bash" => tool_input
            .get("command")
            .and_then(Value::as_str)
            .map(authorize_shell_command)
            .unwrap_or_else(|| ToolDecision::Deny("Bash command is missing".to_string())),
        _ => ToolDecision::Deny(format!(
            "Tool {tool_name:?} is not allowed by review-read-only"
        )),
    }
}

fn authorize_shell_command(command: &str) -> ToolDecision {
    if command.is_empty() || contains_active_shell_syntax(command) {
        return ToolDecision::Deny("Shell operators and expansion are forbidden".to_string());
    }
    let tokens = match shell_words::split(command) {
        Ok(tokens) if !tokens.is_empty() => tokens,
        _ => return ToolDecision::Deny("Malformed shell command".to_string()),
    };
    match tokens[0].as_str() {
        "git" => authorize_git(&tokens[1..]),
        "openforge" => authorize_openforge(&tokens[1..]),
        _ => ToolDecision::Deny("Command is outside the read-only allowlist".to_string()),
    }
}

fn contains_active_shell_syntax(command: &str) -> bool {
    #[derive(Clone, Copy)]
    enum Quote {
        None,
        Single,
        Double,
    }
    let mut quote = Quote::None;
    let mut escaped = false;
    for character in command.chars() {
        if matches!(character, '\n' | '\r') {
            return true;
        }
        match quote {
            Quote::Single => {
                if character == '\'' {
                    quote = Quote::None;
                }
            }
            Quote::Double => {
                if escaped {
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quote = Quote::None;
                } else if matches!(character, '$' | '`') {
                    return true;
                }
            }
            Quote::None => {
                if escaped {
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '\'' {
                    quote = Quote::Single;
                } else if character == '"' {
                    quote = Quote::Double;
                } else if matches!(character, ';' | '|' | '&' | '>' | '<' | '`' | '$') {
                    return true;
                }
            }
        }
    }
    escaped || !matches!(quote, Quote::None)
}

fn authorize_git(arguments: &[String]) -> ToolDecision {
    let Some(subcommand) = arguments.first() else {
        return ToolDecision::Deny("Git subcommand is required".to_string());
    };
    if !matches!(
        subcommand.as_str(),
        "blame" | "diff" | "log" | "ls-files" | "rev-parse" | "show" | "status"
    ) {
        return ToolDecision::Deny("Git subcommand is not read-only".to_string());
    }
    const FORBIDDEN: &[&str] = &[
        "-c",
        "--config-env",
        "--exec-path",
        "--ext-diff",
        "--output",
        "--textconv",
    ];
    if arguments.iter().skip(1).any(|argument| {
        FORBIDDEN.iter().any(|forbidden| {
            argument == forbidden || argument.starts_with(&format!("{forbidden}="))
        })
    }) {
        return ToolDecision::Deny("Dangerous Git option is forbidden".to_string());
    }
    ToolDecision::Allow
}

fn authorize_openforge(arguments: &[String]) -> ToolDecision {
    if arguments.len() >= 3
        && arguments[0] == "review"
        && arguments[1] == "thread"
        && matches!(
            arguments[2].as_str(),
            "list" | "create" | "reply" | "status"
        )
    {
        return ToolDecision::Allow;
    }
    if arguments.len() == 7
        && arguments[0] == "plugin"
        && arguments[1] == "command"
        && arguments[2] == "invoke"
        && arguments[3] == "--command-id"
        && arguments[4] == "com.openforge.github-sync.submit-walkthrough-step"
        && arguments[5] == "--input"
        && serde_json::from_str::<Value>(&arguments[6]).is_ok()
    {
        return ToolDecision::Allow;
    }
    ToolDecision::Deny(
        "Only Review Thread commands and walkthrough step submission are allowed".to_string(),
    )
}

pub(crate) fn generate_review_read_only_settings(
    directory: &Path,
) -> Result<ReviewReadOnlyEnvironment, SessionToolPolicyError> {
    fs::create_dir_all(directory).map_err(|error| {
        SessionToolPolicyError::Settings(format!("create private directory: {error}"))
    })?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(|error| {
        SessionToolPolicyError::Settings(format!("secure private directory: {error}"))
    })?;
    let executable = std::env::current_exe().map_err(|error| {
        SessionToolPolicyError::Settings(format!("resolve policy hook executable: {error}"))
    })?;
    let command = format!(
        "{} {}",
        shell_words::quote(&executable.to_string_lossy()),
        POLICY_HOOK_ARGUMENT
    );
    let lifecycle_command = |event: &str| {
        format!(
            "node -e {} {}",
            shell_words::quote(SCOPED_LIFECYCLE_HOOK_SOURCE),
            shell_words::quote(event)
        )
    };
    let settings = json!({
        "permissions": {
            "allow": ["Read", "Grep", "Glob", "Bash"],
            "deny": ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "WebFetch", "WebSearch"]
        },
        "hooks": {
            "UserPromptSubmit": [{
                "hooks": [{"type": "command", "command": lifecycle_command("user-prompt-submit")}]
            }],
            "Stop": [{
                "hooks": [{"type": "command", "command": lifecycle_command("stop")}]
            }],
            "SessionEnd": [{
                "hooks": [{"type": "command", "command": lifecycle_command("session-end")}]
            }],
            "PreToolUse": [{
                "matcher": "*",
                "hooks": [{"type": "command", "command": command}]
            }]
        }
    });
    let path = directory.join("claude-review-read-only.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)
        .map_err(|error| SessionToolPolicyError::Settings(error.to_string()))?;
    serde_json::to_writer_pretty(&mut file, &settings)
        .map_err(|error| SessionToolPolicyError::Settings(error.to_string()))?;
    file.flush()
        .map_err(|error| SessionToolPolicyError::Settings(error.to_string()))?;
    let provider_state_dir = directory.join("provider-state");
    fs::create_dir_all(provider_state_dir.join("tmp")).map_err(|error| {
        SessionToolPolicyError::Settings(format!("create provider state directory: {error}"))
    })?;
    fs::set_permissions(&provider_state_dir, fs::Permissions::from_mode(0o700)).map_err(
        |error| {
            SessionToolPolicyError::Settings(format!("secure provider state directory: {error}"))
        },
    )?;
    fs::set_permissions(
        provider_state_dir.join("tmp"),
        fs::Permissions::from_mode(0o700),
    )
    .map_err(|error| {
        SessionToolPolicyError::Settings(format!("secure provider temp directory: {error}"))
    })?;
    Ok(ReviewReadOnlyEnvironment {
        settings_path: path,
        provider_state_dir,
    })
}

pub(crate) fn run_policy_hook_if_requested() -> Option<i32> {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(POLICY_HOOK_ARGUMENT)) {
        return None;
    }
    let result = run_policy_hook(&mut io::stdin(), &mut io::stdout());
    Some(if result.is_ok() { 0 } else { 2 })
}

fn run_policy_hook(input: &mut dyn Read, output: &mut dyn Write) -> Result<(), String> {
    let payload: Value = serde_json::from_reader(input)
        .map_err(|error| format!("invalid policy hook payload: {error}"))?;
    let tool_name = payload
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let tool_input = payload.get("tool_input").unwrap_or(&Value::Null);
    serde_json::to_writer(
        output,
        &authorize_review_read_only(tool_name, tool_input).hook_output(),
    )
    .map_err(|error| format!("write policy hook decision: {error}"))
}

pub(crate) fn macos_sandbox_profile(
    workspace: &Path,
    provider_state_dir: &Path,
) -> Result<String, SessionToolPolicyError> {
    let workspace = fs::canonicalize(workspace)
        .map_err(|error| SessionToolPolicyError::Settings(error.to_string()))?;
    let provider_state_dir = fs::canonicalize(provider_state_dir)
        .map_err(|error| SessionToolPolicyError::Settings(error.to_string()))?;
    if provider_state_dir.starts_with(&workspace) || workspace.starts_with(&provider_state_dir) {
        return Err(SessionToolPolicyError::Settings(
            "provider state and Scoped Workspace must be separate".to_string(),
        ));
    }
    let escaped_state = provider_state_dir
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    Ok(format!(
        "(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath \"{escaped_state}\"))\n(allow file-write-data file-ioctl (subpath \"/dev\"))\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_never_overrides_a_denied_mutation() {
        for approved in [false, true] {
            let decision = authorize_review_read_only(
                "Write",
                &json!({"file_path": "/workspace/changed", "approved": approved}),
            );
            assert!(matches!(decision, ToolDecision::Deny(_)));
        }
    }

    #[test]
    fn shell_policy_is_a_closed_read_only_grammar() {
        for command in [
            "git log --oneline -20",
            "git show HEAD:README.md",
            "git blame src/main.rs",
            "openforge review thread list --namespace github-pr",
        ] {
            assert_eq!(
                authorize_review_read_only("Bash", &json!({"command": command})),
                ToolDecision::Allow,
                "{command}"
            );
        }
        for command in [
            "touch changed",
            "git log; touch changed",
            "git log $(touch changed)",
            "git log `touch changed`",
            "git diff > patch",
            "git -c alias.log='!touch changed' log",
            "git show --output=changed HEAD",
            "bash -c 'git log'",
            "openforge task update T-1",
        ] {
            assert!(
                matches!(
                    authorize_review_read_only("Bash", &json!({"command": command})),
                    ToolDecision::Deny(_)
                ),
                "{command}"
            );
        }
    }

    #[test]
    fn review_read_only_allows_only_the_walkthrough_plugin_command() {
        let accepted = json!({
            "command": "openforge plugin command invoke --command-id com.openforge.github-sync.submit-walkthrough-step --input '{\"attemptId\":\"attempt-1\",\"summary\":\"cost $5; compare a < b & c > d\"}'"
        });
        assert_eq!(
            authorize_review_read_only("Bash", &accepted),
            ToolDecision::Allow
        );

        for command in [
            "openforge plugin command invoke --command-id com.openforge.github-sync.other --input '{}'",
            "openforge plugin command invoke --command-id com.example.submit-walkthrough-step --input '{}'",
            "openforge plugin command invoke --command-id com.openforge.github-sync.submit-walkthrough-step --project-id P-2 --input '{}'",
            "openforge plugin command invoke --input '{}' --command-id com.openforge.github-sync.submit-walkthrough-step",
            "openforge plugin command invoke --command-id com.openforge.github-sync.submit-walkthrough-step; touch /tmp/escape",
        ] {
            assert!(matches!(
                authorize_review_read_only("Bash", &json!({ "command": command })),
                ToolDecision::Deny(_)
            ));
        }
    }

    #[test]
    fn unknown_tools_and_policies_fail_closed() {
        assert!(matches!(
            authorize_review_read_only("FutureMutationTool", &json!({})),
            ToolDecision::Deny(_)
        ));
        assert_eq!(
            SessionToolPolicy::resolve("caller-supplied", "claude-code"),
            Err(SessionToolPolicyError::UnknownPolicy(
                "caller-supplied".to_string()
            ))
        );
    }

    #[test]
    fn generated_settings_keep_the_final_hook_and_immutable_denies() {
        let root = tempfile::tempdir().expect("settings root");
        let environment = generate_review_read_only_settings(root.path()).expect("settings");
        let settings: Value =
            serde_json::from_slice(&fs::read(environment.settings_path).expect("read settings"))
                .expect("JSON");
        assert_eq!(settings["hooks"]["PreToolUse"][0]["matcher"], "*");
        for lifecycle in ["UserPromptSubmit", "Stop", "SessionEnd"] {
            let command = settings["hooks"][lifecycle][0]["hooks"][0]["command"]
                .as_str()
                .expect("lifecycle command");
            assert!(
                command.contains("OPENFORGE_SCOPED_SESSION_ID"),
                "{lifecycle}: {command}"
            );
            assert!(
                command.contains("scoped-agent-lifecycle"),
                "{lifecycle}: {command}"
            );
            if lifecycle == "UserPromptSubmit" {
                assert!(
                    command.contains("openforge-turn-id"),
                    "{lifecycle}: {command}"
                );
                assert!(
                    command.contains("crypto.randomUUID"),
                    "{lifecycle}: {command}"
                );
            }
        }
        assert!(settings["permissions"]["deny"]
            .as_array()
            .expect("deny list")
            .contains(&json!("NotebookEdit")));
    }

    #[test]
    fn hook_returns_deny_even_when_payload_claims_approval() {
        let mut input = br#"{"tool_name":"Edit","tool_input":{"approved":true}}"#.as_slice();
        let mut output = Vec::new();
        run_policy_hook(&mut input, &mut output).expect("hook");
        let response: Value = serde_json::from_slice(&output).expect("response");
        assert_eq!(response["hookSpecificOutput"]["permissionDecision"], "deny");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn os_sandbox_allows_only_private_provider_state_writes() {
        let workspace = tempfile::tempdir().expect("workspace");
        let policy = tempfile::tempdir().expect("policy");
        let environment = generate_review_read_only_settings(policy.path()).expect("environment");
        let outside = tempfile::tempdir().expect("outside");
        let profile = macos_sandbox_profile(workspace.path(), &environment.provider_state_dir)
            .expect("profile");
        let workspace_target = workspace.path().join("direct-shell-write");
        let outside_target = outside.path().join("symlink-target");
        std::os::unix::fs::symlink(&outside_target, workspace.path().join("escape"))
            .expect("workspace symlink");

        for target in [
            &workspace_target,
            &outside_target,
            &workspace.path().join("escape"),
        ] {
            let status = std::process::Command::new("/usr/bin/sandbox-exec")
                .args(["-p", &profile, "/usr/bin/touch"])
                .arg(target)
                .status()
                .expect("run sandbox");
            assert!(
                !status.success(),
                "write unexpectedly succeeded: {target:?}"
            );
        }
        let allowed = environment.provider_state_dir.join("session-state");
        assert!(std::process::Command::new("/usr/bin/sandbox-exec")
            .args(["-p", &profile, "/usr/bin/touch"])
            .arg(&allowed)
            .status()
            .expect("run sandbox")
            .success());
        assert!(!workspace_target.exists());
        assert!(!outside_target.exists());
        assert!(allowed.exists());
    }
}
