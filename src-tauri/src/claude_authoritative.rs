//! Authoritative Claude Code command discovery.
//!
//! OpenForge's filesystem reconstruction of Claude's command catalog (see
//! `command_discovery`) drifts from what Claude Code actually resolves: it hardcodes
//! the built-in list and only sees plugins recorded in `installed_plugins.json` +
//! `settings.json`. Server-driven bundles (the `tengu_amber_lattice` GrowthBook flag —
//! e.g. `/code-review`, `/security-review`) are auto-installed by Claude and appear in
//! its real command list, but never in that reconstruction, so they are missing from
//! the injectable picker.
//!
//! The fix: treat Claude itself as the source of truth. `claude --output-format
//! stream-json` emits a `system/init` message whose `slash_commands` is the resolved,
//! current set of command names (and `plugins` gives the on-disk roots of the enabled
//! plugins). We overlay that authoritative name list additively onto the filesystem
//! scan — keeping every scanned entry's rich metadata (no regression), appending the
//! names the scan missed, and enriching each appended name best-effort from the plugin
//! roots and the marketplace clone.
//!
//! The query is warmed in the background at session start / app load and cached, so the
//! picker (which must open instantly) always reads a cache and never spawns a process;
//! a cold cache simply falls back to today's filesystem scan until the warm completes.

use crate::opencode_client::CommandInfo;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// How long the background warm waits for Claude's init message before giving up. The
/// init message is emitted at startup (before any model turn), so this only guards
/// against a hung/slow launch; on timeout the cache stays cold and the picker keeps
/// using the filesystem scan.
const WARM_TIMEOUT_SECS: u64 = 20;

/// Parsed from the `system/init` message of `claude --output-format stream-json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitCatalog {
    /// Resolved, current command names (Claude's canonical invocation strings).
    pub slash_commands: Vec<String>,
    /// On-disk roots of the enabled plugins (each may hold `commands/` and `skills/`).
    pub plugin_roots: Vec<PathBuf>,
}

/// Best-effort metadata for an authoritative command name resolved from disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCommand {
    pub description: Option<String>,
    pub content: Option<String>,
    /// "auto+manual" | "manual-only"
    pub trigger_mode: String,
    /// "command" | "skill" — maps to `CommandInfo.source`.
    pub kind: String,
}

/// Parse one stream-json line; return the catalog when it is the `system/init` message.
pub fn parse_init_authoritative(line: &str) -> Option<InitCatalog> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("system")
        || v.get("subtype").and_then(|s| s.as_str()) != Some("init")
    {
        return None;
    }
    let slash_commands = v
        .get("slash_commands")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let plugin_roots = v
        .get("plugins")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|p| p.get("path").and_then(|x| x.as_str()).map(PathBuf::from))
                .collect()
        })
        .unwrap_or_default();
    Some(InitCatalog {
        slash_commands,
        plugin_roots,
    })
}

