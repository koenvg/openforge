use log::info;
use std::fs;
use std::path::{Path, PathBuf};

include!(concat!(env!("OUT_DIR"), "/openforge_cli_runtime_assets.rs"));
const OPENFORGE_SKILL_TEMPLATE: &str = include_str!("../openforge-cli/openforge-skill.md");
const OPENFORGE_PLUGIN_DEV_SKILL_TEMPLATE: &str =
    include_str!("../openforge-cli/openforge-plugin-dev-skill.md");

// Marks the payload as ESM explicitly. Node releases without module detection
// (before 22.7) otherwise load its `import` statements as CommonJS and crash.
const PAYLOAD_PACKAGE_JSON: (&str, &str) = ("package.json", "{ \"type\": \"module\" }\n");
/// Oldest Node the payload runs on: it needs the global `fetch`.
pub(super) const MIN_NODE_MAJOR: u32 = 18;

fn payload_files() -> impl Iterator<Item = (&'static str, &'static str)> {
    OPENFORGE_CLI_RUNTIME_FILES
        .iter()
        .copied()
        .chain(std::iter::once(PAYLOAD_PACKAGE_JSON))
}

/// The stable entry point. It stays CommonJS-compatible so it can check the Node
/// version and report a load failure on any Node before importing the payload.
fn build_entry(version: &str) -> String {
    format!(
        r#"#!/usr/bin/env node
const major = Number(process.versions.node.split('.')[0]);
if (major < {MIN_NODE_MAJOR}) {{
  console.error('openforge needs Node.js {MIN_NODE_MAJOR} or newer, but ' + process.execPath + ' is ' + process.version + '.\nPut a newer node first on PATH, or set OPENFORGE_NODE to the path of one.');
  process.exitCode = 1;
}} else {{
  import('./payloads/{version}/cli.js').catch(error => {{
    console.error('openforge could not load its CLI files with Node.js ' + process.version + ' (' + process.execPath + '): ' + (error && error.message ? error.message : String(error)) + '\nReopen OpenForge to reinstall the CLI, or set OPENFORGE_NODE to a newer node.');
    process.exitCode = 1;
  }});
}}
"#
    )
}

pub(super) fn cli_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("cli"))
}

pub(super) fn write_cli_files(install_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use sha2::{Digest, Sha256};

    let payloads = install_dir.join("payloads");
    fs::create_dir_all(&payloads)?;
    let mut digest = Sha256::new();
    for (filename, contents) in payload_files() {
        digest.update((filename.len() as u64).to_le_bytes());
        digest.update(filename.as_bytes());
        digest.update((contents.len() as u64).to_le_bytes());
        digest.update(contents.as_bytes());
    }
    let version = format!("{:x}", digest.finalize());
    let destination = payloads.join(&version);
    if !destination.is_dir() {
        let staging = tempfile::Builder::new()
            .prefix(".staging-")
            .tempdir_in(&payloads)?;
        for (filename, contents) in payload_files() {
            fs::write(staging.path().join(filename), contents)?;
        }
        // Another installer may publish this same content while we stage it.
        if let Err(error) = fs::rename(staging.path(), &destination) {
            if !destination.is_dir() {
                return Err(error.into());
            }
        }
    }

    atomic_write(
        &install_dir.join("openforge-skill.md"),
        build_openforge_skill().as_bytes(),
        false,
    )?;
    atomic_write(
        &install_dir.join("openforge-plugin-dev-skill.md"),
        build_openforge_plugin_dev_skill().as_bytes(),
        false,
    )?;
    // Each entry point names one immutable directory, including for lazy imports.
    // Keep old payloads and legacy root modules: running processes may still need them.
    atomic_write(
        &install_dir.join("cli.js"),
        build_entry(&version).as_bytes(),
        false,
    )?;
    info!("[cli_installer] OpenForge CLI payload published: {version}");
    Ok(())
}

