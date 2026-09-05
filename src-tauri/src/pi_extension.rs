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
    use serde_json::Value;
    use std::path::Path;
    use std::process::Command;

    const PI_EXTENSION_TEST_HARNESS: &str = r#"
const piHandlers = new Map();
const busHandlers = new Map();
const payloads = [];
const session = {
  id: "pi-session-123",
  file: "/tmp/session.jsonl",
  idle: true,
  entries: [],
};
const pi = {
  on(name, handler) { piHandlers.set(name, handler); },
  events: {
    on(name, handler) {
      const handlers = busHandlers.get(name) ?? new Set();
      handlers.add(handler);
      busHandlers.set(name, handlers);
      return () => handlers.delete(handler);
    },
    emit(name, data) {
      for (const handler of [...(busHandlers.get(name) ?? [])]) handler(data);
    },
  },
};
openForgeExtension(pi);
process.env.OPENFORGE_TASK_ID = "T-PI";
process.env.OPENFORGE_PTY_INSTANCE_ID = "42";
globalThis.fetch = async (_url, options) => {
  payloads.push(JSON.parse(options.body));
  return { ok: true };
};
const ctx = {
  cwd: "/tmp/project",
  isIdle: () => session.idle,
  sessionManager: {
    getSessionId: () => session.id,
    getSessionFile: () => session.file,
    getEntries: () => session.entries,
  },
};
async function flush() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
async function emitPi(name, event = {}) {
  const handler = piHandlers.get(name);
  if (!handler) throw new Error(`Pi handler not registered: ${name}`);
  await handler(event, ctx);
  await flush();
}
async function emitBus(name, data) {
  const results = [...(busHandlers.get(name) ?? [])].map((handler) => handler(data));
  await Promise.all(results);
  await flush();
}
"#;

    fn run_pi_extension_scenario(scenario: &str) -> Value {
        let script = [
            PI_EXTENSION_SOURCE,
            PI_EXTENSION_TEST_HARNESS,
            scenario,
            "process.stdout.write(JSON.stringify({ payloads, registeredPiEvents: [...piHandlers.keys()] }));",
        ]
        .join("\n");
        let script_file = tempfile::Builder::new()
            .prefix("openforge-pi-extension-test-")
            .suffix(".ts")
            .tempfile()
            .expect("create Pi extension test script");
        std::fs::write(script_file.path(), script).expect("write Pi extension test script");
        let output = Command::new("node")
            .arg("--experimental-strip-types")
            .arg(script_file.path())
            .output()
            .expect("run Pi extension test script");
        assert!(
            output.status.success(),
            "node failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).expect("scenario output should be valid JSON")
    }

    fn write_async_status(root: &Path, directory: &str, status: Value) -> String {
        let async_dir = root.join(directory);
        std::fs::create_dir_all(&async_dir).expect("create async run directory");
        std::fs::write(
            async_dir.join("status.json"),
            serde_json::to_vec(&status).expect("serialize async status"),
        )
        .expect("write async status");
        async_dir.to_string_lossy().into_owned()
    }

    fn subagent_tool_result(run_id: &str, async_dir: &str) -> Value {
        serde_json::json!({
            "type": "message",
            "message": {
                "role": "toolResult",
                "toolName": "subagent",
                "details": { "asyncId": run_id, "asyncDir": async_dir },
            },
        })
    }

    #[test]
    fn pi_extension_reports_ordinary_lifecycle_at_settlement() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("input", { text: "hello", source: "interactive" });
await emitPi("agent_start");
if (piHandlers.has("agent_end")) await emitPi("agent_end");
await emitPi("agent_settled");
"#,
        );
        let payloads = result["payloads"]
            .as_array()
            .expect("payloads should be an array");
        let kinds: Vec<_> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["became_busy", "started", "ended"]);
        assert_eq!(payloads[2]["raw_event_type"], "agent.end");
        assert!(payloads
            .iter()
            .all(|payload| payload["provider_session_id"] == "pi-session-123"));
    }

    #[test]
    fn pi_extension_does_not_end_between_automatic_parent_runs() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("agent_start");
