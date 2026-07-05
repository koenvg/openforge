use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Get the HTTP server port used by local agent hooks.
///
/// Electron sidecar mode exposes its authenticated backend on
/// OPENFORGE_BACKEND_PORT, while legacy Tauri hooks use AI_COMMAND_CENTER_PORT.
/// Defaults to the shared OpenForge HTTP bridge port contract if neither is set or valid.
pub fn get_http_server_port() -> u16 {
    std::env::var("OPENFORGE_BACKEND_PORT")
        .or_else(|_| std::env::var("AI_COMMAND_CENTER_PORT"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT)
}

pub(crate) fn generate_hooks_settings_for_home(
    home: &Path,
    port: u16,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let settings_dir = home.join(".openforge");
    let settings_path = settings_dir.join("claude-hooks-settings.json");

    fs::create_dir_all(&settings_dir)?;

    let hooks_json = build_hooks_json(port);
    let json_string = serde_json::to_string_pretty(&hooks_json)?;

    fs::write(&settings_path, json_string)?;

    Ok(settings_path)
}

pub fn generate_hooks_settings(port: u16) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    generate_hooks_settings_for_home(&home, port)
}

/// Pre-approve workspace trust for a directory in ~/.claude.json.
/// This sets `hasTrustDialogAccepted: true` for the given path,
/// which is the same thing Claude does when the user clicks "Yes, proceed"
/// on the workspace trust dialog. Tool permissions are NOT affected —
/// the user still approves file edits and bash commands in the terminal.
pub fn ensure_workspace_trusted(cwd: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let claude_json_path = home.join(".claude.json");

    // Read existing ~/.claude.json or start with empty object
    let mut root: Value = if claude_json_path.exists() {
        let contents = std::fs::read_to_string(&claude_json_path)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let cwd_str = cwd.to_string_lossy().to_string();

    // Check if already trusted
    if let Some(project) = root.get(&cwd_str) {
        if project.get("hasTrustDialogAccepted") == Some(&json!(true)) {
            return Ok(()); // Already trusted, nothing to do
        }
    }

    // Ensure the project entry exists and set trust flag
    let projects = root.as_object_mut().ok_or("Invalid .claude.json format")?;
    if let Some(project) = projects.get_mut(&cwd_str) {
        if let Some(obj) = project.as_object_mut() {
            obj.insert("hasTrustDialogAccepted".to_string(), json!(true));
        }
    } else {
        projects.insert(
            cwd_str,
            json!({
                "hasTrustDialogAccepted": true
            }),
        );
    }

    std::fs::write(&claude_json_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

fn claude_lifecycle_kind_from_event(
    event_type: &str,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match event_type {
        "user-prompt-submit" | "pre-tool-use" | "post-tool-use" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy)
        }
        "stop" | "session-end" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended),
        "notification-permission" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::RequestedPermission)
        }
        "notification" => None,
        _ => None,
    }
}

fn lifecycle_hook_endpoint(event_type: &str) -> Option<&'static str> {
    match event_type {
        "user-prompt-submit" => Some("user-prompt-submit"),
        "pre-tool-use" => Some("pre-tool-use"),
        "post-tool-use" => Some("post-tool-use"),
        "stop" => Some("stop"),
        "session-end" => Some("session-end"),
        "notification-permission" => Some("notification-permission"),
        _ => None,
    }
}

fn lifecycle_hook_command(port: u16, event_type: &str, _include_tool_name: bool) -> String {
    let Some(_kind) = claude_lifecycle_kind_from_event(event_type) else {
        return String::new();
    };
    let Some(endpoint) = lifecycle_hook_endpoint(event_type) else {
        return String::new();
    };
    format!(
        "curl -s -o /dev/null -X POST 'http://127.0.0.1:{}/hooks/{}?task_id='\"$OPENFORGE_TASK_ID\"'&pty_instance_id='\"$OPENFORGE_PTY_INSTANCE_ID\"'&session_id='\"$CLAUDE_SESSION_ID\" -H 'Content-Type: application/json' --data-binary @- ",
        port, endpoint
    )
}

