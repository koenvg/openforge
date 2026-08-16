use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Map a Grok hook's raw event type to the OpenForge agent lifecycle kind it
/// should report. Unlike Claude's hooks, Grok's hooks are installed globally
/// (`~/.grok/hooks/openforge.json`) and fire for every `grok` invocation, so
/// callers must additionally guard the generated shell command itself (see
/// `lifecycle_hook_command`) rather than relying on this mapping alone.
pub(crate) fn grok_lifecycle_kind_from_event(
    event_type: &str,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match event_type {
        "session-start" | "user-prompt-submit" | "pre-tool-use" | "post-tool-use" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy)
        }
        "stop" | "session-end" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended),
        "notification-permission" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::RequestedPermission)
        }
        _ => None,
    }
}

fn lifecycle_hook_endpoint(event_type: &str) -> Option<&'static str> {
    match event_type {
        "session-start" => Some("session-start"),
        "user-prompt-submit" => Some("user-prompt-submit"),
        "pre-tool-use" => Some("pre-tool-use"),
        "post-tool-use" => Some("post-tool-use"),
        "stop" => Some("stop"),
        "session-end" => Some("session-end"),
        "notification-permission" => Some("notification-permission"),
        _ => None,
    }
}

/// Build a guarded curl command for the given lifecycle event. The
/// `[ -z "$OPENFORGE_TASK_ID" ] ||` guard keeps the hook inert (exit 0,
/// skipping curl) for the user's own (non-OpenForge) Grok sessions, since
/// Grok hooks are installed globally rather than per-task like Claude's.
/// Using `[ -z ] ||` instead of `[ -n ] &&` ensures the overall command still
/// exits 0 when OPENFORGE_TASK_ID is unset, rather than propagating the
/// non-zero exit code of a short-circuited `&&`, which could otherwise
/// disrupt the user's own Grok sessions.
///
/// The trailing `; exit 0` is load-bearing beyond that guard: Grok treats a
/// hook exit code of 2 as an explicit "deny", and `PreToolUse` is Grok's only
/// blocking event. Without it, the command's exit status is curl's own, so a
/// curl failure that happens to exit 2 (e.g. "failed to initialize") would
/// block the user's tool call. Forcing exit 0 keeps this purely a
/// best-effort status ping, never a decision signal.
fn lifecycle_hook_command(port: u16, event_type: &str) -> String {
    let Some(_kind) = grok_lifecycle_kind_from_event(event_type) else {
        return String::new();
    };
    let Some(endpoint) = lifecycle_hook_endpoint(event_type) else {
        return String::new();
    };
    format!(
        "[ -z \"$OPENFORGE_TASK_ID\" ] || curl -s -o /dev/null -X POST 'http://127.0.0.1:{}/hooks/grok-{}?task_id='\"$OPENFORGE_TASK_ID\"'&pty_instance_id='\"$OPENFORGE_PTY_INSTANCE_ID\"'&session_id='\"$GROK_SESSION_ID\" -H 'Content-Type: application/json' --data-binary @- ; exit 0",
        port, endpoint
    )
}

pub(crate) fn build_hooks_json(port: u16) -> Value {
    let session_start_cmd = lifecycle_hook_command(port, "session-start");
    let user_prompt_submit_cmd = lifecycle_hook_command(port, "user-prompt-submit");
    let pre_tool_use_cmd = lifecycle_hook_command(port, "pre-tool-use");
    let post_tool_use_cmd = lifecycle_hook_command(port, "post-tool-use");
    let stop_cmd = lifecycle_hook_command(port, "stop");
    let session_end_cmd = lifecycle_hook_command(port, "session-end");
    let notification_permission_cmd = lifecycle_hook_command(port, "notification-permission");

    json!({
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": session_start_cmd
                        }
                    ]
                }
            ],
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

/// Write the OpenForge lifecycle hook settings under a specific Grok home
/// directory. Split out from `install_openforge_hook` so tests can point it
/// at a tempdir instead of the real `~/.grok`.
pub(crate) fn install_openforge_hook_for_grok_home(
    grok_home: &Path,
    port: u16,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let hooks_dir = grok_home.join("hooks");
    let hooks_path = hooks_dir.join("openforge.json");

    fs::create_dir_all(&hooks_dir)?;

    let hooks_json = build_hooks_json(port);
    let json_string = serde_json::to_string_pretty(&hooks_json)?;

    // `prepare()` runs on every task spawn and this file is global/shared
    // (`~/.grok/hooks/openforge.json`), so two concurrent Grok launches can
    // race here. Write to a process-unique temp file in the same directory
    // first, then atomically rename it over the real path, so readers never
    // observe a torn/truncated file. Using the same directory keeps the
    // rename on one filesystem, which is required for it to be atomic.
    let temp_path = hooks_dir.join(format!("openforge.json.tmp-{}", std::process::id()));
    fs::write(&temp_path, json_string)?;
    if let Err(err) = fs::rename(&temp_path, &hooks_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(err.into());
    }

    Ok(hooks_path)
}