/// Additively overlay authoritative command names onto the scanned catalog.
///
/// Every scanned command is kept (no regression). Authoritative names absent from the
/// scan are appended — enriched via `enrich` when it resolves a source file, else added
/// name-only as a Claude-provided builtin. The result is sorted by name.
pub fn merge_authoritative<F>(
    scanned: Vec<CommandInfo>,
    authoritative_names: &[String],
    enrich: F,
) -> Vec<CommandInfo>
where
    F: Fn(&str) -> Option<ResolvedCommand>,
{
    let mut seen: std::collections::HashSet<String> =
        scanned.iter().map(|c| c.name.clone()).collect();
    let mut out = scanned;
    for name in authoritative_names {
        if !seen.insert(name.clone()) {
            continue; // already covered by the scan or an earlier authoritative entry
        }
        out.push(make_authoritative_command(name, enrich(name)));
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Build a `CommandInfo` for an authoritative name the filesystem scan missed. When a
/// source file resolved, it is a Claude plugin command with real metadata; otherwise it
/// is a Claude built-in with no on-disk file, added name-only.
fn make_authoritative_command(name: &str, resolved: Option<ResolvedCommand>) -> CommandInfo {
    use serde_json::Value;
    let (origin, source, description, content, trigger_mode) = match resolved {
        Some(r) => (
            "plugin",
            r.kind,
            r.description,
            r.content.map(Value::from).unwrap_or(Value::Null),
            r.trigger_mode,
        ),
        None => (
            "builtin",
            "command".to_string(),
            None,
            Value::Null,
            "manual-only".to_string(),
        ),
    };
    let mut extra = serde_json::Map::new();
    extra.insert("origin".to_string(), Value::from(origin));
    extra.insert("triggerMode".to_string(), Value::from(trigger_mode));
    extra.insert("sourceDir".to_string(), Value::Null);
    extra.insert("sourcePath".to_string(), Value::Null);
    extra.insert("userInvocable".to_string(), Value::from(true));
    extra.insert("content".to_string(), content);
    CommandInfo {
        name: name.to_string(),
        description,
        source: Some(source),
        agent: None,
        extra,
    }
}

/// Resolve a command name's source file by searching `commands/{leaf}.md` then
/// `skills/{leaf}/SKILL.md` under each plugin root (leaf = name after the last `:`).
pub fn resolve_command_source(name: &str, roots: &[PathBuf]) -> Option<ResolvedCommand> {
    let leaf = name.rsplit(':').next().unwrap_or(name);
    for root in roots {
        let command_md = root.join("commands").join(format!("{leaf}.md"));
        if let Some(resolved) = read_resolved(&command_md, "command") {
            return Some(resolved);
        }
        let skill_md = root.join("skills").join(leaf).join("SKILL.md");
        if let Some(resolved) = read_resolved(&skill_md, "skill") {
            return Some(resolved);
        }
    }
    None
}

fn read_resolved(path: &Path, kind: &str) -> Option<ResolvedCommand> {
    let content = std::fs::read_to_string(path).ok()?;
    let (_name, description) = crate::command_discovery::parse_skill_frontmatter(&content);
    let disable = frontmatter_bool(&content, "disable-model-invocation");
    let trigger_mode = if disable == Some(true) {
        "manual-only"
    } else {
        "auto+manual"
    };
    Some(ResolvedCommand {
        description,
        content: Some(content),
        trigger_mode: trigger_mode.to_string(),
        kind: kind.to_string(),
    })
}

/// Read a boolean scalar from the leading `---` YAML frontmatter block, if present.
fn frontmatter_bool(content: &str, key: &str) -> Option<bool> {
    let trimmed = content.trim_start();
    let body = trimmed.strip_prefix("---")?;
    let end = body.find("\n---")?;
    for line in body[..end].lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            if let Some(val) = rest.trim_start().strip_prefix(':') {
                return match val.trim() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                };
            }
        }
    }
    None
}

/// Enumerate marketplace plugin dirs: `<home>/.claude/plugins/marketplaces/*/plugins/*`.
pub fn marketplace_plugin_dirs(home: &Path) -> Vec<PathBuf> {
    let marketplaces = home.join(".claude").join("plugins").join("marketplaces");
    let mut dirs = Vec::new();
    let Ok(entries) = std::fs::read_dir(&marketplaces) else {
        return dirs;
    };
    for market in entries.flatten() {
        let plugins = market.path().join("plugins");
        if let Ok(plugin_entries) = std::fs::read_dir(&plugins) {
            for plugin in plugin_entries.flatten() {
                if plugin.path().is_dir() {
                    dirs.push(plugin.path());
                }
            }
        }
    }
    dirs
}

// ── Background warm + process-global cache ──────────────────────────────────
//
// `provider_commands` builds a fresh provider per call, so the authoritative list
// cannot live on the provider — it lives here in a single process-global cache. The
// key is global rather than per-project on purpose: the overlay exists to surface
// global/user-level bundled commands (e.g. /code-review), while genuinely
// project-scoped commands already come through the project-keyed filesystem scan the
// overlay is layered on top of. A single key also lets the session-start pre-warm
// populate exactly what the picker later reads.
//
// The picker reads this synchronously via `apply` and never blocks: a cold cache
// returns the filesystem scan unchanged and schedules a one-shot background warm, so
// the fuller list swaps in on a subsequent open.

#[derive(Default)]
struct WarmState {
    catalog: Option<InitCatalog>,
    warming: bool,
}

fn cache() -> &'static Mutex<WarmState> {
    static CACHE: OnceLock<Mutex<WarmState>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(WarmState::default()))
}

