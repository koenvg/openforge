use super::payload::{build_openforge_plugin_dev_skill, build_openforge_skill};
use log::info;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderSkillInstallTarget {
    pub provider: &'static str,
    pub skill_name: &'static str,
    pub path: PathBuf,
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
    let targets = super::provider_skill_install_targets(home_dir, config_dir);

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

#[cfg(test)]
mod tests {
    use super::*;

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
            assert!(content.contains("openforge task active"));
            assert!(content.contains("openforge task completed"));
            assert!(content.contains("openforge task detail"));
            assert!(content.contains("openforge project labels list"));
            assert!(content.contains("openforge task labels list"));
            assert!(content.contains("openforge task labels add"));
            assert!(content.contains("openforge task labels remove"));
            assert!(content.contains("Use labels to record task categories"));
            assert!(content.contains("Before creating follow-up Tasks"));
            assert!(content.contains("add useful --label values and dependency links"));
            assert!(content.contains("When creating multiple related Tasks"));
            assert!(content.contains("Prompt repair workflow"));
            assert!(content.contains("$HOME/.openforge/bin/openforge"));
            assert!(content.contains("openforge task create --help"));
            assert!(content.contains("openforge task update --help"));
            assert_eq!(content.matches("openforge task detail").count(), 2);
            assert_eq!(content.matches("openforge project labels list").count(), 1);
            assert_eq!(content.matches("openforge task labels list").count(), 1);
            assert!(!content.contains("reverse dependents"));
            assert!(!content.contains("repoint each dependent"));
            assert!(!content.contains("openforge/cli/cli.js"));
            assert_eq!(content.matches("openforge project labels list").count(), 1);
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
}
