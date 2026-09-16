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
//! Skills surface to the agent namespaced as `local-skills:<name>`. A bare
//! `/<name>` in prompt text does not reliably load one: the CLI only expands a
//! bare reference for a model-visible skill, and a `disable-model-invocation`
//! skill is hidden and refuses the Skill tool. So skills the guidance names are
//! inlined into the prompt directly instead — see `inline_referenced_skills`.

use std::collections::{BTreeMap, BTreeSet};
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

/// Inline the full text of every skill the prompt references, recursively.
///
/// The repo-aware review runs headless. In that mode a skill named in the prompt
/// as `/<name>` cannot be relied on to load: the CLI only expands a bare `/<name>`
/// for a model-visible skill, and a skill marked `disable-model-invocation: true`
/// is hidden from the model and refuses the Skill tool outright. So OpenForge
/// resolves the reference itself, reads the skill's `SKILL.md`, and pastes its
/// body into the prompt as plain instructions — no Skill tool, no expansion, so
/// the flag never triggers. References inside an inlined body are resolved too, so
/// a "loader" skill that lists others pulls the whole tree in.
///
/// Skills are discovered under `~/.claude/skills` (the user's personal skills) and
/// the checked-out repo's `<project_root>/.claude/skills` (its project skills).
pub(super) fn inline_referenced_skills(prompt: &str, project_root: Option<&Path>) -> String {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".claude").join("skills"));
    }
    if let Some(root) = project_root {
        roots.push(root.join(".claude").join("skills"));
    }
    inline_skills_from_roots(prompt, &roots)
}

fn inline_skills_from_roots(prompt: &str, roots: &[PathBuf]) -> String {
    let map = skill_map(roots);
    if map.is_empty() {
        return prompt.to_string();
    }
    let names: BTreeSet<&str> = map.keys().map(String::as_str).collect();

    // Walk the reference graph breadth-first from the prompt, following references
    // found inside each inlined body. `visited` inlines each skill once and breaks
    // cycles (a loader that references a skill which references it back).
    let mut visited: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<String> = referenced_skills(prompt, &names);
    let mut collected: Vec<(String, String)> = Vec::new();
    while let Some(name) = queue.pop() {
        if !visited.insert(name.clone()) {
            continue;
        }
        let Some(dir) = map.get(&name) else { continue };
        let Some(body) = read_skill_body(dir) else {
            continue;
        };
        for reference in referenced_skills(&body, &names) {
            if !visited.contains(&reference) {
                queue.push(reference);
            }
        }
        collected.push((name, body));
    }
    if collected.is_empty() {
        return prompt.to_string();
    }
    collected.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = String::from(prompt);
    out.push_str(
        "\n\n---\n\n# Referenced skills\n\nThe guidance above names these skills with `/name`. \
This run cannot load skills as tools, so their full instructions are inlined below. Follow them as \
if they were loaded. Do not try to invoke them with the Skill tool; the instructions are already here.\n",
    );
    for (name, body) in collected {
        out.push_str(&format!("\n## Skill: /{name}\n\n{body}\n"));
    }
    out
}

/// Map every skill name to its directory across the given roots, earlier roots
/// winning a name collision. A directory is a skill only if it holds a `SKILL.md`.
fn skill_map(roots: &[PathBuf]) -> BTreeMap<String, PathBuf> {
    let mut map = BTreeMap::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if path.join("SKILL.md").is_file() {
                map.entry(name).or_insert(path);
            }
        }
    }
    map
}

/// Names referenced as `/name` in `text`, restricted to `known` skill names. The
/// slash must not follow an alphanumeric (so a path like `src/known` is not a
/// reference), and the name must not be followed by another name character (so
/// `/review` does not match `/review-pr`).
fn referenced_skills(text: &str, known: &BTreeSet<&str>) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    for name in known {
        let needle = format!("/{name}");
        let mut start = 0;
        while let Some(offset) = text[start..].find(&needle) {
            let at = start + offset;
            let before_ok = at == 0 || !bytes[at - 1].is_ascii_alphanumeric();
            let after = at + needle.len();
            let after_ok = after >= bytes.len()
                || !(bytes[after].is_ascii_alphanumeric() || bytes[after] == b'-');
            if before_ok && after_ok {
                found.push((*name).to_string());
                break;
            }
            start = at + needle.len();
        }
    }
    found
}

