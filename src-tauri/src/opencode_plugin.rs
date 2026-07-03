use std::fs;
use std::path::PathBuf;

const OPENCODE_PLUGIN_SOURCE: &str = include_str!("opencode-plugin/openforge.ts");

fn opencode_config_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
        .or_else(dirs::config_dir)
        .map(|config| config.join("opencode"))
}

pub fn get_opencode_plugin_install_dir() -> Option<PathBuf> {
    opencode_config_dir().map(|config| config.join("plugins"))
}

pub fn ensure_opencode_plugin_installed() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let install_dir =
        get_opencode_plugin_install_dir().ok_or("could not determine config directory")?;
    fs::create_dir_all(&install_dir)?;
    let plugin_path = install_dir.join("openforge.ts");
    fs::write(&plugin_path, OPENCODE_PLUGIN_SOURCE)?;
    Ok(plugin_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_plugin_reports_lifecycle_events_to_openforge_hook() {
        assert!(OPENCODE_PLUGIN_SOURCE.contains("event: async"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_TASK_ID"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_PTY_INSTANCE_ID"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_HTTP_PORT"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("/hooks/agent-lifecycle"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("provider: \"opencode\""));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.created"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.status"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.idle"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.error"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.updated"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("message.updated"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("tool.execute.before"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("tool.execute.after"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("provider_session_id"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("kind"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("started"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("became_busy"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("failed"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("ended"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("raw_event_type"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("raw_status_type"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("activity_snapshot"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("boundedActivitySnapshot"));
    }

    #[test]
    fn opencode_plugin_install_dir_uses_opencode_config_directory() {
        let dir = get_opencode_plugin_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with(".config/opencode/plugins"));
    }

    #[test]
    fn opencode_plugin_prefers_session_id_over_message_id() {
        let session_id = evaluate_session_id_from_event(
            r#"{
                type: "message.updated",
                properties: {
                    info: { id: "msg_bad123" },
                    session: { id: "ses_good123" },
                    sessionID: "ses_good456",
                    sessionId: "ses_good789"
                }
            }"#,
        );

        assert_eq!(session_id.as_deref(), Some("ses_good123"));
    }

    #[test]
    fn opencode_plugin_posts_richer_lifecycle_events_with_normalized_kinds() {
        let payloads = evaluate_posted_payloads_for_events(
            r#"[
                {
                    type: "session.created",
                    properties: { session: { id: "ses_rich123" } }
                },
                {
                    type: "session.status",
                    properties: { session: { id: "ses_rich123" }, status: { type: "busy" } }
                },
                {
                    type: "session.error",
                    properties: { session: { id: "ses_rich123" } }
                },
                {
                    type: "tool.execute.before",
                    properties: { session: { id: "ses_rich123" } }
                },
                {
                    type: "tool.execute.after",
                    properties: { session: { id: "ses_rich123" } }
                },
                {
                    type: "session.updated",
                    properties: { session: { id: "ses_rich123" } }
                },
                {
                    type: "message.updated",
                    properties: { info: { id: "msg_bad123" }, session: { id: "ses_rich123" } }
                }
            ]"#,
        );

        let kinds: Vec<&str> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be string"))
            .collect();
        assert_eq!(
            kinds,
            [
                "started",
                "became_busy",
                "failed",
                "became_busy",
                "became_busy",
                "became_busy",
                "became_busy"
            ]
        );
        assert_eq!(payloads[1]["raw_event_type"], "session.status");
        assert_eq!(payloads[1]["raw_status_type"], "busy");
        assert!(payloads[1]["activity_snapshot"]
            .as_str()
            .expect("activity snapshot should be string")
            .contains("session.status"));
        assert_eq!(payloads[6]["provider_session_id"], "ses_rich123");
        assert!(payloads[6]["activity_snapshot"]
            .as_str()
            .expect("activity snapshot should be string")
            .contains("ses_rich123"));
    }

    #[test]
    fn opencode_plugin_posts_idle_status_as_completion() {
        let payloads = evaluate_posted_payloads_for_events(
            r#"[
                {
                    type: "session.status",
                    properties: { session: { id: "ses_idle123" }, status: { type: "idle" } }
                },
                {
                    type: "session.updated",
                    properties: { session: { id: "ses_idle123" } }
                }
            ]"#,
        );

        let kinds: Vec<&str> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be string"))
            .collect();
        assert_eq!(kinds, ["ended"]);
        assert_eq!(payloads[0]["raw_event_type"], "session.status");
        assert_eq!(payloads[0]["raw_status_type"], "idle");
    }

    #[test]
    fn opencode_plugin_suppresses_same_session_cleanup_after_idle() {
        let payloads = evaluate_posted_payloads_for_events(
            r#"[
                {
                    type: "session.idle",
                    properties: { session: { id: "ses_done123" } }
                },
                {
                    type: "session.updated",
                    properties: { session: { id: "ses_done123" } }
                },
                {
                    type: "message.updated",
                    properties: { info: { id: "msg_bad123" }, session: { id: "ses_done123" } }
                }
            ]"#,
        );

        let kinds: Vec<&str> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be string"))
            .collect();
        assert_eq!(kinds, ["ended"]);
        assert_eq!(payloads[0]["provider_session_id"], "ses_done123");
    }

    #[test]
    fn opencode_plugin_allows_new_session_after_previous_session_idle() {
        let payloads = evaluate_posted_payloads_for_events(
            r#"[
                {
                    type: "session.idle",
                    properties: { session: { id: "ses_old123" } }
                },
                {
                    type: "session.created",
                    properties: { session: { id: "ses_new123" } }
                },
                {
                    type: "session.status",
                    properties: { session: { id: "ses_new123" }, status: "busy" }
                }
            ]"#,
        );

        let kinds: Vec<&str> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be string"))
            .collect();
        assert_eq!(kinds, ["ended", "started", "became_busy"]);
        assert_eq!(payloads[2]["provider_session_id"], "ses_new123");
    }

    #[test]
    fn opencode_plugin_rejects_message_id_without_session_id() {
        let session_id = evaluate_session_id_from_event(
            r#"{
                type: "message.updated",
                properties: {
                    info: { id: "msg_bad123" }
                }
            }"#,
        );

        assert_eq!(session_id, None);
    }

    fn evaluate_session_id_from_event(event_js: &str) -> Option<String> {
        let stdout = run_opencode_plugin_script(&format!(
            r#"
const result = sessionIdFromEvent({event_js});
process.stdout.write(result === null || result === undefined ? "null" : String(result));
"#
        ));
        if stdout == "null" {
            None
        } else {
            Some(stdout)
        }
    }

    fn evaluate_posted_payloads_for_events(events_js: &str) -> Vec<serde_json::Value> {
        let stdout = run_opencode_plugin_script(&format!(
            r#"
process.env.OPENFORGE_TASK_ID = "T-PLUGIN";
process.env.OPENFORGE_PTY_INSTANCE_ID = "42";
process.env.OPENFORGE_HTTP_PORT = "38123";
const payloads = [];
globalThis.fetch = async (_url, options) => {{
  payloads.push(JSON.parse(options.body));
  return {{ ok: true }};
}};
for (const event of {events_js}) {{
  await postOpenForgeEvent(event);
}}
process.stdout.write(JSON.stringify(payloads));
"#
        ));
        serde_json::from_str(&stdout).expect("payloads should be valid json")
    }

    fn run_opencode_plugin_script(script_body: &str) -> String {
        let source =
            OPENCODE_PLUGIN_SOURCE.replace("export const OpenForgePlugin", "const OpenForgePlugin");
        let script = format!("{source}\n{script_body}");
        let script_file = tempfile::Builder::new()
            .prefix("openforge-opencode-plugin-test-")
            .suffix(".mjs")
            .tempfile()
            .expect("create plugin test script");
        std::fs::write(script_file.path(), script).expect("write plugin test script");
        let output = std::process::Command::new("node")
            .arg(script_file.path())
            .output()
            .expect("run node for opencode plugin test");

        assert!(
            output.status.success(),
            "node failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("node output should be utf8")
    }
}