fn build_hooks_json(port: u16) -> Value {
    let user_prompt_submit_cmd = lifecycle_hook_command(port, "user-prompt-submit", false);
    let pre_tool_use_cmd = lifecycle_hook_command(port, "pre-tool-use", true);
    let post_tool_use_cmd = lifecycle_hook_command(port, "post-tool-use", true);
    let stop_cmd = lifecycle_hook_command(port, "stop", false);
    let session_end_cmd = lifecycle_hook_command(port, "session-end", false);
    let notification_permission_cmd =
        lifecycle_hook_command(port, "notification-permission", false);

    json!({
        "hooks": {
            "UserPromptSubmit": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": user_prompt_submit_cmd
                        }
                    ]
                }
            ],
            "PreToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": pre_tool_use_cmd
                        }
                    ]
                }
            ],
            "PostToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": post_tool_use_cmd
                        }
                    ]
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": stop_cmd
                        }
                    ]
                }
            ],
            "SessionEnd": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": session_end_cmd
                        }
                    ]
                }
            ],
            "Notification": [
                {
                    "matcher": "permission_prompt",
                    "hooks": [
                        {
                            "type": "command",
                            "command": notification_permission_cmd
                        }
                    ]
                }
            ]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::sync::{LazyLock, Mutex, MutexGuard};
    use tempfile::tempdir;

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct EnvVarGuard {
        key: &'static str,
        original: Option<OsString>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvVarGuard {
        fn set_to(key: &'static str, value: impl AsRef<OsStr>) -> Self {
            let lock = ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let original = std::env::var_os(key);
            std::env::set_var(key, value);

            Self {
                key,
                original,
                _lock: lock,
            }
        }

        fn remove(key: &'static str) -> Self {
            let lock = ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let original = std::env::var_os(key);
            std::env::remove_var(key);

            Self {
                key,
                original,
                _lock: lock,
            }
        }

        fn set(&self, value: impl AsRef<OsStr>) {
            std::env::set_var(self.key, value);
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.original {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn test_hooks_json_structure() {
        let json = build_hooks_json(17422);
        assert!(json.get("hooks").is_some());
        assert!(json["hooks"].get("UserPromptSubmit").is_some());
        assert!(json["hooks"].get("PreToolUse").is_some());
        assert!(json["hooks"].get("PostToolUse").is_some());
        assert!(json["hooks"].get("Stop").is_some());
        assert!(json["hooks"].get("SessionEnd").is_some());
        assert!(json["hooks"].get("Notification").is_some());
        // Only permission notifications affect OpenForge lifecycle state.
        let notification = &json["hooks"]["Notification"];
        assert_eq!(
            notification.as_array().unwrap().len(),
            1,
            "Notification should only include the permission matcher lifecycle hook"
        );
        assert!(
            notification[0].get("matcher").is_some(),
            "First entry should have a matcher"
        );
    }

    #[test]
    fn test_hook_command_type() {
        let json = build_hooks_json(17422);
        let pre_tool_use = &json["hooks"]["PreToolUse"][0]["hooks"][0];
        assert_eq!(pre_tool_use["type"], "command");
    }

    #[test]
    fn test_port_substitution() {
        let json = build_hooks_json(9999);
        let pre_tool_use_cmd = &json["hooks"]["PreToolUse"][0]["hooks"][0]["command"];
        assert!(pre_tool_use_cmd
            .as_str()
            .unwrap()
            .contains("127.0.0.1:9999"));
    }

    #[test]
    fn test_curl_commands_contain_openforge_env_vars() {
        let json = build_hooks_json(17422);
        let pre_tool_use_cmd = json["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(pre_tool_use_cmd.contains("$CLAUDE_SESSION_ID"));
        assert!(pre_tool_use_cmd.contains("$OPENFORGE_TASK_ID"));
        assert!(!pre_tool_use_cmd.contains("$CLAUDE_TASK_ID"));
        assert!(pre_tool_use_cmd.contains("$OPENFORGE_PTY_INSTANCE_ID"));
        assert!(pre_tool_use_cmd.contains("--data-binary @-"));
    }

    #[test]
    fn test_file_creation() {
        let temp_dir = tempdir().unwrap();

        let result = generate_hooks_settings_for_home(temp_dir.path(), 17422);

        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.exists());
        assert!(path
            .to_string_lossy()
            .contains("claude-hooks-settings.json"));

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"hooks\""));
        assert!(content.contains("PreToolUse"));
    }

    #[test]
    fn test_file_overwrite() {
        let temp_dir = tempdir().unwrap();

        let result1 = generate_hooks_settings_for_home(temp_dir.path(), 17422);
        let result2 = generate_hooks_settings_for_home(temp_dir.path(), 9999);

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        let path = result2.unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("127.0.0.1:9999"));
        assert!(!content.contains("127.0.0.1:17422"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_json_valid() {
        let json = build_hooks_json(17422);
        let json_string = serde_json::to_string_pretty(&json).unwrap();
        let parsed: Value = serde_json::from_str(&json_string).unwrap();
        assert!(parsed.is_object());
    }

    #[test]
    fn test_get_http_server_port_variants() {
        let backend_guard = EnvVarGuard::remove("OPENFORGE_BACKEND_PORT");
        let original_ai_port = std::env::var_os("AI_COMMAND_CENTER_PORT");
        std::env::remove_var("AI_COMMAND_CENTER_PORT");

        // Test 1: Default (env var not set)
        let port = get_http_server_port();
        assert_eq!(
            port,
            crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT,
            "Should return the shared default when env var is not set"
        );

        // Test 2: Valid legacy Tauri value from env
        std::env::set_var("AI_COMMAND_CENTER_PORT", "9999");
        let port = get_http_server_port();
        assert_eq!(
            port, 9999,
            "Should return 9999 when AI_COMMAND_CENTER_PORT is set to 9999"
        );

        // Test 3: Electron sidecar backend port has precedence
        backend_guard.set("17642");
        let port = get_http_server_port();
        assert_eq!(
            port, 17642,
            "Should prefer OPENFORGE_BACKEND_PORT in sidecar mode"
        );

        // Test 4: Invalid sidecar value falls back to default because env fallback only applies to lookup errors.
        backend_guard.set("invalid");
        let port = get_http_server_port();
        assert_eq!(
            port,
            crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT,
            "Should return the shared default when selected env var is invalid"
        );

        if let Some(value) = original_ai_port {
            std::env::set_var("AI_COMMAND_CENTER_PORT", value);
        } else {
            std::env::remove_var("AI_COMMAND_CENTER_PORT");
        }
    }

    #[test]
    fn test_env_var_guard_restores_after_panic() {
        const TEST_KEY: &str = "OPENFORGE_ENV_GUARD_PANIC_TEST";
        let original = std::env::var_os(TEST_KEY);

        let result = std::panic::catch_unwind(|| {
            let _guard = EnvVarGuard::set_to(TEST_KEY, "temporary-value");
            assert_eq!(std::env::var(TEST_KEY).unwrap(), "temporary-value");
            panic!("force guard drop during unwind");
        });

        assert!(result.is_err());
        assert_eq!(std::env::var_os(TEST_KEY), original);
    }

    #[test]
    fn test_hooks_settings_urls_match_http_server_port() {
        let port = 54321u16;
        let json = build_hooks_json(port);

        let hook_entries = [
            ("UserPromptSubmit", 0, "user-prompt-submit"),
            ("PreToolUse", 0, "pre-tool-use"),
            ("PostToolUse", 0, "post-tool-use"),
            ("Stop", 0, "stop"),
            ("SessionEnd", 0, "session-end"),
            ("Notification", 0, "notification-permission"),
        ];

        for (hook_key, idx, expected_event_type) in &hook_entries {
            let cmd = json["hooks"][hook_key][idx]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("Missing command for {}[{}]", hook_key, idx));

            assert!(
                cmd.contains(&format!("127.0.0.1:{}", port)),
                "{}[{}] command should use port {}, got: {}",
                hook_key,
                idx,
                port,
                cmd
            );
            assert!(
                cmd.contains(&format!("/hooks/{}", expected_event_type)),
                "{}[{}] command should POST to the event-specific Claude hook endpoint, got: {}",
                hook_key,
                idx,
                cmd
            );
            assert!(
                cmd.contains("task_id=") && cmd.contains("session_id="),
                "{}[{}] command should include task and Claude session identity, got: {}",
                hook_key,
                idx,
                cmd
            );
            assert!(
                cmd.contains("pty_instance_id="),
                "{}[{}] command should include PTY instance identity, got: {}",
                hook_key,
                idx,
                cmd
            );
            assert!(
                cmd.contains("--data-binary @-"),
                "{}[{}] command should forward Claude hook stdin JSON, got: {}",
                hook_key,
                idx,
                cmd
            );
            assert!(
                cmd.contains("-o /dev/null"),
                "{}[{}] command must not write OpenForge hook responses into Claude stdout",
                hook_key,
                idx
            );
            assert!(
                !cmd.contains("Task Display Title") && !cmd.contains("Return only JSON"),
                "{}[{}] command must not inject title-generation instructions into the live Claude session",
                hook_key,
                idx
            );
            assert!(
                cmd.contains("curl"),
                "{}[{}] command should use curl",
                hook_key,
                idx
            );
            assert!(
                cmd.contains("-X POST"),
                "{}[{}] command should be a POST",
                hook_key,
                idx
            );
        }
    }

    #[test]
    fn test_notification_permission_matcher() {
        let json = build_hooks_json(17422);
        let matcher = &json["hooks"]["Notification"][0]["matcher"];
        assert_eq!(matcher, "permission_prompt");
    }

    #[test]
    fn test_hooks_settings_and_claude_args_integration() {
        let hooks_json = build_hooks_json(17422);
        let json_string = serde_json::to_string_pretty(&hooks_json).unwrap();

        let temp_path =
            std::env::temp_dir().join("test_hooks_settings_claude_args_integration.json");
        fs::write(&temp_path, &json_string).unwrap();

        let args = crate::pty_manager::build_claude_args(
            "implement feature",
            None,
            false,
            &temp_path,
            None,
        );

        let settings_idx = args
            .iter()
            .position(|a| a == "--settings")
            .expect("--settings flag should be present in claude args");
        assert_eq!(
            args[settings_idx + 1],
            temp_path.to_string_lossy().to_string(),
        );

        let content = fs::read_to_string(&temp_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.get("hooks").is_some());

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn test_ensure_workspace_trusted_new_file() {
        let mut root = json!({});
        let cwd_str = "/tmp/test-workspace";

        let projects = root.as_object_mut().unwrap();
        projects.insert(
            cwd_str.to_string(),
            json!({
                "hasTrustDialogAccepted": true
            }),
        );

        assert_eq!(root[cwd_str]["hasTrustDialogAccepted"], json!(true));
    }

    #[test]
    fn test_ensure_workspace_trusted_existing_entry() {
        let mut root = json!({
            "/tmp/existing": {
                "allowedTools": [],
                "hasTrustDialogAccepted": false
            }
        });

        let cwd_str = "/tmp/existing";
        let projects = root.as_object_mut().unwrap();
        if let Some(project) = projects.get_mut(cwd_str) {
            if let Some(obj) = project.as_object_mut() {
                obj.insert("hasTrustDialogAccepted".to_string(), json!(true));
            }
        }

        assert_eq!(root[cwd_str]["hasTrustDialogAccepted"], json!(true));
        assert_eq!(root[cwd_str]["allowedTools"], json!([]));
    }
}