/// A skill's `SKILL.md` with any leading YAML frontmatter removed, so only the
/// instructions are inlined (not `name`/`description`/`disable-model-invocation`).
fn read_skill_body(skill_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(skill_dir.join("SKILL.md")).ok()?;
    Some(strip_frontmatter(&text).trim().to_string())
}

fn strip_frontmatter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---\n") else {
        return text;
    };
    match rest.find("\n---\n") {
        Some(idx) => &rest[idx + "\n---\n".len()..],
        None => text,
    }
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

    /// Writes a skill whose SKILL.md carries frontmatter (including the flag that
    /// blocks the Skill tool) followed by `body`.
    fn write_skill_body(root: &Path, name: &str, body: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndisable-model-invocation: true\n---\n{body}"),
        )
        .unwrap();
    }

    #[test]
    fn inlines_a_referenced_skill_body_without_its_frontmatter() {
        let base = temp_root("inline-one");
        let skills = base.join("skills");
        fs::create_dir_all(&skills).unwrap();
        write_skill_body(&skills, "house-style", "HOUSE_STYLE_RULES");

        let out = inline_skills_from_roots("Follow /house-style please.", &[skills]);

        assert!(
            out.contains("HOUSE_STYLE_RULES"),
            "skill body must be inlined"
        );
        assert!(
            out.contains("Follow /house-style please."),
            "original prompt is preserved"
        );
        assert!(
            !out.contains("disable-model-invocation"),
            "frontmatter must be stripped"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn recursively_inlines_skills_a_loader_references() {
        let base = temp_root("inline-rec");
        let skills = base.join("skills");
        fs::create_dir_all(&skills).unwrap();
        write_skill_body(&skills, "loader", "LOADER_BODY. Now load /child.");
        write_skill_body(&skills, "child", "CHILD_BODY");

        let out = inline_skills_from_roots("Follow /loader", &[skills]);

        assert!(out.contains("LOADER_BODY"));
        assert!(
            out.contains("CHILD_BODY"),
            "a skill referenced inside a loader is inlined too"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn terminates_and_inlines_once_on_reference_cycles() {
        let base = temp_root("inline-cycle");
        let skills = base.join("skills");
        fs::create_dir_all(&skills).unwrap();
        write_skill_body(&skills, "a", "A_BODY see /b");
        write_skill_body(&skills, "b", "B_BODY see /a");

        let out = inline_skills_from_roots("Follow /a", &[skills]);

        assert!(out.contains("A_BODY"));
        assert!(out.contains("B_BODY"));
        assert_eq!(
            out.matches("A_BODY").count(),
            1,
            "a cyclic skill is inlined exactly once"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn resolves_references_across_multiple_roots() {
        let base = temp_root("inline-roots");
        let personal = base.join("personal");
        let project = base.join("project");
        fs::create_dir_all(&personal).unwrap();
        fs::create_dir_all(&project).unwrap();
        write_skill_body(&personal, "personal-review", "PERSONAL_BODY see /repo-rule");
        write_skill_body(&project, "repo-rule", "REPO_RULE_BODY");

        let out = inline_skills_from_roots("Follow /personal-review", &[personal, project]);

        assert!(out.contains("PERSONAL_BODY"));
        assert!(
            out.contains("REPO_RULE_BODY"),
            "a personal skill can pull in a project skill"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn ignores_unknown_names_and_path_like_slashes() {
        let base = temp_root("inline-unknown");
        let skills = base.join("skills");
        fs::create_dir_all(&skills).unwrap();
        write_skill_body(&skills, "known", "KNOWN_BODY");

        let out = inline_skills_from_roots("see /unknown and src/known here", &[skills]);

        assert!(
            !out.contains("KNOWN_BODY"),
            "'src/known' is a path, not a skill reference"
        );
        assert_eq!(
            out, "see /unknown and src/known here",
            "prompt is unchanged"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn leaves_the_prompt_unchanged_when_nothing_is_referenced() {
        let base = temp_root("inline-none");
        let skills = base.join("skills");
        fs::create_dir_all(&skills).unwrap();
        write_skill_body(&skills, "unused", "UNUSED_BODY");

        let out = inline_skills_from_roots("plain guidance, no skills", &[skills]);

        assert_eq!(out, "plain guidance, no skills");
        let _ = fs::remove_dir_all(&base);
    }
}
