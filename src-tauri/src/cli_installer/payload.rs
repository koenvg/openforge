use log::info;
use std::fs;
use std::path::{Path, PathBuf};

include!(concat!(env!("OUT_DIR"), "/openforge_cli_runtime_assets.rs"));
const OPENFORGE_SKILL_TEMPLATE: &str = include_str!("../openforge-cli/openforge-skill.md");
const OPENFORGE_PLUGIN_DEV_SKILL_TEMPLATE: &str =
    include_str!("../openforge-cli/openforge-plugin-dev-skill.md");

pub(super) fn cli_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("cli"))
}

pub(super) fn write_cli_files(install_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(install_dir)?;
    for (filename, contents) in OPENFORGE_CLI_RUNTIME_FILES {
        fs::write(install_dir.join(filename), contents)?;
    }
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

        let skill_md = tmp_dir.path().join("openforge-skill.md");
        let plugin_dev_skill_md = tmp_dir.path().join("openforge-plugin-dev-skill.md");
        for (filename, _) in OPENFORGE_CLI_RUNTIME_FILES.iter().copied() {
            assert!(
                tmp_dir.path().join(filename).exists(),
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

        let runtime_content = OPENFORGE_CLI_RUNTIME_FILES
            .iter()
            .map(|(filename, _)| std::fs::read_to_string(tmp_dir.path().join(filename)).unwrap())
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
