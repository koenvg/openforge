use openforge_session_client::{releases::ReleaseStore, runtime::RuntimeDirectory, Client};
use std::{fs, path::PathBuf};

struct OwnedDaemon(PathBuf);
impl Drop for OwnedDaemon {
    fn drop(&mut self) {
        if let Ok(client) = Client::connect(&self.0) {
            if let Ok(inventory) = client.inventory() {
                for session in inventory.sessions {
                    let _ = client
                        .terminate(&format!("cleanup-{}", session.pty.instance), &session.pty);
                }
            }
            let _ = client.shutdown_empty();
        }
    }
}

#[test]
fn packaged_launch_survives_bundle_removal_and_untrusted_release_refusal() {
    let root = tempfile::Builder::new()
        .prefix("of-pkg-")
        .tempdir_in("/tmp")
        .unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let daemon_root = root.path().join("app-data/session-daemon");
    fs::create_dir_all(&daemon_root).unwrap();
    let bundle = tempfile::tempdir().unwrap();
    let source = bundle.path().join("session-runtime");
    let executable = source.join("openforge-session-daemon");
    let packaging = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/electron-package/runtime-release.mjs")
        .canonicalize()
        .unwrap();
    let code = format!(
        r#"import {{ cp }} from 'node:fs/promises';
        import {{ packageRuntimeRelease }} from {};
        if (process.argv[3]) {{
            await cp(process.argv[3], process.argv[2], {{ recursive: true, force: false, errorOnExist: true }});
        }} else {{
            await packageRuntimeRelease({{ daemonPath: process.argv[1], outputPath: process.argv[2], architecture: process.arch === 'arm64' ? 'arm64' : 'x86_64' }});
        }}"#,
        serde_json::to_string(packaging.to_str().unwrap()).unwrap(),
    );
    let packaged_runtime = std::env::var_os("OPENFORGE_PACKAGED_RUNTIME").unwrap_or_default();
    eprintln!(
        "packaged runtime source: {}",
        if packaged_runtime.is_empty() {
            env!("CARGO_BIN_EXE_openforge-session-daemon").into()
        } else {
            packaged_runtime.to_string_lossy()
        }
    );
    assert!(std::process::Command::new("node")
        .args(["--input-type=module", "-e", &code])
        .arg(env!("CARGO_BIN_EXE_openforge-session-daemon"))
        .arg(&source)
        .arg(&packaged_runtime)
        .status()
        .unwrap()
        .success());
    let _owner = OwnedDaemon(daemon_root.clone());
    let client = Client::launch(&executable, &daemon_root).unwrap();
    let session = client
        .spawn(
            "packaged-shell",
            &openforge_session_protocol::ShellCommand {
                owner: openforge_session_protocol::TerminalOwner::Shell {
                    task_id: "fixture".into(),
                    index: Some(0),
                },
                command: openforge_session_protocol::PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec![],
                    cwd: root.path().into(),
                    env: Default::default(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
        )
        .unwrap();
    let runtime = RuntimeDirectory::open(&daemon_root).unwrap();
    assert!(runtime.path().join("releases").is_dir());
    let store = ReleaseStore::open(&runtime).unwrap();
    let release = store.stage(&source).unwrap();
    drop(bundle);
    let reconnected = Client::launch(&executable, &daemon_root).unwrap();
    assert_eq!(
        client.controller().lifetime,
        reconnected.controller().lifetime
    );
    let before = reconnected.inventory().unwrap();
    let error = store
        .preflight(&runtime, &release, Some(&release))
        .unwrap_err();
    assert!(error.to_string().contains("trust verification unavailable"));
    let after = reconnected.inventory().unwrap();
    assert_eq!(before.controller, after.controller);
    assert_eq!(after.sessions[0].pid, session.pid);
    assert_eq!(after.sessions[0].pty, session.pty);
    assert_eq!(after.sessions[0].exit_code, None);
    reconnected
        .write(
            "post-refusal-input",
            &session.pty,
            1,
            b"printf 'still-alive\\n'\n",
        )
        .unwrap();
    assert!(store.preflight(&runtime, &release, None).is_err());
    assert!(store.cleanup(&runtime).unwrap().is_empty());
    assert!(release.executable().is_file());
    let registry = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/desktop-test/daemon-ownership.mjs")
        .canonicalize()
        .unwrap();
    let code = format!(
        "import {{ createDaemonOwnershipRegistry }} from {}; const registry = await createDaemonOwnershipRegistry({{ mode: 'isolated', runRoot: process.argv[1] }}); await registry.cleanup();",
        serde_json::to_string(registry.to_str().unwrap()).unwrap(),
    );
    let status = std::process::Command::new("node")
        .args(["--input-type=module", "-e", &code])
        .arg(root.path())
        .status()
        .unwrap();
    assert!(
        status.success(),
        "fixture registry must terminate the live shell and detached daemon"
    );
    assert!(!runtime.socket_path().exists());
    let id = release.id().to_owned();
    drop(release);
    assert!(store.cleanup(&runtime).unwrap().is_empty());
    store
        .release_reference(&runtime, &format!("session-{id}"))
        .unwrap();
    assert_eq!(store.cleanup(&runtime).unwrap(), vec![id]);
}
