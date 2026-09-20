use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

pub(super) fn record(fixture: &Fixture, sequence: usize) -> Value {
    let marker = format!("PROVIDER-PROOF-{sequence} ");
    let output = fixture.output(&marker);
    let record = output
        .lines()
        .rev()
        .find_map(|line| line.split_once(&marker).map(|(_, value)| value))
        .unwrap();
    serde_json::from_str(record.trim()).unwrap()
}

#[derive(Clone, Copy)]
enum Provider {
    ClaudeCode,
    Codex,
    OpenCode,
    Grok,
}

impl Provider {
    fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }

    fn executable(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }

    fn uses_fixture_auth(self) -> bool {
        matches!(self, Self::OpenCode | Self::Grok)
    }

    fn notifications(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::OpenCode | Self::Grok => &[
                ("requested_permission", "paused"),
                ("input_wait", "paused"),
                ("became_busy", "running"),
                ("became_idle", "completed"),
                ("ended", "completed"),
            ],
            Self::ClaudeCode | Self::Codex => &[
                ("requested_permission", "paused"),
                ("became_busy", "running"),
                ("became_idle", "completed"),
                ("ended", "completed"),
            ],
        }
    }

    fn assert_initial_record(self, before: &Value, task_id: &str, repo: &Path) {
        assert_eq!(before["task"], task_id);
        assert_eq!(before["provider"], self.name());
        if self.uses_fixture_auth() {
            assert_eq!(before["auth"], "fixture-auth-only");
            assert_eq!(before["term"], "xterm-256color");
            assert_eq!(before["termProgram"], "vscode");
            assert_eq!(
                before["imageSession"],
                Value::Null,
                "unsupported images stay disabled"
            );
            assert_eq!(
                PathBuf::from(before["cwd"].as_str().unwrap()),
                repo.canonicalize().unwrap()
            );
        }
        if matches!(self, Self::ClaudeCode) {
            assert_eq!(before["claudeTask"], task_id);
        }
    }

    fn assert_launch_arguments(self, arguments: &[String], fixture: &Fixture, repo: &Path) {
        match self {
            Self::ClaudeCode => {
                assert!(arguments
                    .windows(2)
                    .any(|args| args == ["--permission-mode", "plan"]));
                let settings = arguments
                    .windows(2)
                    .find(|args| args[0] == "--settings")
                    .unwrap();
                assert!(PathBuf::from(&settings[1]).is_file());
                let trust: Value = serde_json::from_slice(
                    &fs::read(fixture.root.path().join("home/.claude.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(
                    trust[repo.canonicalize().unwrap().to_str().unwrap()]["hasTrustDialogAccepted"],
                    true
                );
            }
            Self::Codex => {
                assert!(arguments
                    .windows(2)
                    .any(|args| args == ["--profile", "openforge-lifecycle"]));
                assert!(fixture
                    .root
                    .path()
                    .join("home/.codex/openforge-lifecycle.config.toml")
                    .is_file());
            }
            Self::OpenCode => {
                assert!(!arguments.iter().any(|arg| arg == "--agent"));
                assert!(arguments.iter().any(|arg| arg == "--prompt"));
                assert!(!arguments.iter().any(|arg| arg == "--permission-mode"));
            }
            Self::Grok => {
                assert!(arguments
                    .windows(2)
                    .any(|args| args == ["--permission-mode", "plan"]));
                assert_eq!(arguments[arguments.len() - 2], "--");
            }
        }
    }

    fn assert_restored_session(self, session: &Value) {
        match self {
            Self::ClaudeCode => {
                assert_eq!(session["claude_session_id"], "claude-code-native-session");
            }
            Self::OpenCode => {
                assert_eq!(session["opencode_session_id"], "ses_opencode_native");
            }
            Self::Grok => {
                assert_eq!(session["grok_session_id"], "grok-native-session");
            }
            Self::Codex => {}
        }
    }
}

struct ProviderLaunch {
    session_id: String,
    controller: Value,
    before: Value,
    instance: u64,
}

fn prepare_fixture(provider: Provider) -> (Fixture, PathBuf) {
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    let repo = fixture.root.path().join("repo");
    fs::create_dir(&repo).unwrap();
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&repo)
        .status()
        .unwrap()
        .success());

    let bin = fixture.root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    fs::write(
        bin.join(provider.executable()),
        include_str!("provider-fixture.cjs"),
    )
    .unwrap();
    fs::write(
        bin.join("provider-hooks.cjs"),
        include_str!("provider-hooks.cjs"),
    )
    .unwrap();
    fs::set_permissions(
        bin.join(provider.executable()),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    fixture.provider_bin = Some(bin);
    if provider.uses_fixture_auth() {
        // Synthetic credentials only. Never import the developer's auth into the proof.
        fixture
            .provider_env
            .push(("XAI_API_KEY".into(), "fixture-auth-only".into()));
    }
    fixture.start("setup");
    (fixture, repo)
}

