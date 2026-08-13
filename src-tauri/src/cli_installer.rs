use log::{info, warn};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const OPENFORGE_CLI_JS: &str = include_str!("openforge-cli/cli.js");
const OPENFORGE_SKILL_TEMPLATE: &str = include_str!("openforge-cli/openforge-skill.md");
const OPENFORGE_PLUGIN_DEV_SKILL_TEMPLATE: &str =
    include_str!("openforge-cli/openforge-plugin-dev-skill.md");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderSkillInstallTarget {
    pub provider: &'static str,
    pub skill_name: &'static str,
    pub path: PathBuf,
}

fn cli_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("cli"))
}

fn write_cli_files(install_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(install_dir)?;
    fs::write(install_dir.join("cli.js"), OPENFORGE_CLI_JS)?;
    fs::write(
        install_dir.join("openforge-skill.md"),
        build_openforge_skill(),
    )?;
    fs::write(
        install_dir.join("openforge-plugin-dev-skill.md"),
        build_openforge_plugin_dev_skill(),
    )?;
    info!("[cli_installer] OpenForge CLI files written");
    Ok(())
}

fn build_openforge_skill() -> String {
    OPENFORGE_SKILL_TEMPLATE.to_string()
}

fn build_openforge_plugin_dev_skill() -> String {
    OPENFORGE_PLUGIN_DEV_SKILL_TEMPLATE.to_string()
}

fn openforge_cli_path(config_dir: &Path) -> PathBuf {
    config_dir.join("openforge").join("cli").join("cli.js")
}

fn openforge_bin_dir(home_dir: &Path) -> PathBuf {
    home_dir.join(".openforge").join("bin")
}

fn legacy_mcp_install_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("openforge").join("mcp-server")
}

fn remove_legacy_mcp_config_entry(config_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let contents = match fs::read_to_string(config_path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(Box::new(e)),
    };

    let mut config = match serde_json::from_str::<Value>(&contents) {
        Ok(Value::Object(map)) => Value::Object(map),
        Ok(_) => return Ok(()),
        Err(e) => {
            warn!(
                "[cli_installer] skipping legacy OpenForge MCP cleanup for invalid JSON: {}",
                e
            );
            return Ok(());
        }
    };

    let Some(mcp_servers) = config.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let should_remove = mcp_servers
        .get("openforge")
        .is_some_and(is_generated_legacy_mcp_entry);
    if !should_remove {
        return Ok(());
    }

    mcp_servers.remove("openforge");

    if mcp_servers.is_empty() {
        if let Some(config_object) = config.as_object_mut() {
            config_object.remove("mcpServers");
        }
    }

    fs::write(config_path, serde_json::to_string_pretty(&config)?)?;
    info!("[cli_installer] removed legacy OpenForge MCP config entry");
    Ok(())
}

fn is_generated_legacy_mcp_entry(entry: &Value) -> bool {
    let command = entry.get("command").and_then(Value::as_str);
    let legacy_arg = entry
        .get("args")
        .and_then(Value::as_array)
        .and_then(|args| args.first())
        .and_then(Value::as_str)
        .map(|arg| arg.contains("openforge") && arg.contains("mcp-server/index.js"))
        .unwrap_or(false);

    command == Some("node") && legacy_arg
}

fn is_generated_legacy_mcp_install_dir(legacy_dir: &Path) -> bool {
    if !legacy_dir.is_dir() {
        return false;
    }

    let package_json = legacy_dir.join("package.json");
    if fs::read_to_string(package_json)
        .map(|contents| contents.contains("openforge-mcp-server"))
        .unwrap_or(false)
    {
        return true;
    }

    legacy_dir.join("index.js").exists() && legacy_dir.join("tools.js").exists()
}