pub(super) fn atomic_write(path: &Path, contents: &[u8], executable: bool) -> std::io::Result<()> {
    use std::io::Write;

    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file has no parent directory",
        )
    })?;
    let mut staging = tempfile::NamedTempFile::new_in(parent)?;
    staging.write_all(contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        staging
            .as_file()
            .set_permissions(fs::Permissions::from_mode(if executable {
                0o755
            } else {
                0o644
            }))?;
    }
    #[cfg(not(unix))]
    let _ = executable;
    staging.persist(path).map_err(|error| error.error)?;
    Ok(())
}

pub(super) fn build_openforge_skill() -> String {
    OPENFORGE_SKILL_TEMPLATE.to_string()
}

pub(super) fn build_openforge_plugin_dev_skill() -> String {
    OPENFORGE_PLUGIN_DEV_SKILL_TEMPLATE.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_cli_files_installs_runtime_modules_and_excludes_mcp_server_files() {
        let tmp_dir = tempfile::tempdir().unwrap();

        let result = write_cli_files(tmp_dir.path());
        assert!(result.is_ok(), "write CLI files failed: {:?}", result);

        let runtime_dir = fs::read_dir(tmp_dir.path().join("payloads"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let skill_md = tmp_dir.path().join("openforge-skill.md");
        let plugin_dev_skill_md = tmp_dir.path().join("openforge-plugin-dev-skill.md");
        for (filename, _) in OPENFORGE_CLI_RUNTIME_FILES.iter().copied() {
            assert!(
                runtime_dir.join(filename).exists(),
                "{filename} should be installed"
            );
        }
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
        assert!(std::fs::read_to_string(runtime_dir.join("package.json"))
            .unwrap()
            .contains("\"type\": \"module\""));

        let runtime_content = OPENFORGE_CLI_RUNTIME_FILES
            .iter()
            .map(|(filename, _)| std::fs::read_to_string(runtime_dir.join(filename)).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(runtime_content.contains("openforge task create"));
        assert!(runtime_content.contains("--label"));
        assert!(runtime_content.contains("openforge task labels add"));
        assert!(runtime_content.contains("openforge project labels list"));
        assert!(runtime_content.contains("openforge task labels list"));
        assert!(runtime_content.contains("openforge task labels remove"));
        assert!(runtime_content.contains("openforge plugin command list"));
        assert!(runtime_content.contains("openforge plugin command describe"));
        assert!(runtime_content.contains("openforge plugin command invoke"));
        assert!(!runtime_content.contains("'mcp'"));
        let skill_content = std::fs::read_to_string(&skill_md).unwrap();
        assert!(skill_content.contains("openforge task create"));
        assert!(skill_content.contains("openforge task update"));
        assert!(skill_content.contains("openforge task start --task-id"));
        assert!(skill_content.contains("openforge task active"));
        assert!(skill_content.contains("openforge task completed"));
        assert!(skill_content.contains("openforge task complete --task-id"));
        assert!(skill_content.contains("openforge task detail"));
        assert!(skill_content.contains("openforge project labels list"));
        assert!(skill_content.contains("openforge task labels add"));
        assert!(skill_content.contains("openforge task labels remove"));
        assert!(skill_content.contains("openforge task delete"));
        assert!(skill_content.contains("openforge plugin command list"));
        assert!(skill_content.contains("openforge plugin command describe --command-id"));
        assert!(skill_content.contains("openforge plugin command invoke --command-id"));
        assert!(skill_content.contains("OPENFORGE_TASK_ID"));
        assert!(skill_content.contains("host-owned invocation context"));
        assert!(skill_content.contains("Prompt repair workflow"));
        assert!(skill_content.contains("$HOME/.openforge/bin/openforge"));
        assert!(skill_content.contains("openforge task create --help"));
        assert!(skill_content.contains("openforge task update --help"));
        assert!(skill_content.contains("Before creating follow-up Tasks"));
        assert!(skill_content.contains("add useful --label values and dependency links"));
        assert!(skill_content.contains("When creating multiple related Tasks"));
        assert_eq!(skill_content.matches("openforge task detail").count(), 2);
        assert_eq!(
            skill_content
                .matches("openforge project labels list")
                .count(),
            1
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
}
