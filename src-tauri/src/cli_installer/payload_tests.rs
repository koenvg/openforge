use super::launcher_profile::install_cli_launcher;
use super::payload::write_cli_files;
use std::{
    fs,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

fn invoke(home: &Path, launcher: &Path) -> std::process::Output {
    Command::new(launcher)
        .arg("--help")
        .env("HOME", home)
        .env_remove("OPENFORGE_AGENT_CONFIG")
        .output()
        .unwrap()
}

#[test]
fn refresh_preserves_modules_needed_by_an_already_running_legacy_cli() {
    assert_inflight_version_survives_refresh(false);
}

#[test]
fn refresh_preserves_modules_needed_by_an_already_running_versioned_cli() {
    assert_inflight_version_survives_refresh(true);
}

fn assert_inflight_version_survives_refresh(versioned: bool) {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let config = temp.path().join("config");
    let install = config.join("openforge/cli");
    let runtime = if versioned {
        install.join("payloads/previous")
    } else {
        install.clone()
    };
    fs::create_dir_all(&runtime).unwrap();
    fs::write(
        runtime.join("cli.js"),
        r#"
const fs = require('node:fs');
fs.writeFileSync(process.env.HOME + '/ready', '');
const timer = setInterval(async () => {
  if (!fs.existsSync(process.env.HOME + '/continue')) return;
  clearInterval(timer);
  const { marker } = await import('./help.js');
  console.log(marker);
}, 10);
"#,
    )
    .unwrap();
    fs::write(
        runtime.join("help.js"),
        "export const marker = 'legacy-complete';",
    )
    .unwrap();
    if versioned {
        fs::write(
            install.join("cli.js"),
            "import('./payloads/previous/cli.js');\n",
        )
        .unwrap();
    }
    let launcher = install_cli_launcher(&home, &config).unwrap();
    let mut child = Command::new(&launcher)
        .env("HOME", &home)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !home.join("ready").exists() {
        if Instant::now() > deadline {
            child.kill().unwrap();
            panic!("legacy CLI did not start");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    write_cli_files(&install).unwrap();
    fs::write(home.join("continue"), "").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "legacy-complete"
    );
    let output = invoke(&home, &launcher);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("openforge task create"));
}

#[cfg(unix)]
fn write_executable(path: &Path, contents: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, contents).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

/// Node before 22.7 never guesses that a `.js` file is ESM. Turning detection
/// off on a newer Node reproduces that, so the payload must say so itself.
#[cfg(unix)]
#[test]
fn installed_cli_runs_on_a_node_without_module_detection() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let config = temp.path().join("config");
    write_cli_files(&config.join("openforge/cli")).unwrap();
    let launcher = install_cli_launcher(&home, &config).unwrap();
    let node = temp.path().join("node-without-detection");
    write_executable(
        &node,
        "#!/bin/sh\nif node --no-experimental-detect-module -e 0 >/dev/null 2>&1; then\n  exec node --no-experimental-detect-module \"$@\"\nfi\nexec node \"$@\"\n",
    );

    let output = Command::new(&launcher)
        .arg("--help")
        .env("HOME", &home)
        .env("OPENFORGE_NODE", &node)
        .env_remove("OPENFORGE_AGENT_CONFIG")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("openforge task complete"));
}

#[test]
fn installed_cli_refuses_an_old_node_with_a_readable_message() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let config = temp.path().join("config");
    write_cli_files(&config.join("openforge/cli")).unwrap();
    let launcher = install_cli_launcher(&home, &config).unwrap();
    let old_node = temp.path().join("old-node.cjs");
    fs::write(
        &old_node,
        "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '16.20.0' } });\nObject.defineProperty(process, 'version', { value: 'v16.20.0' });\n",
    )
    .unwrap();

    let output = Command::new(&launcher)
        .arg("--help")
        .env("HOME", &home)
        .env("NODE_OPTIONS", format!("--require {}", old_node.display()))
        .env_remove("OPENFORGE_AGENT_CONFIG")
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("openforge needs Node.js 18 or newer") && stderr.contains("v16.20.0"),
        "{stderr}"
    );
    assert!(
        !stderr.contains("    at "),
        "no stack trace expected: {stderr}"
    );
}

#[test]
fn failed_refresh_keeps_the_previous_cli_usable() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let config = temp.path().join("config");
    let install = config.join("openforge/cli");
    write_cli_files(&install).unwrap();
    let launcher = install_cli_launcher(&home, &config).unwrap();
    let previous = fs::read(install.join("cli.js")).unwrap();
    // Fail after staging, before publishing discovery.
    fs::remove_file(install.join("openforge-skill.md")).unwrap();
    fs::create_dir(install.join("openforge-skill.md")).unwrap();
    assert!(write_cli_files(&install).is_err());
    assert_eq!(fs::read(install.join("cli.js")).unwrap(), previous);
    let output = invoke(&home, &launcher);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("openforge task create"));
}

#[cfg(unix)]
#[test]
fn installed_cli_invocations_race_refresh_and_keep_the_inherited_agent_route() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Barrier;

    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let config = temp.path().join("config");
    let install = config.join("openforge/cli");
    write_cli_files(&install).unwrap();
    let launcher = install_cli_launcher(&home, &config).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
    let agent_config = home.join("agent.json");
    fs::write(
        &agent_config,
        serde_json::json!({
            "version": 1, "port": listener.local_addr().unwrap().port(), "token": "a".repeat(64)
        })
        .to_string(),
    )
    .unwrap();
    fs::set_permissions(&agent_config, fs::Permissions::from_mode(0o600)).unwrap();
    let barrier = Barrier::new(6);
    std::thread::scope(|scope| {
        let server = scope.spawn(|| {
            let deadline = Instant::now() + Duration::from_secs(30);
            let mut requests = 0;
            while requests < 24 && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("accept agent request: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                    assert!(request.len() < 8192);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /projects HTTP/1.1\r\n"));
                assert!(request.to_lowercase().contains(&format!("authorization: bearer {}", "a".repeat(64))));
                let body = r#"[{"id":"P-inherited"}]"#;
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                requests += 1;
            }
            assert_eq!(requests, 24, "not all invocations reached the inherited route");
        });
        for _ in 0..2 {
            let barrier = &barrier;
            let install = &install;
            let home = &home;
            let config = &config;
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..100 {
                    write_cli_files(install).unwrap();
                    install_cli_launcher(home, config).unwrap();
                    std::thread::sleep(Duration::from_millis(5));
                }
            });
        }
        for _ in 0..4 {
            let barrier = &barrier;
            let launcher = &launcher;
            let home = &home;
            let agent_config = &agent_config;
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..6 {
                    let output = Command::new(launcher)
                        .args(["project", "list"])
                        .env("HOME", home)
                        .env("OPENFORGE_AGENT_CONFIG", agent_config)
                        .env("OPENFORGE_HTTP_PORT", "1")
                        .output()
                        .unwrap();
                    assert!(
                        output.status.success(),
                        "{}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                    assert_eq!(
                        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(),
                        serde_json::json!([{"id": "P-inherited"}])
                    );
                }
            });
        }
        server.join().unwrap();
    });
    // Repeated installation of identical content does not accumulate new versions.
    assert_eq!(fs::read_dir(install.join("payloads")).unwrap().count(), 1);
}