fn cleanup_legacy_mcp_install(config_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let legacy_dir = legacy_mcp_install_dir(config_dir);
    if is_generated_legacy_mcp_install_dir(&legacy_dir) {
        fs::remove_dir_all(&legacy_dir)?;
        info!("[cli_installer] removed legacy OpenForge MCP install directory");
    }
    Ok(())
}

fn cleanup_legacy_mcp(
    config_dir: &Path,
    home_dir: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    cleanup_legacy_mcp_install(config_dir)?;
    remove_legacy_mcp_config_entry(&config_dir.join("opencode").join("config.json"))?;
    if let Some(home_dir) = home_dir {
        remove_legacy_mcp_config_entry(&home_dir.join(".claude.json"))?;
    }
    Ok(())
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

fn provider_skill_install_targets_for_skill(
    home_dir: &Path,
    config_dir: &Path,
    skill_name: &'static str,
) -> Vec<ProviderSkillInstallTarget> {
    vec![
        ProviderSkillInstallTarget {
            provider: "generic",
            skill_name,
            path: home_dir
                .join(".agents")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "claude-code",
            skill_name,
            path: home_dir
                .join(".claude")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "pi",
            skill_name,
            path: home_dir
                .join(".pi")
                .join("agent")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "codex",
            skill_name,
            path: home_dir
                .join(".codex")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "opencode",
            skill_name,
            path: config_dir
                .join("opencode")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        },
    ]
}

pub fn provider_skill_install_targets(
    home_dir: &Path,
    config_dir: &Path,
) -> Vec<ProviderSkillInstallTarget> {
    let mut targets = provider_skill_install_targets_for_skill(home_dir, config_dir, "openforge");
    targets.extend(provider_skill_install_targets_for_skill(
        home_dir,
        config_dir,
        "openforge-plugin-dev",
    ));
    targets
}

fn skill_template_for_target(target: &ProviderSkillInstallTarget) -> String {
    match target.skill_name {
        "openforge" => build_openforge_skill(),
        "openforge-plugin-dev" => build_openforge_plugin_dev_skill(),
        unknown => unreachable!("unknown OpenForge provider skill template: {unknown}"),
    }
}

pub fn write_provider_skill_files(
    home_dir: &Path,
    config_dir: &Path,
) -> Result<Vec<ProviderSkillInstallTarget>, Box<dyn std::error::Error>> {
    let targets = provider_skill_install_targets(home_dir, config_dir);

    for target in &targets {
        if let Some(parent) = target.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target.path, skill_template_for_target(target))?;
        info!(
            "[cli_installer] OpenForge {} skill installed for {}",
            target.skill_name, target.provider
        );
    }

    Ok(targets)
}