/// Overlay the cached authoritative catalog (if warmed) onto a filesystem scan.
/// Returns the scan unchanged when the cache is cold, and schedules a background warm
/// so the next call reflects Claude's real command set.
pub fn apply(scanned: Vec<CommandInfo>, project_path: Option<&str>) -> Vec<CommandInfo> {
    let catalog = {
        let mut state = cache().lock().unwrap();
        match &state.catalog {
            Some(cat) => Some(cat.clone()),
            None => {
                if !state.warming {
                    state.warming = true;
                    spawn_warm(project_path.map(str::to_string));
                }
                None
            }
        }
    };
    let Some(cat) = catalog else {
        return scanned;
    };
    let mut roots = cat.plugin_roots.clone();
    if let Some(home) = dirs::home_dir() {
        roots.extend(marketplace_plugin_dirs(&home));
    }
    merge_authoritative(scanned, &cat.slash_commands, |name| {
        resolve_command_source(name, &roots)
    })
}

/// Pre-warm the authoritative catalog (e.g. at session start) so the first picker open
/// already reflects Claude's real command set. No-op if already warmed or a warm is in
/// flight.
pub fn warm(project_path: Option<&str>) {
    let mut state = cache().lock().unwrap();
    if state.catalog.is_none() && !state.warming {
        state.warming = true;
        spawn_warm(project_path.map(str::to_string));
    }
}

fn spawn_warm(cwd: Option<String>) {
    std::thread::spawn(move || {
        let result = query_init_catalog(cwd.as_deref());
        let mut state = cache().lock().unwrap();
        state.warming = false;
        if let Some(cat) = result {
            state.catalog = Some(cat);
        }
    });
}