/// Resolve the user's Grok home directory: `$GROK_HOME` if set and
/// non-empty, else `~/.grok`. Shared by hook installation and
/// authentication checks so both agree on where Grok stores its state.
pub(crate) fn grok_home() -> Option<PathBuf> {
    std::env::var_os("GROK_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".grok")))
}

/// Idempotently install the OpenForge lifecycle hook into the user's Grok
/// home directory (`$GROK_HOME` if set, else `~/.grok`), so Grok reports
/// agent status to OpenForge's local HTTP server for OpenForge-launched
/// sessions.
pub fn install_openforge_hook() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let grok_home = grok_home().ok_or("Could not determine Grok home directory")?;

    let port = crate::claude_hooks::get_http_server_port();
    install_openforge_hook_for_grok_home(&grok_home, port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn grok_hooks_json_has_session_start_and_stop() {
        let json = build_hooks_json(17422);
        assert!(json["hooks"].get("SessionStart").is_some());
        assert!(json["hooks"].get("Stop").is_some());
        assert!(json["hooks"].get("SessionEnd").is_some());
    }

    #[test]
    fn grok_hook_command_is_guarded_and_targets_grok_endpoint() {
        let json = build_hooks_json(9999);
        let cmd = json["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(
            cmd.contains("[ -z \"$OPENFORGE_TASK_ID\" ]"),
            "must be inert without OPENFORGE_TASK_ID"
        );
        assert!(cmd.contains("127.0.0.1:9999"));
        assert!(cmd.contains("/hooks/grok-stop"));
        assert!(cmd.contains("$GROK_SESSION_ID"));
        assert!(cmd.contains("--data-binary @-"));
        assert!(
            cmd.trim_end().ends_with("; exit 0"),
            "command must always exit 0 so curl's own exit status (e.g. 2) never \
             gets interpreted by grok as an explicit deny on PreToolUse, got: {}",
            cmd
        );
    }

    #[test]
    fn grok_hook_commands_all_end_with_exit_0() {
        let json = build_hooks_json(17422);
        let hook_keys = [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "Stop",
            "SessionEnd",
            "Notification",
        ];
        for hook_key in hook_keys {
            let cmd = json["hooks"][hook_key][0]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("Missing command for {}", hook_key));
            assert!(
                cmd.trim_end().ends_with("; exit 0"),
                "{} command must end with '; exit 0' so a non-zero curl exit \
                 (e.g. 2) can never be misread by grok as an explicit deny on \
                 PreToolUse, got: {}",
                hook_key,
                cmd
            );
        }
    }

    #[test]
    fn grok_hooks_json_structure_has_all_seven_events() {
        let json = build_hooks_json(17422);
        assert!(json.get("hooks").is_some());
        assert!(json["hooks"].get("SessionStart").is_some());
        assert!(json["hooks"].get("UserPromptSubmit").is_some());
        assert!(json["hooks"].get("PreToolUse").is_some());
        assert!(json["hooks"].get("PostToolUse").is_some());
        assert!(json["hooks"].get("Stop").is_some());
        assert!(json["hooks"].get("SessionEnd").is_some());
        assert!(json["hooks"].get("Notification").is_some());

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
    fn grok_hook_command_type_is_command() {
        let json = build_hooks_json(17422);
        let pre_tool_use = &json["hooks"]["PreToolUse"][0]["hooks"][0];
        assert_eq!(pre_tool_use["type"], "command");
    }

    #[test]
    fn grok_hook_command_uses_grok_session_id_not_claude() {
        let json = build_hooks_json(17422);
        let cmd = json["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(cmd.contains("$GROK_SESSION_ID"));
        assert!(!cmd.contains("$CLAUDE_SESSION_ID"));
        assert!(cmd.contains("$OPENFORGE_TASK_ID"));
        assert!(cmd.contains("$OPENFORGE_PTY_INSTANCE_ID"));
        assert!(cmd.contains("--data-binary @-"));
    }

    #[test]
    fn grok_hooks_settings_urls_match_http_server_port_and_are_guarded() {
        let port = 54321u16;
        let json = build_hooks_json(port);

        let hook_entries = [
            ("SessionStart", "session-start"),
            ("UserPromptSubmit", "user-prompt-submit"),
            ("PreToolUse", "pre-tool-use"),
            ("PostToolUse", "post-tool-use"),
            ("Stop", "stop"),
            ("SessionEnd", "session-end"),
            ("Notification", "notification-permission"),
        ];

        for (hook_key, expected_event_type) in &hook_entries {
            let cmd = json["hooks"][hook_key][0]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("Missing command for {}", hook_key));

            assert!(
                cmd.starts_with("[ -z \"$OPENFORGE_TASK_ID\" ] ||"),
                "{} command should be guarded to stay inert for the user's own Grok sessions, got: {}",
                hook_key,
                cmd
            );
            assert!(
                cmd.contains(&format!("127.0.0.1:{}", port)),
                "{} command should use port {}, got: {}",
                hook_key,
                port,
                cmd
            );
            assert!(
                cmd.contains(&format!("/hooks/grok-{}", expected_event_type)),
                "{} command should POST to the event-specific Grok hook endpoint, got: {}",
                hook_key,
                cmd
            );
            assert!(
                cmd.contains("task_id=") && cmd.contains("session_id="),
                "{} command should include task and Grok session identity, got: {}",
                hook_key,
                cmd
            );
            assert!(
                cmd.contains("pty_instance_id="),
                "{} command should include PTY instance identity, got: {}",
                hook_key,
                cmd
            );
            assert!(
                cmd.contains("--data-binary @-"),
                "{} command should forward the Grok hook stdin JSON, got: {}",
                hook_key,
                cmd
            );
            assert!(
                cmd.contains("-o /dev/null"),
                "{} command must not write OpenForge hook responses into Grok stdout",
                hook_key
            );
            assert!(cmd.contains("curl"), "{} command should use curl", hook_key);
            assert!(
                cmd.contains("-X POST"),
                "{} command should be a POST",
                hook_key
            );
        }
    }

    #[test]
    fn grok_notification_permission_matcher() {
        let json = build_hooks_json(17422);
        let matcher = &json["hooks"]["Notification"][0]["matcher"];
        assert_eq!(matcher, "permission_prompt");
    }

    #[test]
    fn grok_hooks_json_is_valid_json() {
        let json = build_hooks_json(17422);
        let json_string = serde_json::to_string_pretty(&json).unwrap();
        let parsed: Value = serde_json::from_str(&json_string).unwrap();
        assert!(parsed.is_object());
    }

    #[test]
    fn grok_lifecycle_kind_from_event_maps_documented_events() {
        use crate::agent_lifecycle::AgentLifecycleEventKind;

        for event in [
            "session-start",
            "user-prompt-submit",
            "pre-tool-use",
            "post-tool-use",
        ] {
            assert_eq!(
                grok_lifecycle_kind_from_event(event),
                Some(AgentLifecycleEventKind::BecameBusy),
                "{event} should map to BecameBusy"
            );
        }

        for event in ["stop", "session-end"] {
            assert_eq!(
                grok_lifecycle_kind_from_event(event),
                Some(AgentLifecycleEventKind::Ended),
                "{event} should map to Ended"
            );
        }

        assert_eq!(
            grok_lifecycle_kind_from_event("notification-permission"),
            Some(AgentLifecycleEventKind::RequestedPermission)
        );

        for event in ["notification", "unknown-event", ""] {
            assert_eq!(
                grok_lifecycle_kind_from_event(event),
                None,
                "{event} should not map to a lifecycle kind"
            );
        }
    }

    #[test]
    fn grok_install_writes_hook_file() {
        let temp_dir = tempdir().unwrap();

        let result = install_openforge_hook_for_grok_home(temp_dir.path(), 17422);

        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.exists());
        assert_eq!(path, temp_dir.path().join("hooks").join("openforge.json"));

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"hooks\""));
        assert!(content.contains("SessionStart"));
        assert!(content.contains("127.0.0.1:17422"));
    }

    #[test]
    fn grok_install_overwrites_existing_hook_file() {
        let temp_dir = tempdir().unwrap();

        let result1 = install_openforge_hook_for_grok_home(temp_dir.path(), 17422);
        let result2 = install_openforge_hook_for_grok_home(temp_dir.path(), 9999);

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        let path = result2.unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("127.0.0.1:9999"));
        assert!(!content.contains("127.0.0.1:17422"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn grok_install_writes_via_atomic_rename_with_no_leftover_temp_file() {
        let temp_dir = tempdir().unwrap();

        let result1 = install_openforge_hook_for_grok_home(temp_dir.path(), 17422);
        assert!(result1.is_ok());
        let path1 = result1.unwrap();

        // Installed file must parse as valid JSON immediately after install
        // (an interleaved/torn write would produce invalid JSON).
        let content1 = fs::read_to_string(&path1).unwrap();
        let parsed1: Value = serde_json::from_str(&content1)
            .expect("installed hook file should parse as valid JSON");
        assert!(parsed1.is_object());

        // A second install (simulating a concurrent/subsequent task spawn)
        // must overwrite cleanly and still parse.
        let result2 = install_openforge_hook_for_grok_home(temp_dir.path(), 9999);
        assert!(result2.is_ok());
        let path2 = result2.unwrap();
        let content2 = fs::read_to_string(&path2).unwrap();
        let parsed2: Value = serde_json::from_str(&content2)
            .expect("re-installed hook file should parse as valid JSON");
        assert!(parsed2.is_object());

        // No leftover temp file (e.g. openforge.json.tmp-<pid>) should remain
        // in the hooks dir after install.
        let hooks_dir = temp_dir.path().join("hooks");
        let leftover_temp_files: Vec<_> = fs::read_dir(&hooks_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftover_temp_files.is_empty(),
            "expected no leftover temp files in hooks dir, found: {:?}",
            leftover_temp_files
                .iter()
                .map(|e| e.file_name())
                .collect::<Vec<_>>()
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
