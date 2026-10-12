use log::info;
use std::fs;
use std::path::{Path, PathBuf};

fn openforge_cli_path(config_dir: &Path) -> PathBuf {
    config_dir.join("openforge").join("cli").join("cli.js")
}

pub(super) fn openforge_bin_dir(home_dir: &Path) -> PathBuf {
    home_dir.join(".openforge").join("bin")
}

/// Runs the CLI with `OPENFORGE_NODE` when set, else the first `node` on PATH.
/// The entry script itself rejects a Node that is too old.
fn build_cli_launcher(cli_path: &Path) -> String {
    format!(
        r#"#!/bin/sh
node="${{OPENFORGE_NODE:-node}}"
if ! command -v "$node" >/dev/null 2>&1; then
  printf 'openforge needs Node.js %s or newer, but %s was not found.\nInstall Node.js, or set OPENFORGE_NODE to the path of a node binary.\n' {min} "$node" >&2
  exit 127
fi
exec "$node" '{path}' "$@"
"#,
        min = super::payload::MIN_NODE_MAJOR,
        path = cli_path.to_string_lossy().replace('\'', "'\"'\"'")
    )
}

pub fn install_cli_launcher(
    home_dir: &Path,
    config_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_dir = openforge_bin_dir(home_dir);
    fs::create_dir_all(&bin_dir)?;

    let launcher = bin_dir.join("openforge");
    super::payload::atomic_write(
        &launcher,
        build_cli_launcher(&openforge_cli_path(config_dir)).as_bytes(),
        true,
    )?;

    info!("[cli_installer] OpenForge CLI launcher installed");
    Ok(launcher)
}