if (piHandlers.has("agent_end")) await emitPi("agent_end");
await emitPi("agent_start");
if (piHandlers.has("agent_end")) await emitPi("agent_end");
await emitPi("agent_settled");
"#,
        );
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "started", "ended"]);
    }

    #[test]
    fn pi_extension_keeps_session_running_while_an_async_run_is_active() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("agent_start");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "child-a",
  sessionId: session.file,
  asyncDir: "/tmp/child-a",
});
await emitPi("agent_settled");
"#,
        );
        let payloads = result["payloads"]
            .as_array()
            .expect("payloads should be an array");
        let kinds: Vec<_> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "became_busy"]);
    }

    #[test]
    fn pi_extension_rejects_invalid_async_start_payloads() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("agent_start");
for (const payload of [
  null,
  { lifecycleArtifactVersion: 2, id: "old-version", sessionId: session.file, asyncDir: "/tmp/old" },
  { lifecycleArtifactVersion: 3, id: "", sessionId: session.file, asyncDir: "/tmp/blank" },
  { lifecycleArtifactVersion: 3, id: "x".repeat(257), sessionId: session.file, asyncDir: "/tmp/long" },
  { lifecycleArtifactVersion: 3, id: "relative", sessionId: session.file, asyncDir: "relative/path" },
]) {
  await emitBus("subagent:async-started", payload);
}
await emitPi("agent_settled");
"#,
        );
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "ended"]);
    }

    #[test]
    fn pi_extension_waits_for_all_async_runs_to_complete() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("agent_start");
