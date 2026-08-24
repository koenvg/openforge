use log::info;
use std::fs;
use std::path::{Path, PathBuf};

fn openforge_cli_path(config_dir: &Path) -> PathBuf {
    config_dir.join("openforge").join("cli").join("cli.js")
}

pub(super) fn openforge_bin_dir(home_dir: &Path) -> PathBuf {
    home_dir.join(".openforge").join("bin")
}

fn build_cli_launcher(cli_path: &Path) -> String {
    format!(
        "#!/bin/sh\nexec node \"{}\" \"$@\"\n",
        cli_path.to_string_lossy()
    )
}

pub fn install_cli_launcher(
    home_dir: &Path,
    config_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_dir = openforge_bin_dir(home_dir);
    fs::create_dir_all(&bin_dir)?;

    let launcher = bin_dir.join("openforge");
    fs::write(
        &launcher,
        build_cli_launcher(&openforge_cli_path(config_dir)),
    )?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&launcher)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&launcher, permissions)?;
    }

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
        assert!(content.contains("exec node"));
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