pub fn ensure_zshrc_path(
    home_dir: &Path,
    bin_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    fs::create_dir_all(home_dir)?;
    let zshrc = home_dir.join(".zshrc");
    let existing = fs::read_to_string(&zshrc).unwrap_or_default();
    let marker = "# OpenForge CLI";

    let has_openforge_path = existing.contains(&bin_dir.to_string_lossy().to_string())
        || existing.contains("$HOME/.openforge/bin")
        || existing.contains("${HOME}/.openforge/bin");

    if !existing.contains(marker) && !has_openforge_path {
        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str("\n# OpenForge CLI\nexport PATH=\"$HOME/.openforge/bin:$PATH\"\n");
        fs::write(&zshrc, updated)?;
        info!("[cli_installer] Added OpenForge CLI path to shell profile");
    }

    Ok(zshrc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_install_cli_launcher_writes_openforge_command_wrapper() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let config = tmp_dir.path().join("config");

        let launcher = install_cli_launcher(&home, &config).expect("install cli launcher");

        assert_eq!(launcher, home.join(".openforge/bin/openforge"));
        let content = std::fs::read_to_string(&launcher).unwrap();
        assert!(content.starts_with("#!/bin/sh"));
        assert!(content.contains("openforge/cli/cli.js"));
        let obsolete_segment = ["mcp", "server"].join("-");
        assert!(!content.contains(&obsolete_segment));
        assert!(content.contains("exec \"$node\""));
        assert!(content.contains("${OPENFORGE_NODE:-node}"));
    }

    #[cfg(unix)]
    #[test]
    fn launcher_explains_a_missing_node_instead_of_a_shell_error() {
        let tmp = tempfile::tempdir().unwrap();
        let launcher =
            install_cli_launcher(&tmp.path().join("home"), &tmp.path().join("config")).unwrap();

        let output = std::process::Command::new(&launcher)
            .arg("--help")
            .env_clear()
            .env("PATH", tmp.path())
            .output()
            .unwrap();

        assert_eq!(output.status.code(), Some(127));
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("openforge needs Node.js 18 or newer"),
            "{stderr}"
        );
        assert!(stderr.contains("OPENFORGE_NODE"), "{stderr}");
    }

    #[cfg(unix)]
    #[test]
    fn launcher_prefers_openforge_node_over_path() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config");
        let payload = openforge_cli_path(&config);
        fs::create_dir_all(payload.parent().unwrap()).unwrap();
        fs::write(&payload, "echo pinned\n").unwrap();
        let pinned = tmp.path().join("pinned node");
        fs::write(&pinned, "#!/bin/sh\nexec /bin/sh \"$@\"\n").unwrap();
        fs::set_permissions(&pinned, fs::Permissions::from_mode(0o755)).unwrap();
        let launcher = install_cli_launcher(&tmp.path().join("home"), &config).unwrap();

        let output = std::process::Command::new(&launcher)
            .env_clear()
            .env("PATH", "/nonexistent")
            .env("OPENFORGE_NODE", &pinned)
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout), "pinned\n");
    }

    #[cfg(unix)]
    #[test]
    fn installed_launcher_executes_literal_paths_and_forwards_arguments() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        for directory in [
            "config",
            "config with spaces",
            "$(> injected)",
            "`> injected`",
            "$LAUNCHER_TEST_EXPANSION",
            "double\"quote",
            "single'quote",
            "back\\slash",
            "line\nbreak",
            "'\"$(> injected)`> injected`$LAUNCHER_TEST_EXPANSION\\",
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let config = tmp.path().join(directory);
            let payload = openforge_cli_path(&config);
            fs::create_dir_all(payload.parent().unwrap()).unwrap();
            fs::write(&payload, "printf '%s\\0' \"$0\" \"$@\"\nexit 37\n").unwrap();

            // Stand in for Node so this shell-boundary test needs no Node installation.
            let node = tmp.path().join("node");
            fs::write(&node, "#!/bin/sh\nexec /bin/sh \"$@\"\n").unwrap();
            fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
            let launcher = install_cli_launcher(&tmp.path().join("home"), &config).unwrap();
            let args = [
                "",
                "two words",
                "'\"$HOME`> argument-injected`$(> argument-injected)\\",
                "*",
            ];
            let output = Command::new(&launcher)
                .current_dir(tmp.path())
                .env_clear()
                .env("PATH", tmp.path())
                .env("LAUNCHER_TEST_EXPANSION", "expanded")
                .args(args)
                .output()
                .unwrap();

            assert!(
                !tmp.path().join("injected").exists(),
                "command ran for {directory:?}"
            );
            assert!(!tmp.path().join("argument-injected").exists());
            assert_eq!(
                output.status.code(),
                Some(37),
                "payload failed for {directory:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let mut expected = payload.as_os_str().as_encoded_bytes().to_vec();
            expected.push(0);
            for arg in args {
                expected.extend_from_slice(arg.as_bytes());
                expected.push(0);
            }
            assert_eq!(
                output.stdout, expected,
                "arguments changed for {directory:?}"
            );
        }
    }

    #[test]
    fn test_ensure_zshrc_path_adds_openforge_bin_once() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let bin_dir = home.join(".openforge").join("bin");
        std::fs::create_dir_all(&home).unwrap();

        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path");
        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path idempotently");

        let zshrc = std::fs::read_to_string(home.join(".zshrc")).unwrap();
        assert_eq!(zshrc.matches("# OpenForge CLI").count(), 1);
        assert!(zshrc.contains("export PATH=\"$HOME/.openforge/bin:$PATH\""));
    }

    #[test]
    fn test_ensure_zshrc_path_does_not_duplicate_existing_home_path() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let bin_dir = home.join(".openforge").join("bin");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join(".zshrc"),
            "export PATH=\"$HOME/.openforge/bin:$PATH\"\n",
        )
        .unwrap();

        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path idempotently");

        let zshrc = std::fs::read_to_string(home.join(".zshrc")).unwrap();
        assert_eq!(zshrc.matches(".openforge/bin").count(), 1);
        assert!(!zshrc.contains("# OpenForge CLI"));
    }
}
