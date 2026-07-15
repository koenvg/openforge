//! Edit/delete support for the user's *personal* Claude skills (those under
//! `~/.claude/skills` or `~/.agents/skills`). The renderer never sends a raw filesystem
//! path: it supplies only the Claude source directory (`.claude`/`.agents`) and the
//! skill's folder name, and this module reconstructs the on-disk path under the user's
//! home. Reconstructing server-side keeps the write/delete surface tightly scoped and
//! prevents any path-traversal escape from a crafted IPC payload.

use std::path::{Path, PathBuf};

/// Claude source directories a personal skill may live under. Mirrors the Claude-scoped
/// set the injectable catalog surfaces to the picker.
const EDITABLE_SOURCE_DIRS: [&str; 2] = [".claude", ".agents"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalSkillPaths {
    /// The skills root the item must stay inside, e.g. `~/.claude/skills`.
    pub skills_root: PathBuf,
    /// The skill's own directory, e.g. `~/.claude/skills/pr-writer`.
    pub dir: PathBuf,
    /// The `SKILL.md` inside that directory.
    pub skill_file: PathBuf,
}

/// Resolve — and validate — where a personal skill lives on disk. Rejects any source dir
/// outside the Claude-scoped allowlist and any folder name that isn't a single safe path
/// component. Together with the canonicalized containment check in `ensure_editable_dir`,
/// this keeps writes/deletes inside the resolved `~/<source_dir>/skills` tree. (Note: if the
/// user has themselves symlinked `~/<source_dir>` elsewhere, operations follow that link —
/// that is the user's own configuration, not a renderer-supplied path.)
pub fn resolve_personal_skill_paths(
    home: &Path,
    source_dir: &str,
    source_path: &str,
) -> Result<PersonalSkillPaths, String> {
    if !EDITABLE_SOURCE_DIRS.contains(&source_dir) {
        return Err(format!("Unsupported skill source directory: {source_dir}"));
    }
    if !is_safe_component(source_path) {
        return Err(format!("Invalid skill identifier: {source_path}"));
    }
    let skills_root = home.join(source_dir).join("skills");
    let dir = skills_root.join(source_path);
    // Belt and suspenders: the resolved directory's parent must be exactly the skills root.
    if dir.parent() != Some(skills_root.as_path()) {
        return Err("Resolved skill path escaped the skills directory".to_string());
    }
    let skill_file = dir.join("SKILL.md");
    Ok(PersonalSkillPaths { skills_root, dir, skill_file })
}

/// A single, safe path component: non-empty, no separators, not a relative navigator.
fn is_safe_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains(std::path::MAIN_SEPARATOR)
}

/// Overwrite an existing personal skill's `SKILL.md`. This is an *edit* — the skill
/// directory must already exist and be a real directory — so it can never create a new
/// file at an arbitrary location.
pub fn write_personal_skill(
    home: &Path,
    source_dir: &str,
    source_path: &str,
    content: &str,
) -> Result<(), String> {
    let paths = resolve_personal_skill_paths(home, source_dir, source_path)?;
    ensure_editable_dir(&paths.dir, &paths.skills_root)?;
    std::fs::write(&paths.skill_file, content)
        .map_err(|e| format!("Failed to write skill file: {e}"))
}

/// Delete a personal skill by removing its directory.
pub fn delete_personal_skill(
    home: &Path,
    source_dir: &str,
    source_path: &str,
) -> Result<(), String> {
    let paths = resolve_personal_skill_paths(home, source_dir, source_path)?;
    ensure_editable_dir(&paths.dir, &paths.skills_root)?;
    std::fs::remove_dir_all(&paths.dir)
        .map_err(|e| format!("Failed to delete skill directory: {e}"))
}

/// The skill directory must already exist and be a real directory (not a symlink). As a
/// further guard against a symlinked intermediate path component, the canonicalized
/// directory must still resolve inside the canonicalized skills root — so neither editing
/// nor deleting can be redirected outside the skills tree.
fn ensure_editable_dir(dir: &Path, skills_root: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(dir)
        .map_err(|_| "Skill directory does not exist".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Refusing to operate on a symlinked skill directory".to_string());
    }
    if !meta.is_dir() {
        return Err("Skill path is not a directory".to_string());
    }
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skill path: {e}"))?;
    let canonical_root = skills_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skills root: {e}"))?;
    if !canonical_dir.starts_with(&canonical_root) {
        return Err("Skill path resolved outside the skills directory".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn seed_skill(home: &Path, source_dir: &str, name: &str, body: &str) {
        let dir = home.join(source_dir).join("skills").join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn claude_asset_resolves_personal_skill_under_home() {
        let home = TempDir::new().unwrap();
        let paths = resolve_personal_skill_paths(home.path(), ".claude", "pr-writer").unwrap();
        assert_eq!(
            paths.dir,
            home.path().join(".claude").join("skills").join("pr-writer")
        );
        assert_eq!(paths.skill_file, paths.dir.join("SKILL.md"));
    }

    #[test]
    fn claude_asset_rejects_unsupported_source_dir() {
        let home = TempDir::new().unwrap();
        assert!(resolve_personal_skill_paths(home.path(), ".opencode", "x").is_err());
        assert!(resolve_personal_skill_paths(home.path(), ".pi", "x").is_err());
        assert!(resolve_personal_skill_paths(home.path(), "..", "x").is_err());
    }

    #[test]
    fn claude_asset_rejects_path_traversal_in_identifier() {
        let home = TempDir::new().unwrap();
        for bad in ["..", ".", "", "a/b", "../evil", "a\\b", "foo/../bar"] {
            assert!(
                resolve_personal_skill_paths(home.path(), ".claude", bad).is_err(),
                "expected rejection for {bad:?}"
            );
        }
    }

    #[test]
    fn claude_asset_write_overwrites_existing_skill() {
        let home = TempDir::new().unwrap();
        seed_skill(home.path(), ".claude", "pr-writer", "old");
        write_personal_skill(home.path(), ".claude", "pr-writer", "new body").unwrap();
        let got =
            fs::read_to_string(home.path().join(".claude/skills/pr-writer/SKILL.md")).unwrap();
        assert_eq!(got, "new body");
    }

    #[test]
    fn claude_asset_write_refuses_when_skill_dir_missing() {
        let home = TempDir::new().unwrap();
        assert!(write_personal_skill(home.path(), ".claude", "ghost", "x").is_err());
    }

    #[test]
    fn claude_asset_delete_removes_only_the_skill_directory() {
        let home = TempDir::new().unwrap();
        seed_skill(home.path(), ".claude", "pr-writer", "body");
        seed_skill(home.path(), ".claude", "keeper", "body");
        delete_personal_skill(home.path(), ".claude", "pr-writer").unwrap();
        assert!(!home.path().join(".claude/skills/pr-writer").exists());
        // Sibling skill and the skills tree itself survive.
        assert!(home.path().join(".claude/skills/keeper").exists());
    }

    #[test]
    #[cfg(unix)]
    fn claude_asset_delete_refuses_symlinked_skill_dir() {
        let home = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("victim.txt"), "keep me").unwrap();
        let skills = home.path().join(".claude/skills");
        fs::create_dir_all(&skills).unwrap();
        std::os::unix::fs::symlink(outside.path(), skills.join("linked")).unwrap();

        assert!(delete_personal_skill(home.path(), ".claude", "linked").is_err());
        // The real directory the symlink pointed at must be untouched.
        assert!(outside.path().join("victim.txt").exists());
    }
}
