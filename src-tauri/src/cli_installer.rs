mod launcher_profile;
mod legacy_mcp;
mod payload;
mod provider_skills;

use launcher_profile::openforge_bin_dir;
use legacy_mcp::cleanup_legacy_mcp;
use log::warn;
use payload::{cli_install_dir, write_cli_files};

pub use launcher_profile::{ensure_zshrc_path, install_cli_launcher};
pub use provider_skills::write_provider_skill_files;

pub type ProviderSkillInstallTarget = provider_skills::ProviderSkillInstallTarget;

pub fn provider_skill_install_targets(
    home_dir: &std::path::Path,
    config_dir: &std::path::Path,
) -> Vec<ProviderSkillInstallTarget> {
    provider_skills::provider_skill_install_targets(home_dir, config_dir)
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
