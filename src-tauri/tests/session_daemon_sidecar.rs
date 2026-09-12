//! Isolated real-process contract. Never launches or stops the installed desktop app.
use base64::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct Fixture {
    root: tempfile::TempDir,
    child: Option<Child>,
    port: u16,
    shell_key: String,
    token: String,
    http: reqwest::blocking::Client,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("of-replace-")
            .tempdir_in("/tmp")
            .unwrap();
        fs::create_dir(root.path().join("home")).unwrap();
        Self {
            root,
            child: None,
            port: 0,
            shell_key: "T-proof-shell-3".into(),
            token: String::new(),
            http: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }
    fn start(&mut self, stage: &str) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        self.port = listener.local_addr().unwrap().port();
        drop(listener);
        self.token = uuid::Uuid::new_v4().to_string();
        let log = fs::File::create(self.root.path().join(format!("{stage}.log"))).unwrap();
        let daemon = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("crates/session-daemon/target/debug/openforge-session-daemon");
        let mut command = Command::new(env!("CARGO_BIN_EXE_openforge"));
        command
            .args(["--host", "127.0.0.1", "--port", &self.port.to_string()])
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", self.root.path().join("home"))
            .env("SHELL", "/bin/sh")
            .env("OPENFORGE_APP_DATA_DIR", self.root.path())
            .env("OPENFORGE_ELECTRON_SIDECAR", "1")
            .env("OPENFORGE_BACKEND_TOKEN", &self.token)
            .env("OPENFORGE_BACKEND_HOST", "127.0.0.1")
            .env("OPENFORGE_BACKEND_PORT", self.port.to_string())
            .env("OPENFORGE_E2E", "1")
            .env("PRESERVATION_PROOF", stage)
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log);
        if std::env::var("OPENFORGE_SESSION_PROOF_DISABLE_DAEMON").as_deref() != Ok("1") {
            command
                .env("OPENFORGE_SESSION_DAEMON_ROOT", self.root.path())
                .env("OPENFORGE_SESSION_DAEMON_PATH", daemon)
                .env("OPENFORGE_SESSION_DAEMON_SHELL_KEY", &self.shell_key);
        }
        self.child = Some(command.spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if self
                .http
                .get(format!("http://127.0.0.1:{}/app/health", self.port))
                .bearer_auth(&self.token)
                .send()
                .is_ok_and(|response| response.status().is_success())
            {
                break;
            }
            assert!(
                self.child.as_mut().unwrap().try_wait().unwrap().is_none(),
                "Sidecar exited during startup"
            );
            assert!(Instant::now() < deadline, "Sidecar startup timeout");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    fn replace(&mut self) {
        let child = self.child.as_mut().unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
        self.child = None;
        self.start("second");
    }
    fn invoke(&self, command: &str, payload: Value) -> Value {
        let response = self
            .http
            .post(format!("http://127.0.0.1:{}/app/invoke", self.port))
            .bearer_auth(&self.token)
            .json(&json!({ "command": command, "payload": payload }))
            .send()
            .unwrap();
        let status = response.status();
        let body = response.text().unwrap();
        assert!(status.is_success(), "{command}: {status}: {body}");
        serde_json::from_str::<Value>(&body).unwrap()["value"].clone()
    }
    fn output(&self, marker: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let buffer = self.invoke(
                "get_pty_buffer",
                json!({ "shellSessionKey": self.shell_key }),
            );
            let data = buffer["snapshot"]["compatibilityData"]
                .as_str()
                .unwrap_or_default();
            let text = String::from_utf8_lossy(
                &base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .unwrap(),
            )
            .into_owned();
            if text.contains(marker) {
                return text;
            }
            assert!(Instant::now() < deadline, "missing {marker} in {text:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn write(&self, data: &str) {
        self.invoke(
            "pty_write",
            json!({ "shellSessionKey": self.shell_key, "data": data }),
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let cleanup = (|| -> Result<(), String> {
            let client = openforge_session_client::Client::connect(self.root.path())
                .map_err(|e| e.to_string())?;
            for session in client.inventory().map_err(|e| e.to_string())?.sessions {
                client
                    .terminate(
                        &format!("fixture-stop-{}", session.pty.instance),
                        &session.pty,
                    )
                    .map_err(|e| e.to_string())?;
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if client.shutdown_empty().is_ok() {
                    return Ok(());
                }
                if Instant::now() > deadline {
                    return Err("fixture daemon did not stop".into());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        })();
        if std::thread::panicking() || cleanup.is_err() {
            eprintln!(
                "daemon log: {}",
                fs::read_to_string(self.root.path().join("session-v1/daemon.log"))
                    .unwrap_or_default()
            );
            self.root.disable_cleanup(true);
            eprintln!(
                "retained fixture for diagnosis: {}",
                self.root.path().display()
            );
            for stage in ["first", "second"] {
                eprintln!(
                    "{stage} log: {}",
                    fs::read_to_string(self.root.path().join(format!("{stage}.log")))
                        .unwrap_or_default()
                );
            }
            if let Err(error) = cleanup {
                eprintln!("fixture cleanup: {error}");
            }
        }
    }
}

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn same_shell_survives_actual_sidecar_process_replacement() {
    let mut fixture = Fixture::new();
    fixture.start("first");
    let old_sidecar = fixture.child.as_ref().unwrap().id();
    let instance = fixture.invoke("pty_spawn_shell", json!({ "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24 }));
    fixture.write("stty -echo; kept=yes; printf '\\nBEFORE=%s:%s:%s\\n' \"$$\" \"$PWD\" \"$PRESERVATION_PROOF\"; tty; printf 'ready-before\\n'\n");
    let before = fixture.output("ready-before\r\n");
    let pattern = regex::Regex::new(r"BEFORE=([0-9]+):([^\r\n]+):first").unwrap();
    let captured = pattern.captures(&before).unwrap();
    let pid = captured[1].to_string();
    let cwd = captured[2].to_string();
    let tty_pattern = regex::Regex::new(r"/dev/tty[^\r\n ]+").unwrap();
    let tty = tty_pattern.find(&before).unwrap().as_str().to_string();
    fixture.replace();
    assert_ne!(fixture.child.as_ref().unwrap().id(), old_sidecar);
    let replay = fixture.invoke(
        "get_pty_buffer",
        json!({ "shellSessionKey": "T-proof-shell-3" }),
    );
    assert_eq!(replay["instanceId"], instance);
    assert_eq!(replay["isLive"], true);
    fixture.invoke(
        "pty_resize",
        json!({ "shellSessionKey": "T-proof-shell-3", "cols": 103, "rows": 39 }),
    );
    fixture.write("printf '\\nAFTER=%s:%s:%s:%s\\n' \"$$\" \"$PWD\" \"$PRESERVATION_PROOF\" \"$kept\"; tty; stty size; printf 'ready-after\\n'\n");
    let after = fixture.output("ready-after\r\n");
    assert!(after.contains(&format!("AFTER={pid}:{cwd}:first:yes")));
    assert_eq!(after.matches(&tty).count(), 2);
    assert!(after.contains("39 103"));
    println!(
        "same PID {pid}, PTY {tty}, instance {instance}; Sidecar {old_sidecar} replaced by {}",
        fixture.child.as_ref().unwrap().id()
    );
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn running_cli_fixture_uses_refreshed_payload_after_sidecar_replacement() {
    let mut fixture = Fixture::new();
    fixture.start("first");
    let project = fixture.invoke(
        "create_project",
        json!({"name":"Gateway fixture", "path":fixture.root.path()}),
    );
    let task = fixture.invoke(
        "create_task",
        json!({"initialPrompt":"Gateway fixture", "status":"backlog", "projectId":project["id"]}),
    );
    let task_id = task["id"].as_str().unwrap();
    fixture.shell_key = format!("{task_id}-shell-3");
    fixture.replace();
    let launcher = fixture.root.path().join("home/.openforge/bin/openforge");
    assert!(
        launcher.exists(),
        "Sidecar must install the CLI payload in the isolated HOME"
    );
    let script = fixture.root.path().join("agent.cjs");
    fs::write(&script, r#"
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const readline = require('node:readline');
const config = process.env.OPENFORGE_AGENT_CONFIG;
readline.createInterface({input:process.stdin}).on('line', stage => {
  const result = spawnSync(process.env.HOME + '/.openforge/bin/openforge', ['project','list'], {encoding:'utf8'});
  fs.writeFileSync(stage + '.json', JSON.stringify({pid:process.pid, configUnchanged:config === process.env.OPENFORGE_AGENT_CONFIG, status:result.status, stdout:result.stdout, stderr:result.stderr}));
});
"#).unwrap();
    let instance = fixture.invoke("pty_spawn_shell", json!({"taskId":task_id, "terminalIndex":3, "cwd":fixture.root.path(), "cols":80, "rows":24}));
    fixture.write(&format!("stty -echo; node '{}'\n", script.display()));
    fixture.write("before\n");
    let read_result = |stage: &str| {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(bytes) = fs::read(fixture.root.path().join(format!("{stage}.json"))) {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    return value;
                }
            }
            assert!(Instant::now() < deadline, "CLI fixture did not answer");
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    let before = read_result("before");
    assert_eq!(before["status"], 0, "{before}");
    fixture.replace();
    fixture.write("after\n");
    let deadline = Instant::now() + Duration::from_secs(10);
    let after: Value = loop {
        if let Ok(bytes) = fs::read(fixture.root.path().join("after.json")) {
            if let Ok(value) = serde_json::from_slice(&bytes) {
                break value;
            }
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(after["status"], 0, "{after}");
    assert_eq!(before["pid"], after["pid"]);
    assert_eq!(after["configUnchanged"], true);
    assert!(after["stdout"]
        .as_str()
        .unwrap()
        .contains("Gateway fixture"));
    let replay = fixture.invoke(
        "get_pty_buffer",
        json!({"shellSessionKey":fixture.shell_key}),
    );
    assert_eq!(replay["instanceId"], instance);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn notification_during_backend_outage_updates_the_existing_agent_session() {
    use openforge_session_protocol::{PreparedCommand, ShellCommand, TerminalOwner};
    for (provider, kind, expected) in [
        ("pi", "ended", "completed"),
        ("pi", "requested_permission", "paused"),
        ("claude-code", "ended", "completed"),
    ] {
        let mut fixture = Fixture::new();
        fixture.start("first");
        let task = fixture.invoke(
            "create_task",
            json!({"initialPrompt":"Notification outage", "status":"doing"}),
        );
        let task_id = task["id"].as_str().unwrap();
        fixture.invoke("pty_spawn_shell", json!({"taskId":"T-proof", "terminalIndex":3, "cwd":fixture.root.path(), "cols":80, "rows":24}));
        let client = openforge_session_client::Client::connect(fixture.root.path()).unwrap();
        let session = client.spawn("notification-agent", &ShellCommand {
            owner: TerminalOwner::Agent { task_id: task_id.into() },
            command: PreparedCommand {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "printf '%s' \"$OPENFORGE_AGENT_CONFIG\" > agent-config.tmp; mv agent-config.tmp agent-config; exec sleep 120".into()],
                cwd: fixture.root.path().into(), env: Default::default(),
            }, columns:80, rows:24, image_protocol:None,
        }).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let config: Value = loop {
            if let Ok(path) = fs::read_to_string(fixture.root.path().join("agent-config")) {
                break serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        };
        let identity: Value =
            serde_json::from_str(include_str!("../../openforge-data-identity.json")).unwrap();
        let filename = identity["dataIdentity"]["databaseFilenames"][if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }]
        .as_str()
        .unwrap();
        let conn = rusqlite::Connection::open(fixture.root.path().join(filename)).unwrap();
        conn.execute("INSERT INTO agent_sessions(id,ticket_id,stage,status,provider,pty_instance_id,created_at,updated_at) VALUES ('outage-session',?1,'implementing','running',?3,?2,1,1)", rusqlite::params![task_id, i64::try_from(session.pty.instance.value()).unwrap(), provider]).unwrap();
        conn.execute("INSERT OR REPLACE INTO config(key,value) VALUES ('claude_background_work_grace_seconds','5')", []).unwrap();
        let before = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
        assert_eq!(before["status"], "running");
        let mut old = fixture.child.take().unwrap();
        old.kill().unwrap();
        old.wait().unwrap();
        let envelope = json!({"id":"during-outage", "payload":{"provider":provider, "task_id":task_id, "pty_instance_id":session.pty.instance.value(), "kind":kind,
            "raw_event_type": (provider == "claude-code").then_some("stop"),
            "background_tasks": (provider == "claude-code").then(|| json!([{"id":"shell","type":"shell","status":"running"}]))
        }});
        let url = format!(
            "http://127.0.0.1:{}/notifications/agent-lifecycle",
            config["port"].as_u64().unwrap()
        );
        let accepted = fixture
            .http
            .post(&url)
            .bearer_auth(config["token"].as_str().unwrap())
            .json(&envelope)
            .send()
            .unwrap();
        assert_eq!(accepted.status(), 202);
        fixture.start("second");
        fixture.invoke(
            "get_pty_buffer",
            json!({"shellSessionKey":fixture.shell_key}),
        );
        if provider == "claude-code" {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let pending: i64 = conn
                    .query_row("SELECT COUNT(*) FROM agent_deferred_completions", [], |r| {
                        r.get(0)
                    })
                    .unwrap();
                if pending == 1 {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "Stop was not committed as a deferred obligation"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
            let mut second = fixture.child.take().unwrap();
            second.kill().unwrap();
            second.wait().unwrap();
            fixture.start("third");
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        let restored = loop {
            let restored = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
            if restored["status"] == expected {
                break restored;
            }
            assert!(
                Instant::now() < deadline,
                "notification did not restore {expected}: {restored}"
            );
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(restored["id"], "outage-session");
        assert_eq!(restored["pty_instance_id"], session.pty.instance.value());
        let revision = restored["output_revision"].clone();
        let duplicate = fixture
            .http
            .post(&url)
            .bearer_auth(config["token"].as_str().unwrap())
            .json(&envelope)
            .send()
            .unwrap();
        assert_eq!(duplicate.status(), 202);
        assert_eq!(
            fixture.invoke("get_latest_session", json!({"taskId":task_id}))["output_revision"],
            revision
        );
    }
}