fn create_provider_task(fixture: &Fixture, provider: Provider, repo: &Path) -> String {
    let project = fixture.invoke(
        "create_project",
        json!({"name":"Provider preservation proof", "path":repo}),
    );
    fixture.invoke(
        "set_project_config",
        json!({"projectId":project["id"], "key":"ai_provider", "value":provider.name()}),
    );
    let task = fixture.invoke(
        "create_task",
        json!({"initialPrompt":"Keep the current tool running", "status":"backlog", "projectId":project["id"], "worktreeSource":"disabled", "permissionMode":"plan"}),
    );
    task["id"].as_str().unwrap().to_string()
}

fn launch_provider(
    fixture: &mut Fixture,
    provider: Provider,
    repo: &Path,
    task_id: &str,
) -> ProviderLaunch {
    fixture
        .agent_selection
        .push((provider.executable().into(), task_id.into()));
    fixture.shell_key = task_id.into();
    fixture.replace();

    let started = fixture.invoke(
        "start_implementation",
        json!({"taskId":task_id, "repoPath":repo, "terminalImageProtocol":"iterm2"}),
    );
    assert!(started["session_id"].is_string());
    let session_id = started["session_id"].as_str().unwrap().to_string();
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    assert_eq!(
        inventory["sessions"].as_array().unwrap().len(),
        1,
        "provider must be daemon-owned before replacement"
    );

    let before = record(fixture, 0);
    let instance = before["instance"].as_str().unwrap().parse::<u64>().unwrap();
    assert_eq!(inventory["sessions"][0]["instanceId"], instance);
    assert!(before["tty"].as_str().unwrap().starts_with("/dev/"));
    assert_eq!(before["controllerTokenAbsent"], true);
    provider.assert_initial_record(&before, task_id, repo);

    let arguments: Vec<String> = serde_json::from_str(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert!(arguments
        .iter()
        .any(|arg| arg.contains("Keep the current tool running")));
    assert!(!arguments.iter().any(|arg| matches!(
        arg.as_str(),
        "--resume" | "resume" | "--continue" | "--session"
    )));
    provider.assert_launch_arguments(&arguments, fixture, repo);

    ProviderLaunch {
        session_id,
        controller: inventory["controller"].clone(),
        before,
        instance,
    }
}

struct ProviderPreservation {
    fixture: Fixture,
    provider: Provider,
    repo: PathBuf,
    task_id: String,
    session_id: String,
    controller: Value,
    before: Value,
    instance: u64,
}

impl ProviderPreservation {
    fn launch(provider: Provider) -> Self {
        let (mut fixture, repo) = prepare_fixture(provider);
        let task_id = create_provider_task(&fixture, provider, &repo);
        let launch = launch_provider(&mut fixture, provider, &repo, &task_id);
        Self {
            fixture,
            provider,
            repo,
            task_id,
            session_id: launch.session_id,
            controller: launch.controller,
            before: launch.before,
            instance: launch.instance,
        }
    }

    fn stop_sidecar(&mut self) {
        let mut child = self.fixture.child.take().unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
    }

    fn reconcile_stale_history(&mut self) {
        let old_fence = json!({"controller":self.controller, "instanceId":self.instance});
        // Seed stale history while the Sidecar is absent, leaving the live allocation authoritative.
        self.stop_sidecar();
        let db =
            rusqlite::Connection::open(self.fixture.root.path().join("openforge_dev.db")).unwrap();
        db.execute(
            "UPDATE agent_sessions SET updated_at=1 WHERE ticket_id=?1",
            [&self.task_id],
        )
        .unwrap();
        db.execute(
            "INSERT INTO agent_sessions(id,ticket_id,stage,status,provider,pty_instance_id,created_at,updated_at) VALUES('stale-provider',?1,'implementing','running',?2,?3,0,1)",
            rusqlite::params![
                self.task_id,
                self.provider.name(),
                i64::try_from(self.instance + 1).unwrap()
            ],
        )
        .unwrap();
        drop(db);

        self.fixture.start("stale-history");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let stale = self
                .fixture
                .invoke("get_session_status", json!({"sessionId":"stale-provider"}));
            if stale["status"] == "interrupted" {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "stale allocation must not remain running: {stale}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        let current = self
            .fixture
            .invoke("get_latest_session", json!({"taskId":self.task_id}));
        assert_eq!(
            current["status"], "running",
            "live allocation must not be marked interrupted"
        );
        assert_eq!(current["id"], self.session_id);
        self.fixture.write("ping\n");
        assert_eq!(
            record(&self.fixture, 1),
            self.before,
            "agent, tool, PTY, cwd and launch environment must survive"
        );

        self.fixture.invoke(
            "pty_resize",
            json!({"shellSessionKey":self.task_id, "cols":91, "rows":33}),
        );
        self.fixture.write("geometry\ncli\n");
        self.fixture.output("PROVIDER-GEOMETRY 33 91");
        self.fixture
            .output("PROVIDER-CLI {\"status\":0,\"found\":true}");
        let response = self
            .fixture
            .http
            .post(format!("http://127.0.0.1:{}/app/invoke", self.fixture.port))
            .bearer_auth(&self.fixture.token)
            .json(&json!({
                "command":"pty_write",
                "payload":{
                    "shellSessionKey":self.task_id,
                    "data":"approve\n",
                    "fence":old_fence
                }
            }))
            .send()
            .unwrap();
        assert!(
            !response.status().is_success(),
            "stale input must be rejected"
        );
        assert!(!self.repo.join("approved").exists());
    }

    fn deliver_notifications_during_downtime(&mut self) {
        for (sequence, (kind, expected)) in self.provider.notifications().iter().enumerate() {
            self.stop_sidecar();
            fs::write(self.repo.join("notification-kind"), kind).unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                if let Ok(status) = fs::read_to_string(self.repo.join(format!("accepted-{kind}"))) {
                    assert_eq!(
                        status,
                        "202",
                        "{kind}: {}",
                        fs::read_to_string(self.repo.join("notification-error"))
                            .unwrap_or_default()
                    );
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "{} hook was not accepted during downtime",
                    self.provider.name()
                );
                std::thread::sleep(Duration::from_millis(20));
            }

            self.fixture.start(kind);
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let session = self
                    .fixture
                    .invoke("get_latest_session", json!({"taskId":self.task_id}));
                if session["status"] == *expected {
                    assert_eq!(session["id"], self.session_id);
                    assert_eq!(session["provider"], self.provider.name());
                    assert_eq!(session["pty_instance_id"], self.instance);
                    self.provider.assert_restored_session(&session);
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "{} failed to restore {expected}: {session}",
                    self.provider.name()
                );
                std::thread::sleep(Duration::from_millis(20));
            }
            self.fixture.write("ping\n");
            assert_eq!(record(&self.fixture, sequence + 2), self.before);
            assert!(
                !self.repo.join("approved").exists(),
                "permissions must never be auto-approved"
            );
        }
    }

    fn assert_diagnostics(&self) {
        let diagnostics: Value = self
            .fixture
            .http
            .get(format!(
                "http://127.0.0.1:{}/debug/process-memory",
                self.fixture.port
            ))
            .bearer_auth(&self.fixture.token)
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap();
        assert!(diagnostics["ptyProcessTrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tree| tree["taskId"] == self.task_id
                && tree["rootPid"] == self.before["pid"]
                && tree["ptyInstanceId"] == self.instance));
        assert_eq!(
            fs::read_to_string(self.repo.join("invocations.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1,
            "replacement must not resume or duplicate a provider"
        );
    }

    fn terminate(&mut self, exit_during_downtime: bool) {
        if exit_during_downtime {
            self.stop_sidecar();
            fs::write(self.repo.join("exit-now"), "exit").unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            while Command::new("kill")
                .args(["-0", &self.before["pid"].to_string()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
            {
                assert!(
                    Instant::now() < deadline,
                    "provider did not exit during downtime"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
            self.fixture.start("retained-exit");
        } else {
            self.fixture
                .invoke("pty_kill", json!({"shellSessionKey":self.task_id}));
        }
    }

    fn assert_retained_replay(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let replay = self
                .fixture
                .invoke("get_pty_buffer", json!({"shellSessionKey":self.task_id}));
            if replay["isLive"] == false {
                assert_eq!(replay["instanceId"], self.instance);
                assert!(
                    replay["snapshot"].is_object(),
                    "completed replay remains available"
                );
                break;
            }
            assert!(Instant::now() < deadline, "provider did not stop");
            std::thread::sleep(Duration::from_millis(20));
        }

        self.fixture.replace();
        let retained = self
            .fixture
            .invoke("get_pty_buffer", json!({"shellSessionKey":self.task_id}));
        assert_eq!(retained["isLive"], false);
        assert_eq!(retained["instanceId"], self.instance);
        assert_eq!(
            fs::read_to_string(self.repo.join("invocations.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1,
            "retained exits must not trigger history resume"
        );
    }
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn claude_code_keeps_agent_and_tool_through_replacement() {
    preserves_provider(Provider::ClaudeCode, false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn codex_keeps_agent_and_tool_through_replacement() {
    preserves_provider(Provider::Codex, false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn claude_code_retains_exit_during_replacement() {
    preserves_provider(Provider::ClaudeCode, true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn codex_retains_exit_during_replacement() {
    preserves_provider(Provider::Codex, true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn opencode_keeps_agent_and_tool_through_replacement() {
    preserves_provider(Provider::OpenCode, false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn grok_keeps_agent_and_tool_through_replacement() {
    preserves_provider(Provider::Grok, false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn opencode_retains_exit_during_replacement() {
    preserves_provider(Provider::OpenCode, true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn grok_retains_exit_during_replacement() {
    preserves_provider(Provider::Grok, true);
}

fn preserves_provider(provider: Provider, exit_during_downtime: bool) {
    let mut preservation = ProviderPreservation::launch(provider);
    preservation.reconcile_stale_history();
    preservation.deliver_notifications_during_downtime();
    preservation.assert_diagnostics();
    preservation.terminate(exit_during_downtime);
    preservation.assert_retained_replay();
    eprintln!(
        "{}: agent {} tool {} PTY {} survived replacement, permission/input waiting and completion; retained exit={exit_during_downtime}",
        provider.name(),
        preservation.before["pid"],
        preservation.before["toolPid"],
        preservation.instance
    );
}