pub fn install_openforge_cli() -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir().ok_or("could not determine config directory")?;
    let install_dir = cli_install_dir().ok_or("could not determine config directory")?;
    write_cli_files(&install_dir)?;

    let home_dir = dirs::home_dir();

    crate::opencode_plugin::ensure_opencode_plugin_installed()?;
    crate::codex_hooks::ensure_codex_hooks_installed()?;

    if let Some(home_dir) = home_dir.as_deref() {
        write_provider_skill_files(home_dir, &config_dir)?;
        install_cli_launcher(home_dir, &config_dir)?;
        ensure_zshrc_path(home_dir, &openforge_bin_dir(home_dir))?;
    } else {
        warn!(
            "[cli_installer] could not determine home directory; skipping provider skill install"
        );
    }

    if let Err(e) = cleanup_legacy_mcp(&config_dir, home_dir.as_deref()) {
        warn!("[cli_installer] failed to clean up legacy OpenForge MCP files: {e}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_write_cli_files_excludes_mcp_server_files() {
        let tmp_dir = tempfile::tempdir().unwrap();

        let result = write_cli_files(tmp_dir.path());
        assert!(result.is_ok(), "write CLI files failed: {:?}", result);

        let cli_js = tmp_dir.path().join("cli.js");
        let skill_md = tmp_dir.path().join("openforge-skill.md");
        let plugin_dev_skill_md = tmp_dir.path().join("openforge-plugin-dev-skill.md");
        assert!(cli_js.exists(), "cli.js should exist at {:?}", cli_js);
        assert!(
            skill_md.exists(),
            "openforge-skill.md should exist at {:?}",
            skill_md
        );
        assert!(
            plugin_dev_skill_md.exists(),
            "openforge-plugin-dev-skill.md should exist at {:?}",
            plugin_dev_skill_md
        );
        assert!(!tmp_dir.path().join("index.js").exists());
        assert!(!tmp_dir.path().join("tools.js").exists());
        assert!(!tmp_dir.path().join("package.json").exists());

        let cli_content = std::fs::read_to_string(&cli_js).unwrap();
        assert!(cli_content.contains("openforge task create"));
        assert!(cli_content.contains("--label"));
        assert!(cli_content.contains("openforge task labels add"));
        assert!(cli_content.contains("openforge project labels list"));
        assert!(cli_content.contains("openforge task labels list"));
        assert!(cli_content.contains("openforge task labels remove"));
        assert!(cli_content.contains("openforge plugin command list"));
        assert!(cli_content.contains("openforge plugin command describe"));
        assert!(!cli_content.contains("'mcp'"));

        let skill_content = std::fs::read_to_string(&skill_md).unwrap();
        assert!(skill_content.contains("openforge task create"));
        assert!(skill_content.contains("openforge task update"));
        assert!(skill_content.contains("openforge task start --task-id"));
        assert!(skill_content.contains("openforge task get"));
        assert!(skill_content.contains("openforge task list"));
        assert!(skill_content.contains("openforge project labels list"));
        assert!(skill_content.contains("openforge task labels add"));
        assert!(skill_content.contains("openforge task labels remove"));
        assert!(skill_content.contains("openforge task delete"));
        assert!(skill_content.contains("Task summaries are Markdown-formatted"));
        assert!(skill_content.contains("$HOME/.openforge/bin/openforge"));
        assert!(skill_content.contains("openforge task create --help"));
        assert!(skill_content.contains("openforge task update --help"));
        assert!(skill_content.contains("Before creating follow-up Tasks"));
        assert!(skill_content.contains("add useful --label values and dependency links"));
        assert!(skill_content.contains("When creating multiple related Tasks"));
        assert_eq!(skill_content.matches("openforge task get").count(), 1);
        assert_eq!(
            skill_content
                .matches("openforge project labels list")
                .count(),
            2
        );
        assert_eq!(
            skill_content.matches("openforge task labels list").count(),
            1
        );
        assert!(!skill_content.contains("reverse dependents"));
        assert!(!skill_content.contains("repoint each dependent"));
        assert!(!skill_content.contains("Correct task prompt"));
        assert!(!skill_content.contains("cli.js"));
        assert!(!skill_content.contains("exec node"));
        let obsolete_segment = ["mcp", "server"].join("-");
        assert!(!skill_content.contains(&obsolete_segment));

        let plugin_dev_skill_content = std::fs::read_to_string(&plugin_dev_skill_md).unwrap();
        assert!(plugin_dev_skill_content.contains("name: openforge-plugin-dev"));
        assert!(plugin_dev_skill_content.contains("docs/plugin-authoring.md"));
        assert!(plugin_dev_skill_content.contains("@openforge-app/plugin-sdk/frontend"));
        assert!(plugin_dev_skill_content.contains("@openforge-app/plugin-sdk/backend"));
        assert!(plugin_dev_skill_content.contains("Plugin creation workflow"));
        assert!(plugin_dev_skill_content
            .contains("Default to building a normal OpenForge plugin package"));
        assert!(plugin_dev_skill_content.contains("tasks.create"));
        assert!(plugin_dev_skill_content.contains("tasks.startImplementation"));
        assert!(!plugin_dev_skill_content.contains(&obsolete_segment));
    }

    fn expected_provider_skill_paths(home: &Path, config: &Path, skill_name: &str) -> Vec<PathBuf> {
        vec![
            home.join(".agents")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
            home.join(".claude")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
            home.join(".pi")
                .join("agent")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
            home.join(".codex")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
            config
                .join("opencode")
                .join("skills")
                .join(skill_name)
                .join("SKILL.md"),
        ]
    }

    #[test]
    fn test_provider_skill_install_targets_cover_supported_providers_and_generic_path() {
        let home = PathBuf::from("/home/tester");
        let config = PathBuf::from("/home/tester/.config");
        let targets = provider_skill_install_targets(&home, &config);
        let paths: Vec<_> = targets.iter().map(|target| target.path.as_path()).collect();

        assert_eq!(targets.len(), 10);
        for expected_path in expected_provider_skill_paths(&home, &config, "openforge") {
            assert!(
                paths.contains(&expected_path.as_path()),
                "missing target {expected_path:?}"
            );
        }
        for expected_path in expected_provider_skill_paths(&home, &config, "openforge-plugin-dev") {
            assert!(
                paths.contains(&expected_path.as_path()),
                "missing target {expected_path:?}"
            );
        }
    }

    #[test]
    fn test_write_provider_skill_files_installs_both_skills_for_each_provider() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let config = tmp_dir.path().join("config");

        let targets = write_provider_skill_files(&home, &config).expect("write provider skills");

        assert_eq!(targets.len(), 10);
        let target_paths: Vec<_> = targets.iter().map(|target| target.path.as_path()).collect();
        for expected_path in expected_provider_skill_paths(&home, &config, "openforge") {
            assert!(target_paths.contains(&expected_path.as_path()));
            let content = std::fs::read_to_string(&expected_path).unwrap();
            assert!(content.contains("name: openforge"));
            assert!(content.contains("OPENFORGE_HTTP_PORT"));
            assert!(content.contains("openforge task create"));
            assert!(content.contains("openforge task update"));
            assert!(content.contains("openforge task start --task-id"));
            assert!(content.contains("openforge task delete"));
            assert!(content.contains("openforge task get"));
            assert!(content.contains("openforge task list"));
            assert!(content.contains("openforge project labels list"));
            assert!(content.contains("openforge task labels list"));
            assert!(content.contains("openforge task labels add"));
            assert!(content.contains("openforge task labels remove"));
            assert!(content.contains("Use labels to record task categories"));
            assert!(content.contains("Before creating follow-up Tasks"));
            assert!(content.contains("add useful --label values and dependency links"));
            assert!(content.contains("When creating multiple related Tasks"));
            assert!(content.contains("Task summaries are Markdown-formatted"));
            assert!(content.contains("$HOME/.openforge/bin/openforge"));
            assert!(content.contains("openforge task create --help"));
            assert!(content.contains("openforge task update --help"));
            assert_eq!(content.matches("openforge task get").count(), 1);
            assert_eq!(content.matches("openforge project labels list").count(), 2);
            assert_eq!(content.matches("openforge task labels list").count(), 1);
            assert!(!content.contains("reverse dependents"));
            assert!(!content.contains("repoint each dependent"));
            assert!(!content.contains("openforge/cli/cli.js"));
            assert_eq!(content.matches("openforge project labels list").count(), 2);
            let obsolete_segment = ["mcp", "server"].join("-");
            assert!(!content.contains(&obsolete_segment));
        }
        for expected_path in expected_provider_skill_paths(&home, &config, "openforge-plugin-dev") {
            assert!(target_paths.contains(&expected_path.as_path()));
            let content = std::fs::read_to_string(&expected_path).unwrap();
            assert!(content.contains("name: openforge-plugin-dev"));
            assert!(content.contains("docs/plugin-authoring.md"));
            assert!(content.contains("package.json#openforge"));
            assert!(content.contains("Plugin creation workflow"));
            assert!(content.contains("Default to building a normal OpenForge plugin package"));
            assert!(content.contains("Use a frontend entry for Svelte views"));
            assert!(content.contains("Use a backend entry for Node dependencies"));
            assert!(content.contains("Frontend plugins can register views"));
            assert!(content.contains("Backend plugins can register backend methods"));
            assert!(content.contains("tasks.create"));
            assert!(content.contains("tasks.startImplementation"));
            assert!(!content.contains("openforge/cli/cli.js"));
            assert!(!content.contains("node \""));
            let obsolete_segment = ["mcp", "server"].join("-");
            assert!(!content.contains(&obsolete_segment));
        }
    }

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
    fn test_remove_legacy_mcp_config_entry_preserves_other_servers() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let config_path = tmp_dir.path().join("config.json");
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&json!({
                "theme": "dark",
                "mcpServers": {
                    "openforge": {
                        "type": "stdio",
                        "command": "node",
                        "args": ["/Users/test/Library/Application Support/openforge/mcp-server/index.js"],
                        "env": { "OPENFORGE_HTTP_PORT": "17422" }
                    },
                    "other": { "command": "other-cmd" }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        remove_legacy_mcp_config_entry(&config_path).expect("cleanup config");

        let cleaned: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(cleaned["theme"], "dark");
        assert!(cleaned["mcpServers"].get("openforge").is_none());
        assert_eq!(cleaned["mcpServers"]["other"]["command"], "other-cmd");
    }

    #[test]
    fn test_remove_legacy_mcp_config_entry_removes_empty_mcp_servers_key() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let config_path = tmp_dir.path().join("config.json");
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&json!({
                "theme": "dark",
                "mcpServers": {
                    "openforge": {
                        "type": "stdio",
                        "command": "node",
                        "args": ["/Users/test/Library/Application Support/openforge/mcp-server/index.js"],
                        "env": { "OPENFORGE_HTTP_PORT": "17422" }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        remove_legacy_mcp_config_entry(&config_path).expect("cleanup config");

        let cleaned: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(cleaned["theme"], "dark");
        assert!(cleaned.get("mcpServers").is_none());
    }

    #[test]
    fn test_remove_legacy_mcp_config_entry_preserves_custom_openforge_server() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let config_path = tmp_dir.path().join("config.json");
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&json!({
                "mcpServers": {
                    "openforge": {
                        "type": "stdio",
                        "command": "custom-openforge",
                        "args": ["serve"]
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        remove_legacy_mcp_config_entry(&config_path).expect("cleanup config");

        let cleaned: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(
            cleaned["mcpServers"]["openforge"]["command"],
            "custom-openforge"
        );
    }

    #[test]
    fn test_remove_legacy_mcp_config_entry_preserves_invalid_json() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let config_path = tmp_dir.path().join("config.json");
        std::fs::write(&config_path, "not json").unwrap();

        remove_legacy_mcp_config_entry(&config_path).expect("invalid json should be skipped");

        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), "not json");
    }

    #[test]
    fn test_cleanup_legacy_mcp_install_removes_generated_directory() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let old_dir = tmp_dir.path().join("openforge").join("mcp-server");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("index.js"), "old server").unwrap();
        std::fs::write(old_dir.join("tools.js"), "old tools").unwrap();

        cleanup_legacy_mcp_install(tmp_dir.path()).expect("cleanup old server dir");

        assert!(!old_dir.exists());
    }

    #[test]
    fn test_cleanup_legacy_mcp_install_preserves_unknown_directory() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let old_dir = tmp_dir.path().join("openforge").join("mcp-server");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("user-file.txt"), "keep me").unwrap();

        cleanup_legacy_mcp_install(tmp_dir.path()).expect("cleanup old server dir");

        assert!(old_dir.exists());
        assert!(old_dir.join("user-file.txt").exists());
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
