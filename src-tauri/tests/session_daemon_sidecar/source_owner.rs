use super::*;
use std::os::unix::process::CommandExt;

pub(super) fn launcher(sidecar: &Command, log_path: &std::path::Path) -> Command {
    let log = fs::OpenOptions::new().append(true).open(log_path).unwrap();
    let mut owner = Command::new(std::env::current_exe().unwrap());
    owner
        .args([
            "--exact",
            "source_owner::source_owner_child",
            "--ignored",
            "--nocapture",
        ])
        .env_clear()
        .envs(
            sidecar
                .get_envs()
                .filter_map(|(key, value)| value.map(|value| (key, value))),
        )
        .env("OPENFORGE_SOURCE_OWNER_CHILD", "1")
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    owner
}

#[test]
#[ignore = "owned subprocess fixture"]
fn source_owner_child() {
    if std::env::var("OPENFORGE_SOURCE_OWNER_CHILD").as_deref() != Ok("1") {
        return;
    }
    let root = PathBuf::from(std::env::var_os("OPENFORGE_APP_DATA_DIR").unwrap());
    let mut command = Command::new(env!("CARGO_BIN_EXE_openforge"));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    // The kernel expires this fixture if the parent-loss regression leaves it orphaned.
    // The observer never signals an orphan PID, including on a failing assertion.
    // SAFETY: alarm and signal only configure this forked child's signal state before exec.
    unsafe {
        command.pre_exec(|| {
            libc::signal(libc::SIGALRM, libc::SIG_DFL);
            libc::alarm(60);
            Ok(())
        });
    }
    let mut child = command.spawn().unwrap();
    fs::write(root.join("source-sidecar.pid"), child.id().to_string()).unwrap();
    let status = child.wait().unwrap();
    assert!(
        status.success(),
        "source fixture expired or failed: {status}"
    );
}

fn exited(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let state = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let status = String::from_utf8(state.stdout).unwrap();
        if status.trim().starts_with('Z')
            || (state.status.code() == Some(1) && status.trim().is_empty())
        {
            return true;
        }
        assert!(
            state.status.success(),
            "could not observe owned source Sidecar"
        );
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub(super) fn wait_for_fixture_exit(root: &std::path::Path) -> Result<(), String> {
    let pid = fs::read_to_string(root.join("source-sidecar.pid"))
        .map_err(|error| format!("source Sidecar identity is unknown: {error}"))?
        .parse()
        .map_err(|error| format!("invalid source Sidecar identity: {error}"))?;
    if exited(pid, Duration::from_secs(60)) {
        Ok(())
    } else {
        Err("source Sidecar did not reach its private expiry".into())
    }
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn source_parent_loss_retires_the_sidecar_without_quit_cleanup() {
    let mut fixture = Fixture::new();
    fixture.source_owner = true;
    fixture.use_installation_daemon();
    fixture.start("first");
    let instance = fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    fixture.write(
        "stty -echo; kept=source; printf '\\nBEFORE=%s\\n' \"$$\"; tty; printf 'source-ready\\n'\n",
    );
    let before = fixture.output("source-ready\r\n");
    let pid = regex::Regex::new(r"BEFORE=([0-9]+)")
        .unwrap()
        .captures(&before)
        .unwrap()[1]
        .to_string();
    let tty = regex::Regex::new(r"/dev/tty[^\r\n ]+")
        .unwrap()
        .find(&before)
        .unwrap()
        .as_str()
        .to_string();
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    assert_eq!(inventory["parentExitGuardArmed"], true);
    let controller = serde_json::from_value(inventory["controller"].clone()).unwrap();
    let maintenance =
        openforge_session_client::MaintenanceClient::attach(&fixture.daemon_root(), controller)
            .unwrap();
    let daemon = maintenance.capabilities().unwrap();
    let sidecar: u32 = fs::read_to_string(fixture.root.path().join("source-sidecar.pid"))
        .unwrap()
        .parse()
        .unwrap();

    // Only this owned parent handle is signalled. Its Sidecar is observed, never signalled.
    let mut owner = fixture.child.take().unwrap();
    owner.kill().unwrap();
    owner.wait().unwrap();
    let retired = exited(sidecar, Duration::from_secs(2));
    if !retired {
        fs::write(
            fixture.root.path().join("source-owner-expiry.txt"),
            b"source Sidecar outlived its app; waiting for its private kernel expiry",
        )
        .unwrap();
        if !exited(sidecar, Duration::from_secs(60)) {
            fixture.root.disable_cleanup(true);
            // Do not acquire a controller or remove evidence while this process may be healthy.
            std::mem::forget(fixture);
            panic!("source Sidecar did not reach its private expiry");
        }
    }
    assert!(retired, "source Sidecar outlived its owning app");
    assert_eq!(maintenance.capabilities().unwrap().pid, daemon.pid);
    assert_eq!(maintenance.inventory().unwrap().sessions.len(), 1);

    fixture.source_owner = false;
    fixture.start("second");
    let replay = fixture.invoke(
        "get_pty_buffer",
        json!({ "shellSessionKey": fixture.shell_key }),
    );
    assert_eq!(replay["instanceId"], instance);
    assert_eq!(replay["isLive"], true);
    fixture.write("printf '\\nAFTER=%s:%s\\n' \"$$\" \"$kept\"; tty; printf 'source-resumed\\n'\n");
    let after = fixture.output("source-resumed\r\n");
    assert!(after.contains(&format!("AFTER={pid}:source")));
    assert_eq!(after.matches(&tty).count(), 2);
}
