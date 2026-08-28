//! Exposes the user's personal Claude Code skills (`~/.claude/skills`) to the
//! read-only headless review agent.
//!
//! The obvious route — `--setting-sources user` — also loads the user's global
//! `permissions.allow`, which in practice contains `Bash(*)`, `Write`, and
//! `Edit`. That silently defeats the read-only whitelist in `agent_generate.rs`
//! (verified: with user settings loaded the agent wrote a file through Bash even
//! though `--disallowedTools Write Edit` was set).
//!
//! `--plugin-dir` loads a plugin directory for one session independent of
//! setting sources, and plugins can carry skills. So we synthesise a throwaway
//! plugin whose `skills/` directory points at each of the user's own skills.
//! Skills load, settings do not, and the whitelist holds.
//!
//! Skills surface to the agent namespaced as `local-skills:<name>`; the model
//! resolves a bare `/<name>` reference in prompt text to that.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Plugin name, and therefore the skill namespace the agent sees. Kept short so
/// `local-skills:strict-code-review` stays readable in a prompt.
const PLUGIN_NAME: &str = "local-skills";

const PLUGIN_MANIFEST: &str = r#"{
  "name": "local-skills",
  "description": "The user's personal Claude Code skills, exposed to OpenForge's read-only review agent.",
  "version": "0.0.1"
}
"#;

/// Path to the synthesised plugin, or `None` when the user has no personal
/// skills (or the wrapper could not be written).
///
/// Built once per app launch. The entries are links to the real skill
/// directories, so *edits* to a skill's contents are picked up immediately;
/// only a *newly added* skill needs an OpenForge restart. Building once also
/// keeps concurrent generations from rebuilding the tree under each other.
pub(super) fn local_skills_plugin_dir() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let source = dirs::home_dir()?.join(".claude").join("skills");
            let root = std::env::temp_dir()
                .join(format!("openforge-{PLUGIN_NAME}-{}", std::process::id()));
            build_plugin(&source, &root)
        })
        .clone()
}

/// Write the wrapper plugin for every skill under `source`. Returns `None` when
/// there is nothing to expose, so callers can skip the CLI flag entirely.
fn build_plugin(source: &Path, root: &Path) -> Option<PathBuf> {
    let skills = collect_skills(source);
    if skills.is_empty() {
        return None;
    }

    // Rebuild from scratch: a stale tree from a previous run with the same pid
    // would otherwise expose skills the user has since deleted.
    let _ = fs::remove_dir_all(root);
    fs::create_dir_all(root.join(".claude-plugin")).ok()?;
    let skills_dir = root.join("skills");
    fs::create_dir_all(&skills_dir).ok()?;
    fs::write(
        root.join(".claude-plugin").join("plugin.json"),
        PLUGIN_MANIFEST,
    )
    .ok()?;

    let mut linked = 0usize;
    for (name, target) in skills {
        if link_skill(&target, &skills_dir.join(&name)).is_ok() {
            linked += 1;
        }
    }
    if linked == 0 {
        let _ = fs::remove_dir_all(root);
        return None;
    }
    Some(root.to_path_buf())
}

/// Every immediate subdirectory of `source` holding a `SKILL.md`, as
/// (skill name, canonical path). Entries in `~/.claude/skills` are often
/// symlinks into another checkout, so paths are canonicalised before they are
/// linked — a link to a link resolves fine, but canonicalising keeps the
/// wrapper readable and survives the intermediate link being replaced.
fn collect_skills(source: &Path) -> Vec<(String, PathBuf)> {
    let mut skills = Vec::new();
    let Ok(entries) = fs::read_dir(source) else {
        return skills;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        // `metadata` follows symlinks, which is what we want here.
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let path = entry.path();
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or(path);
        skills.push((name, canonical));
    }
    skills.sort_by(|a, b| a.0.cmp(&b.0));
    skills
}

/// Symlink where the platform supports it. Windows symlinks need elevated
/// privileges, so fall back to copying the tree.
fn link_skill(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(not(unix))]
    {
        copy_tree(target, link)
    }
}

#[cfg(not(unix))]
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.metadata()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, name: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\n---\nbody"),
        )
        .unwrap();
    }

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "openforge-local-skills-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn builds_a_plugin_exposing_every_user_skill() {
        let base = temp_root("build");
        let source = base.join("skills");
        fs::create_dir_all(&source).unwrap();
        write_skill(&source, "strict-code-review");
        write_skill(&source, "house-style");

        let root = base.join("wrapper");
        let built = build_plugin(&source, &root).expect("plugin built");

        assert_eq!(built, root);
        let manifest = fs::read_to_string(root.join(".claude-plugin").join("plugin.json")).unwrap();
        assert!(manifest.contains("\"name\": \"local-skills\""));
        // Resolving through the link proves the agent can actually read the body.
        for name in ["strict-code-review", "house-style"] {
            let skill = root.join("skills").join(name).join("SKILL.md");
            assert!(fs::read_to_string(&skill).unwrap().contains(name));
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn returns_none_when_the_user_has_no_skills() {
        let base = temp_root("empty");
        let source = base.join("skills");
        fs::create_dir_all(&source).unwrap();

        assert_eq!(build_plugin(&source, &base.join("wrapper")), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn returns_none_when_the_skills_directory_is_missing() {
        let base = temp_root("missing");
        assert_eq!(
            build_plugin(&base.join("nope"), &base.join("wrapper")),
            None
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn skips_directories_without_a_skill_file() {
        let base = temp_root("partial");
        let source = base.join("skills");
        fs::create_dir_all(source.join("not-a-skill")).unwrap();
        write_skill(&source, "real-skill");

        let root = base.join("wrapper");
        build_plugin(&source, &root).expect("plugin built");

        assert!(root.join("skills").join("real-skill").exists());
        assert!(!root.join("skills").join("not-a-skill").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rebuilds_over_a_stale_tree() {
        let base = temp_root("stale");
        let source = base.join("skills");
        fs::create_dir_all(&source).unwrap();
        write_skill(&source, "current");

        let root = base.join("wrapper");
        fs::create_dir_all(root.join("skills").join("deleted-skill")).unwrap();
        build_plugin(&source, &root).expect("plugin built");

        assert!(root.join("skills").join("current").exists());
        assert!(!root.join("skills").join("deleted-skill").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