for (const id of ["child-a", "child-b"]) {
  await emitBus("subagent:async-started", {
    lifecycleArtifactVersion: 3,
    id,
    sessionId: session.file,
    asyncDir: `/tmp/${id}`,
  });
}
await emitPi("agent_settled");
await emitBus("subagent:async-complete", {
  lifecycleArtifactVersion: 3,
  runId: "child-b",
  sessionId: session.file,
});
await emitBus("subagent:async-complete", {
  lifecycleArtifactVersion: 3,
  runId: "child-a",
  sessionId: session.file,
});
"#,
        );
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "became_busy", "ended"]);
    }

    #[test]
    fn pi_extension_ignores_background_events_from_other_sessions() {
        let result = run_pi_extension_scenario(
            r#"
const firstSessionFile = session.file;
await emitPi("agent_start");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "old-child",
  sessionId: firstSessionFile,
  asyncDir: "/tmp/old-child",
});
await emitPi("agent_settled");
session.id = "pi-session-456";
session.file = "/tmp/other-session.jsonl";
await emitPi("session_start", { reason: "resume", previousSessionFile: firstSessionFile });
await emitBus("subagent:async-complete", {
  lifecycleArtifactVersion: 3,
  runId: "old-child",
  sessionId: firstSessionFile,
});
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "unrelated-child",
  sessionId: firstSessionFile,
  asyncDir: "/tmp/unrelated-child",
});
await emitPi("agent_settled");
"#,
        );
        let payloads = result["payloads"]
            .as_array()
            .expect("payloads should be an array");
        let kinds: Vec<_> = payloads
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "became_busy", "ended"]);
        assert_eq!(payloads[2]["provider_session_id"], "pi-session-456");
    }

    #[test]
    fn pi_extension_lets_a_completion_wakeup_settle_before_ending() {
        let root = tempfile::tempdir().expect("create wakeup fixture directory");
        let async_dir = write_async_status(
            root.path(),
            "wakeup",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "child-a",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let status_path = Path::new(&async_dir).join("status.json");
        let scenario = r#"
await emitPi("agent_start");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "child-a",
  sessionId: session.file,
  asyncDir: __ASYNC_DIR__,
});
await emitPi("agent_settled");
const { writeFile } = await import("node:fs/promises");
await writeFile(__STATUS_PATH__, JSON.stringify({
  lifecycleArtifactVersion: 3,
  runId: "child-a",
  sessionId: session.file,
  mode: "single",
  state: "complete",
  startedAt: 1,
}));
await emitBus("subagent:process-terminal", {
  version: 1,
  runId: "child-a",
  state: "observed",
  runnerProcessInstanceId: "runner-a",
  observedAt: 2,
  instances: [],
});
await emitBus("subagent:async-complete", {
  lifecycleArtifactVersion: 3,
  runId: "child-a",
  sessionId: session.file,
  triggerTurn: true,
});
await emitPi("agent_start");
await emitPi("agent_settled");
"#
        .replace(
            "__ASYNC_DIR__",
            &serde_json::to_string(&async_dir).expect("encode async directory"),
        )
        .replace(
            "__STATUS_PATH__",
            &serde_json::to_string(&status_path).expect("encode status path"),
        );
        let result = run_pi_extension_scenario(&scenario);
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "became_busy", "started", "ended"]);
    }

    #[test]
    fn pi_extension_keeps_unreadable_live_runs_but_drops_terminal_runs_at_settlement() {
        let root = tempfile::tempdir().expect("create reconciliation fixture directory");
        let terminal_dir = write_async_status(
            root.path(),
            "terminal",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "child-a",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "complete",
                "startedAt": 1,
            }),
        );
        let missing_dir = root.path().join("missing").to_string_lossy().into_owned();

        for (async_dir, expected) in [
            (terminal_dir, vec!["started", "ended"]),
            (missing_dir, vec!["started", "became_busy"]),
        ] {
            let scenario = r#"
await emitPi("agent_start");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "child-a",
  sessionId: session.file,
  asyncDir: __ASYNC_DIR__,
});
await emitPi("agent_settled");
"#
            .replace(
                "__ASYNC_DIR__",
                &serde_json::to_string(&async_dir).expect("encode async directory"),
            );
            let result = run_pi_extension_scenario(&scenario);
            let kinds: Vec<_> = result["payloads"]
                .as_array()
                .expect("payloads should be an array")
                .iter()
                .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
                .collect();
            assert_eq!(kinds, expected);
        }
    }

    #[test]
    fn pi_extension_reconciles_terminal_status_without_a_completion_event() {
        let root = tempfile::tempdir().expect("create reconciliation fixture directory");
        let async_dir = write_async_status(
            root.path(),
            "terminal-later",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "child-a",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let status_path = Path::new(&async_dir).join("status.json");
        let scenario = r#"
await emitPi("agent_start");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "child-a",
  sessionId: session.file,
  asyncDir: __ASYNC_DIR__,
});
await emitPi("agent_settled");
const { writeFile } = await import("node:fs/promises");
await writeFile(__STATUS_PATH__, JSON.stringify({
  lifecycleArtifactVersion: 3,
  runId: "child-a",
  sessionId: session.file,
  mode: "single",
  state: "complete",
  startedAt: 1,
}));
await emitBus("subagent:process-terminal", {
  version: 1,
  runId: "child-a",
  state: "observed",
  runnerProcessInstanceId: "runner-a",
  observedAt: 2,
  instances: [],
});
await new Promise((resolve) => setTimeout(resolve, TERMINAL_RECONCILIATION_DELAY_MS + 50));
"#
        .replace(
            "__ASYNC_DIR__",
            &serde_json::to_string(&async_dir).expect("encode async directory"),
        )
        .replace(
            "__STATUS_PATH__",
            &serde_json::to_string(&status_path).expect("encode status path"),
        );
        let result = run_pi_extension_scenario(&scenario);
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "became_busy", "ended"]);
    }

    #[test]
    fn pi_extension_recovers_active_async_runs_from_session_entries() {
        for (state, reason) in [
            ("queued", "startup"),
            ("running", "reload"),
            ("running", "resume"),
        ] {
            let root = tempfile::tempdir().expect("create recovery fixture directory");
            let run_id = format!("child-{state}-{reason}");
            let async_dir = write_async_status(
                root.path(),
                state,
                serde_json::json!({
                    "lifecycleArtifactVersion": 3,
                    "runId": run_id,
                    "sessionId": "/tmp/session.jsonl",
                    "mode": "single",
                    "state": state,
                    "startedAt": 1,
                }),
            );
            let entries = serde_json::json!([subagent_tool_result(&run_id, &async_dir)]);
            let scenario = format!(
                "session.entries = {};\nawait emitPi(\"session_start\", {{ reason: {} }});",
                serde_json::to_string(&entries).expect("encode session entries"),
                serde_json::to_string(reason).expect("encode session start reason")
            );
            let result = run_pi_extension_scenario(&scenario);
            let kinds: Vec<_> = result["payloads"]
                .as_array()
                .expect("payloads should be an array")
                .iter()
                .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
                .collect();
            assert_eq!(kinds, ["became_busy"], "state {state}, reason {reason}");
        }
    }

    #[test]
    fn pi_extension_recovers_an_older_active_run_after_many_terminal_results() {
        let root = tempfile::tempdir().expect("create recovery fixture directory");
        let active_dir = write_async_status(
            root.path(),
            "active",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "active",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let mut entries = vec![subagent_tool_result("active", &active_dir)];
        for index in 0..128 {
            let run_id = format!("terminal-{index}");
            let async_dir = write_async_status(
                root.path(),
                &run_id,
                serde_json::json!({
                    "lifecycleArtifactVersion": 3,
                    "runId": run_id,
                    "sessionId": "/tmp/session.jsonl",
                    "mode": "single",
                    "state": "complete",
                    "startedAt": 2,
                }),
            );
            entries.push(subagent_tool_result(&run_id, &async_dir));
        }
        let scenario = format!(
            "session.entries = {};\nawait emitPi(\"session_start\", {{ reason: \"reload\" }});",
            serde_json::to_string(&entries).expect("encode session entries"),
        );

        let result = run_pi_extension_scenario(&scenario);
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["became_busy"]);
    }

    #[test]
    fn pi_extension_ignores_non_active_or_untrusted_recovery_artifacts() {
        let root = tempfile::tempdir().expect("create recovery fixture directory");
        let terminal = write_async_status(
            root.path(),
            "terminal",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "terminal",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "complete",
                "startedAt": 1,
            }),
        );
        let wrong_session = write_async_status(
            root.path(),
            "wrong-session",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "wrong-session",
                "sessionId": "/tmp/different-session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let unsupported = write_async_status(
            root.path(),
            "unsupported",
            serde_json::json!({
                "lifecycleArtifactVersion": 2,
                "runId": "unsupported",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let malformed = root.path().join("malformed");
        std::fs::create_dir_all(&malformed).expect("create malformed fixture directory");
        std::fs::write(malformed.join("status.json"), b"not json").expect("write malformed status");
        let unreadable = root.path().join("unreadable");
        std::fs::create_dir_all(unreadable.join("status.json"))
            .expect("create unreadable status fixture");
        let missing = root.path().join("missing");
        let oversized = root.path().join("oversized");
        std::fs::create_dir_all(&oversized).expect("create oversized status fixture");
        std::fs::write(oversized.join("status.json"), vec![b'x'; 64_001])
            .expect("write oversized status");
        let _unrecorded = write_async_status(
            root.path(),
            "unrecorded",
            serde_json::json!({
                "lifecycleArtifactVersion": 3,
                "runId": "unrecorded",
                "sessionId": "/tmp/session.jsonl",
                "mode": "single",
                "state": "running",
                "startedAt": 1,
            }),
        );
        let entries = serde_json::json!([
            subagent_tool_result("terminal", &terminal),
            subagent_tool_result("wrong-session", &wrong_session),
            subagent_tool_result("unsupported", &unsupported),
            subagent_tool_result("malformed", &malformed.to_string_lossy()),
            subagent_tool_result("unreadable", &unreadable.to_string_lossy()),
            subagent_tool_result("missing", &missing.to_string_lossy()),
            subagent_tool_result("oversized", &oversized.to_string_lossy()),
            {
                "type": "message",
                "message": {
                    "role": "toolResult",
                    "toolName": "other-tool",
                    "details": { "asyncId": "unrecorded", "asyncDir": _unrecorded },
                },
            },
        ]);
        let scenario = format!(
            "session.entries = {};\nawait emitPi(\"session_start\", {{ reason: \"reload\" }});\nawait emitPi(\"agent_settled\");",
            serde_json::to_string(&entries).expect("encode session entries")
        );
        let result = run_pi_extension_scenario(&scenario);
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["ended"]);
    }

    #[test]
    fn pi_extension_disposes_background_event_subscriptions_on_shutdown() {
        let result = run_pi_extension_scenario(
            r#"
await emitPi("agent_start");
await emitPi("session_shutdown");
await emitBus("subagent:async-started", {
  lifecycleArtifactVersion: 3,
  id: "after-shutdown",
  sessionId: session.file,
  asyncDir: "/tmp/after-shutdown",
});
await emitPi("agent_settled");
"#,
        );
        let kinds: Vec<_> = result["payloads"]
            .as_array()
            .expect("payloads should be an array")
            .iter()
            .map(|payload| payload["kind"].as_str().expect("kind should be a string"))
            .collect();
        assert_eq!(kinds, ["started", "ended"]);
    }

    #[test]
    fn pi_extension_install_dir_uses_openforge_config() {
        let dir = get_pi_extension_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with("openforge/pi-extension"));
    }
}