/// Spawn `claude` in stream-json mode, read the `system/init` message, and kill the
/// process before the model turn runs — a fast, local, cost-free query of Claude's
/// resolved command set. Returns `None` on any failure (missing binary, no auth,
/// timeout), which keeps the caller on the filesystem-scan fallback.
fn query_init_catalog(project_path: Option<&str>) -> Option<InitCatalog> {
    let env = crate::user_environment::user_environment();
    let program = env
        .get("PATH")
        .and_then(|path| crate::user_environment::find_tool_on_path("claude", path))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "claude".to_string());

    let mut cmd = Command::new(&program);
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        // Trivial prompt: the process is killed after the init line, before the model
        // runs, so this is never actually answered.
        "x",
    ]);
    cmd.envs(&env);
    cmd.env("NO_COLOR", "1");
    for stray in [
        "OPENFORGE_TASK_ID",
        "OPENFORGE_PTY_INSTANCE_ID",
        "OPENFORGE_HTTP_PORT",
        "CLAUDE_TASK_ID",
    ] {
        cmd.env_remove(stray);
    }
    if let Some(path) = project_path {
        cmd.current_dir(path);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;

    // Read on a helper thread so a launch that never emits the init line can't block us
    // past the timeout; killing the child then unblocks the reader via EOF.
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(cat) = parse_init_authoritative(&line) {
                let _ = tx.send(cat);
                return;
            }
        }
    });

    let result = match rx.recv_timeout(Duration::from_secs(WARM_TIMEOUT_SECS)) {
        Ok(cat) => Some(cat),
        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => None,
    };
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scanned_cmd(name: &str) -> CommandInfo {
        let mut c = CommandInfo {
            name: name.to_string(),
            description: Some(format!("scanned {name}")),
            source: Some("command".to_string()),
            agent: None,
            extra: serde_json::Map::new(),
        };
        c.extra.insert("origin".to_string(), json!("personal"));
        c
    }

    #[test]
    fn parses_slash_commands_and_plugin_roots_from_init() {
        let line = r#"{"type":"system","subtype":"init","slash_commands":["code-review","review"],"plugins":[{"name":"superpowers","path":"/x/sp"},{"name":"noPath"}]}"#;
        let cat = parse_init_authoritative(line).expect("init should parse");
        assert_eq!(cat.slash_commands, vec!["code-review", "review"]);
        assert_eq!(cat.plugin_roots, vec![PathBuf::from("/x/sp")]);
    }

    #[test]
    fn returns_none_for_non_init_lines() {
        assert!(parse_init_authoritative(r#"{"type":"assistant"}"#).is_none());
        assert!(parse_init_authoritative(r#"{"type":"system","subtype":"other"}"#).is_none());
        assert!(parse_init_authoritative("not json at all").is_none());
    }

    #[test]
    fn keeps_all_scanned_and_appends_missing_authoritative() {
        let scanned = vec![scanned_cmd("review")];
        let names = vec!["review".to_string(), "code-review".to_string()];
        let out = merge_authoritative(scanned, &names, |n| {
            (n == "code-review").then(|| ResolvedCommand {
                description: Some("Code review a PR".to_string()),
                content: Some("full body".to_string()),
                trigger_mode: "auto+manual".to_string(),
                kind: "command".to_string(),
            })
        });
        let names_out: Vec<_> = out.iter().map(|c| c.name.clone()).collect();
        assert_eq!(names_out, vec!["code-review", "review"], "sorted, no dup");
        let cr = out.iter().find(|c| c.name == "code-review").unwrap();
        assert_eq!(cr.description.as_deref(), Some("Code review a PR"));
        assert_eq!(
            cr.extra.get("origin").and_then(|v| v.as_str()),
            Some("plugin")
        );
        assert_eq!(
            cr.extra.get("content").and_then(|v| v.as_str()),
            Some("full body")
        );
        assert_eq!(
            cr.extra.get("triggerMode").and_then(|v| v.as_str()),
            Some("auto+manual")
        );
        assert_eq!(
            cr.extra.get("userInvocable").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn preserves_scanned_metadata_when_name_also_authoritative() {
        let scanned = vec![scanned_cmd("review")];
        let out = merge_authoritative(scanned, &["review".to_string()], |_| None);
        assert_eq!(out.len(), 1, "no duplicate for a scanned name");
        assert_eq!(out[0].description.as_deref(), Some("scanned review"));
        assert_eq!(
            out[0].extra.get("origin").and_then(|v| v.as_str()),
            Some("personal"),
            "scanned enrichment is untouched"
        );
    }

    #[test]
    fn adds_unresolvable_authoritative_as_builtin_name_only() {
        let out = merge_authoritative(Vec::new(), &["mystery".to_string()], |_| None);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "mystery");
        assert_eq!(out[0].description, None);
        assert_eq!(
            out[0].extra.get("origin").and_then(|v| v.as_str()),
            Some("builtin")
        );
    }

    #[test]
    fn resolves_command_from_commands_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("code-review");
        std::fs::create_dir_all(root.join("commands")).unwrap();
        std::fs::write(
            root.join("commands").join("code-review.md"),
            "---\ndescription: Code review a pull request\ndisable-model-invocation: false\n---\n\nDo the review.\n",
        )
        .unwrap();
        let resolved = resolve_command_source("code-review", &[root]).expect("resolves");
        assert_eq!(
            resolved.description.as_deref(),
            Some("Code review a pull request")
        );
        assert_eq!(resolved.trigger_mode, "auto+manual");
        assert_eq!(resolved.kind, "command");
        assert!(resolved.content.unwrap().contains("Do the review."));
    }

    #[test]
    fn resolves_skill_and_reads_manual_only_trigger() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plug");
        std::fs::create_dir_all(root.join("skills").join("my-skill")).unwrap();
        std::fs::write(
            root.join("skills").join("my-skill").join("SKILL.md"),
            "---\ndescription: A manual skill\ndisable-model-invocation: true\n---\nbody\n",
        )
        .unwrap();
        let resolved = resolve_command_source("my-skill", &[root]).expect("resolves skill");
        assert_eq!(resolved.kind, "skill");
        assert_eq!(resolved.trigger_mode, "manual-only");
        assert_eq!(resolved.description.as_deref(), Some("A manual skill"));
    }

    #[test]
    fn resolve_uses_leaf_after_colon_for_namespaced_names() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("superpowers");
        std::fs::create_dir_all(root.join("skills").join("brainstorming")).unwrap();
        std::fs::write(
            root.join("skills").join("brainstorming").join("SKILL.md"),
            "---\ndescription: Brainstorm\n---\nx\n",
        )
        .unwrap();
        let resolved =
            resolve_command_source("superpowers:brainstorming", &[root]).expect("resolves leaf");
        assert_eq!(resolved.description.as_deref(), Some("Brainstorm"));
    }

    #[test]
    fn resolve_returns_none_when_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_command_source("nope", &[tmp.path().to_path_buf()]).is_none());
    }

    #[test]
    fn enumerates_marketplace_plugin_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp
            .path()
            .join(".claude")
            .join("plugins")
            .join("marketplaces")
            .join("claude-plugins-official")
            .join("plugins");
        std::fs::create_dir_all(base.join("code-review")).unwrap();
        std::fs::create_dir_all(base.join("security-guidance")).unwrap();
        let dirs = marketplace_plugin_dirs(tmp.path());
        assert!(dirs.contains(&base.join("code-review")));
        assert!(dirs.contains(&base.join("security-guidance")));
    }
}
