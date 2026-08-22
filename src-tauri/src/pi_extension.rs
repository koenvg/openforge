use std::fs;
use std::path::PathBuf;

const PI_EXTENSION_SOURCE: &str = include_str!("pi-extension/openforge.ts");

pub fn get_pi_extension_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("pi-extension"))
}

pub fn ensure_pi_extension_installed() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let install_dir =
        get_pi_extension_install_dir().ok_or("Could not determine config directory")?;
    fs::create_dir_all(&install_dir)?;
    let extension_path = install_dir.join("openforge.ts");
    fs::write(&extension_path, PI_EXTENSION_SOURCE)?;
    Ok(extension_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pi_extension_reports_agent_lifecycle_to_openforge_hooks() {
        assert!(PI_EXTENSION_SOURCE.contains("agent_start"));
        assert!(PI_EXTENSION_SOURCE.contains("agent_end"));
        assert!(PI_EXTENSION_SOURCE.contains("OPENFORGE_TASK_ID"));
        assert!(PI_EXTENSION_SOURCE.contains("OPENFORGE_PTY_INSTANCE_ID"));
        assert!(PI_EXTENSION_SOURCE.contains("pty_instance_id"));
        assert!(PI_EXTENSION_SOURCE.contains("/hooks/agent-lifecycle"));
        assert!(PI_EXTENSION_SOURCE.contains("provider: \"pi\""));
        assert!(PI_EXTENSION_SOURCE.contains("kind"));
        assert!(PI_EXTENSION_SOURCE.contains("raw_event_type"));
        assert!(PI_EXTENSION_SOURCE.contains("agent.start"));
        assert!(PI_EXTENSION_SOURCE.contains("agent.end"));
        assert!(PI_EXTENSION_SOURCE.contains("pi.on(\"input\""));
        assert!(PI_EXTENSION_SOURCE.contains("user_prompt"));
        assert!(PI_EXTENSION_SOURCE.contains("transcript_path"));
        assert!(PI_EXTENSION_SOURCE.contains("activity_snapshot"));
        assert!(PI_EXTENSION_SOURCE.contains("getSessionFile"));
        assert!(PI_EXTENSION_SOURCE.contains("MAX_ACTIVITY_SNAPSHOT_CHARS"));
        assert!(!PI_EXTENSION_SOURCE.contains("sendMessage("));
        assert!(!PI_EXTENSION_SOURCE.contains("sendUserMessage("));
        assert!(!PI_EXTENSION_SOURCE.contains("appendEntry("));
    }

    #[test]
    fn pi_extension_reports_current_session_id_for_every_lifecycle_event() {
        let script = format!(
            r#"{PI_EXTENSION_SOURCE}
const handlers = new Map();
openForgeExtension({{ on(name, handler) {{ handlers.set(name, handler); }} }});
process.env.OPENFORGE_TASK_ID = "T-PI";
process.env.OPENFORGE_PTY_INSTANCE_ID = "42";
const payloads = [];
globalThis.fetch = async (_url, options) => {{
  payloads.push(JSON.parse(options.body));
  return {{ ok: true }};
}};
const ctx = {{
  cwd: "/tmp/project",
  sessionManager: {{
    getSessionId: () => "pi-session-123",
    getSessionFile: () => "/tmp/session.jsonl",
  }},
}};
await handlers.get("input")({{ text: "hello", source: "interactive" }}, ctx);
await handlers.get("agent_start")({{}}, ctx);
await handlers.get("agent_end")({{}}, ctx);
process.stdout.write(JSON.stringify(payloads));
"#
        );
        let script_file = tempfile::Builder::new()
            .prefix("openforge-pi-extension-test-")
            .suffix(".ts")
            .tempfile()
            .expect("create Pi extension test script");
        std::fs::write(script_file.path(), script).expect("write Pi extension test script");
        let output = std::process::Command::new("node")
            .arg("--experimental-strip-types")
            .arg(script_file.path())
            .output()
            .expect("run Pi extension test script");
        assert!(
            output.status.success(),
            "node failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let payloads: Vec<serde_json::Value> =
            serde_json::from_slice(&output.stdout).expect("payloads should be valid JSON");
        let kinds: Vec<_> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["became_busy", "started", "ended"]);
        assert!(payloads
            .iter()
            .all(|payload| payload["provider_session_id"] == "pi-session-123"));
    }

    #[test]
    fn pi_extension_install_dir_uses_openforge_config() {
        let dir = get_pi_extension_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with("openforge/pi-extension"));
    }
}
