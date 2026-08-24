use log::{info, warn};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

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

pub(super) fn cleanup_legacy_mcp(
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
}
