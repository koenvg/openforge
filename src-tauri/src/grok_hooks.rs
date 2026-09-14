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

/// Grok hooks are installed globally (`~/.grok/hooks/openforge.json`) and
/// fire for every `grok` invocation, so the guard keeps the hook inert for
/// the user's own non-OpenForge sessions. `[ -z ] ||` rather than `[ -n ] &&`
/// so the command still exits 0 when the variable is unset, instead of
/// propagating the non-zero exit of a short-circuited `&&`.
///
/// Grok reads hook stdout as a permission decision and exit code 2 as a deny,
/// and it refuses to run a hook naming a variable its hook environment lacks.
/// The generator test pins the whole command against those three rules.
fn lifecycle_hook_command(port: u16, event_type: &str) -> String {
    let Some(kind) = grok_lifecycle_kind_from_event(event_type) else {
        return String::new();
    };
    let Some(endpoint) = lifecycle_hook_endpoint(event_type) else {
        return String::new();
    };
    let legacy_url = format!("http://127.0.0.1:{port}/hooks/grok-{endpoint}");
    let report =
        crate::notification_hooks::shell_command("grok", kind, event_type, Some(&legacy_url));
    format!("[ -z \"$OPENFORGE_TASK_ID\" ] || {report} >/dev/null; exit 0")
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
    fn grok_hook_commands_are_exactly_the_guarded_reporter_invocation() {
        let port = 54321u16;
        let json = build_hooks_json(port);

        for (hook_key, event_type, kind) in [
            ("SessionStart", "session-start", "became_busy"),
            ("UserPromptSubmit", "user-prompt-submit", "became_busy"),
            ("PreToolUse", "pre-tool-use", "became_busy"),
            ("PostToolUse", "post-tool-use", "became_busy"),
            ("Stop", "stop", "ended"),
            ("SessionEnd", "session-end", "ended"),
            (
                "Notification",
                "notification-permission",
                "requested_permission",
            ),
        ] {
            let cmd = json["hooks"][hook_key][0]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("Missing command for {hook_key}"));
            let (guard, rest) = cmd.split_once("node -e '").expect(cmd);
            let (_embedded_source, arguments) = rest.split_once("' ").expect(cmd);

            assert_eq!(
                guard, "[ -z \"$OPENFORGE_TASK_ID\" ] || ",
                "{hook_key} command must stay inert for the user's own Grok sessions"
            );
            assert_eq!(
                arguments,
                format!(
                    "'grok' '{kind}' '{event_type}' \
                     'http://127.0.0.1:{port}/hooks/grok-{event_type}' >/dev/null; exit 0"
                ),
                "{hook_key} command is pinned exactly because each part carries a Grok \
                 constraint: it may name no environment variable beyond \
                 $OPENFORGE_TASK_ID (Grok drops a hook naming an unresolvable one), \
                 it may write nothing to stdout (read as a permission decision), and \
                 it must exit 0 (exit code 2 is read as a deny)"
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
