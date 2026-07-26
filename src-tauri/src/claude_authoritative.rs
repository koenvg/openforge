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
//! names the scan missed, and enriching each appended name best-effort from those
//! active plugin roots.
//!
//! The query is warmed in the background at session start / app load and cached, so the
//! picker (which must open instantly) always reads a cache and never spawns a process;
//! a cold cache simply falls back to today's filesystem scan until the warm completes.
//!
//! Names that resolve to no file on disk — the commands Claude ships inside its own
//! binary — are described from Anthropic's published command reference instead; see
//! the "Published command reference" section below.

use crate::opencode_client::CommandInfo;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

/// The directories an authoritative command name may be enriched from.
///
/// Only the plugin roots Claude reports as *active* in its `system/init` message are
/// eligible. An earlier version also walked the marketplace catalog
/// (`<home>/.claude/plugins/marketplaces/*/plugins/*`), but that is the index of every
/// plugin **available** to install, not the ones installed — so a bundled command could
/// be enriched from a same-named command in a plugin the user does not have. `/code-review`
/// hit exactly that: Claude serves it from its own bundle, while the catalog holds an
/// unrelated `gh`-based PR reviewer, and the picker showed the latter's prompt as if it
/// were the real command. Wrong metadata is worse than none, so the catalog is not read.
pub fn resolver_roots(plugin_roots: &[PathBuf]) -> Vec<PathBuf> {
    plugin_roots
        .iter()
        .filter(|root| root.is_dir())
        .cloned()
        .collect()
}

// ── Published command reference ─────────────────────────────────────────────
//
// Claude resolves descriptions for its bundled commands in-process and does not expose
// them to external tools: `system/init` carries `slash_commands` and `skills` as bare
// name arrays, `claude --help` has no listing subcommand, and `/help` refuses to run
// non-interactively. The descriptions are compiled into the CLI binary, partly as
// runtime-interpolated template strings, so they cannot be recovered from it reliably.
//
// Anthropic does publish them, though, as machine-readable markdown at
// `code.claude.com/docs/en/commands.md` — the same reference the docs site renders.
// Fetching it once per app launch gives the picker real descriptions for the bundled
// commands and keeps up with commands Anthropic adds, without a per-open network hit.

/// Where the published command reference lives.
const COMMANDS_DOC_URL: &str = "https://code.claude.com/docs/en/commands.md";

/// How long the docs fetch may take before the picker gives up on it for this launch.
const DOC_FETCH_TIMEOUT_SECS: u64 = 10;

/// One row of the published command reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocCommand {
    /// Prose purpose, with doc-site markup (badges, links, version comments) removed.
    pub description: String,
    /// Whether the reference tags this as a bundled Skill or Workflow — i.e. a prompt
    /// handed to Claude, rather than a CLI action like `/context` or `/usage`.
    pub is_skill: bool,
}

/// Split one markdown table row on its unescaped `|` delimiters. Argument syntax in the
/// command cell contains `\|` alternatives (``/code-review [low\|medium\|high]``) which
/// must not be treated as column breaks.
fn split_table_row(line: &str) -> Vec<String> {
    let mut cells = vec![String::new()];
    let mut escaped = false;
    for ch in line.chars() {
        if escaped {
            // Keep the escaped delimiter itself, drop the backslash.
            if ch != '|' {
                cells.last_mut().unwrap().push('\\');
            }
            cells.last_mut().unwrap().push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '|' {
            cells.push(String::new());
        } else {
            cells.last_mut().unwrap().push(ch);
        }
    }
    cells.iter().map(|c| c.trim().to_string()).collect()
}

/// Rewrite `[text](url)` as `text`, leaving other bracketed text alone.
fn strip_markdown_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find("](") else {
            break;
        };
        let close = open + close;
        let Some(end) = rest[close..].find(')') else {
            break;
        };
        out.push_str(&rest[..open]);
        out.push_str(&rest[open + 1..close]);
        rest = &rest[close + end + 1..];
    }
    out.push_str(rest);
    out
}

/// Remove `{/* ... */}` doc-site directives (e.g. `{/* min-version: 2.1.152 */}`).
fn strip_doc_directives(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{/*") {
        let Some(close) = rest[open..].find("*/}") else {
            break;
        };
        out.push_str(&rest[..open]);
        rest = &rest[open + close + 3..];
    }
    out.push_str(rest);
    out
}

/// The command name a table row documents, read from the leading `` `/name `` cell.
fn doc_row_name(cell: &str) -> Option<String> {
    let after_tick = cell.strip_prefix('`')?;
    let name: String = after_tick
        .strip_prefix('/')?
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
        .collect();
    (!name.is_empty()).then_some(name)
}

/// Parse the published command reference into `name -> DocCommand`.
///
/// Tolerant by design: the source is a human-authored docs page, so anything that does
/// not look like a command row is skipped rather than treated as an error. The first
/// row for a name wins, so alias rows later in the page cannot overwrite it.
pub fn parse_commands_doc(md: &str) -> std::collections::HashMap<String, DocCommand> {
    let mut out = std::collections::HashMap::new();
    for line in md.lines() {
        let line = line.trim();
        if !line.starts_with('|') {
            continue;
        }
        let cells = split_table_row(line.trim_matches('|'));
        if cells.len() < 2 {
            continue;
        }
        // Skip the `| --- | :---: |` separator beneath the header.
        if cells[0].chars().all(|c| matches!(c, '-' | ':' | ' ')) {
            continue;
        }
        let Some(name) = doc_row_name(&cells[0]) else {
            continue;
        };
        let purpose = strip_doc_directives(&cells[1]);
        let purpose = purpose.trim();
        // Bundled skills/workflows lead with a bold badge: `**[Skill](...).** …`
        let (is_skill, body) = match purpose.strip_prefix("**") {
            Some(after) => match after.find("**") {
                Some(end) => {
                    let badge = &after[..end];
                    let tagged = badge.contains("[Skill]") || badge.contains("[Workflow]");
                    if tagged {
                        (true, after[end + 2..].trim_start_matches('.').trim())
                    } else {
                        (false, purpose)
                    }
                }
                None => (false, purpose),
            },
            None => (false, purpose),
        };
        let description = strip_markdown_links(body)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if description.is_empty() {
            continue;
        }
        out.entry(name).or_insert(DocCommand {
            description,
            is_skill,
        });
    }
    out
}

/// Fill in descriptions from the published reference for commands that have none.
///
/// Only ever fills a gap: anything resolved from disk already carries the authored
/// frontmatter description plus its body, which is richer than a one-line doc summary.
pub fn apply_doc_descriptions(
    commands: Vec<CommandInfo>,
    docs: &std::collections::HashMap<String, DocCommand>,
) -> Vec<CommandInfo> {
    commands
        .into_iter()
        .map(|mut cmd| {
            if cmd.description.is_none() {
                if let Some(doc) = docs.get(&cmd.name) {
                    cmd.description = Some(doc.description.clone());
                }
            }
            cmd
        })
        .collect()
}

fn docs_cache() -> &'static Mutex<Option<std::collections::HashMap<String, DocCommand>>> {
    static DOCS: OnceLock<Mutex<Option<std::collections::HashMap<String, DocCommand>>>> =
        OnceLock::new();
    DOCS.get_or_init(|| Mutex::new(None))
}

/// Fetch and cache the published command reference. Called once per app launch, off the
/// startup path; a failure (offline, timeout, docs moved) simply leaves the cache empty
/// and the picker behaves exactly as it did before — names with no description.
pub fn warm_docs() {
    std::thread::spawn(|| {
        let Ok(response) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(DOC_FETCH_TIMEOUT_SECS))
            .build()
            .and_then(|client| client.get(COMMANDS_DOC_URL).send())
        else {
            return;
        };
        if !response.status().is_success() {
            return;
        }
        let Ok(body) = response.text() else { return };
        let parsed = parse_commands_doc(&body);
        if !parsed.is_empty() {
            *docs_cache().lock().unwrap() = Some(parsed);
        }
    });
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
    let docs = docs_cache().lock().unwrap().clone().unwrap_or_default();
    let Some(cat) = catalog else {
        // Cold authoritative cache: still describe whatever the scan produced, so a
        // warm docs fetch is not wasted while waiting on the Claude subprocess.
        return apply_doc_descriptions(scanned, &docs);
    };
    let roots = resolver_roots(&cat.plugin_roots);
    let merged = merge_authoritative(scanned, &cat.slash_commands, |name| {
        resolve_command_source(name, &roots)
    });
    apply_doc_descriptions(merged, &docs)
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

    // Timeout and Disconnected both mean "no init line" — fall back to the scan.
    let result = rx.recv_timeout(Duration::from_secs(WARM_TIMEOUT_SECS)).ok();
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

    // ── Published command reference (code.claude.com/docs/en/commands.md) ────

    #[test]
    fn parses_name_and_purpose_from_a_doc_table_row() {
        let md = "\
| Command | Purpose |
| ------- | ------- |
| `/context` | Visualize current context usage as a colored grid |
";
        let docs = parse_commands_doc(md);
        let entry = docs.get("context").expect("row should parse");
        assert_eq!(
            entry.description,
            "Visualize current context usage as a colored grid"
        );
        assert!(!entry.is_skill);
    }

    #[test]
    fn marks_skill_and_workflow_rows_and_strips_their_badge() {
        let md = "\
| Command | Purpose |
| --- | --- |
| `/dataviz` | **[Skill](/docs/en/skills#bundled-skills).** Design guidance for charts |
| `/deep-research` | **[Workflow](/docs/en/workflows#bundled-workflows).** Fan out web searches |
";
        let docs = parse_commands_doc(md);
        let dataviz = docs.get("dataviz").expect("skill row");
        assert!(dataviz.is_skill);
        assert_eq!(dataviz.description, "Design guidance for charts");
        let research = docs.get("deep-research").expect("workflow row");
        assert!(research.is_skill);
        assert_eq!(research.description, "Fan out web searches");
    }

    #[test]
    fn strips_min_version_comments_and_resolves_markdown_links() {
        let md = "\
| Command | Purpose |
| --- | --- |
| `/reload-skills` | {/* min-version: 2.1.152 */}Re-scan [skill](/docs/en/skills) directories |
";
        let docs = parse_commands_doc(md);
        assert_eq!(
            docs.get("reload-skills").unwrap().description,
            "Re-scan skill directories"
        );
    }

    #[test]
    fn parses_rows_whose_command_cell_contains_escaped_pipes() {
        // `/code-review [low\|medium\|high]` — the escaped pipes must not split the row.
        let md = "\
| Command | Purpose |
| --- | --- |
| `/code-review [low\\|medium\\|high] [--fix]` | Review the current diff for correctness bugs |
";
        let docs = parse_commands_doc(md);
        assert_eq!(
            docs.get("code-review").unwrap().description,
            "Review the current diff for correctness bugs"
        );
    }

    #[test]
    fn ignores_headers_separators_and_non_command_rows() {
        let md = "\
| Command | Purpose |
| ------- | :-----: |
| not a command | some prose |
| `/usage` | Show session cost |
";
        let docs = parse_commands_doc(md);
        assert_eq!(docs.len(), 1);
        assert!(docs.contains_key("usage"));
    }

    #[test]
    fn parses_rows_copied_verbatim_from_the_published_reference() {
        // Real rows from code.claude.com/docs/en/commands.md, kept verbatim so the
        // parser is exercised against the page's actual conventions: escaped pipes in
        // argument syntax, a version directive before *and* after the skill badge,
        // and doc links inside the prose.
        let md = "\
| Command | Purpose |
| --- | --- |
| `/code-review [low\\|medium\\|high\\|xhigh\\|max\\|ultra] [--fix] [--comment] [target]` | **[Skill](/docs/en/skills#bundled-skills).** Review the current diff for correctness bugs and cleanup opportunities |
| `/context [all]` | Visualize current context usage as a colored grid. {/* min-version: 2.1.216 */}Shows optimization suggestions |
| `/simplify [target]` | {/* min-version: 2.1.154 */}**[Skill](/docs/en/skills#bundled-skills).** Review the changed code. Four review [agents](/docs/en/sub-agents) run in parallel |
| `/deep-research <question>` | **[Workflow](/docs/en/workflows#bundled-workflows).** Fan out web searches on a question |
";
        let docs = parse_commands_doc(md);
        assert_eq!(docs.len(), 4);

        let code_review = docs
            .get("code-review")
            .expect("escaped pipes must not split");
        assert!(code_review.is_skill);
        assert_eq!(
            code_review.description,
            "Review the current diff for correctness bugs and cleanup opportunities"
        );

        let context = docs.get("context").unwrap();
        assert!(!context.is_skill, "a CLI action is not a skill");
        assert_eq!(
            context.description,
            "Visualize current context usage as a colored grid. Shows optimization suggestions"
        );

        let simplify = docs.get("simplify").unwrap();
        assert!(simplify.is_skill, "badge follows the version directive");
        assert_eq!(
            simplify.description,
            "Review the changed code. Four review agents run in parallel"
        );

        assert!(docs.get("deep-research").unwrap().is_skill);
    }

    #[test]
    fn doc_description_fills_a_name_only_authoritative_entry() {
        let docs = parse_commands_doc(
            "| Command | Purpose |\n| --- | --- |\n| `/security-review` | Analyze pending changes for vulnerabilities |\n",
        );
        let merged = merge_authoritative(
            vec![],
            &["security-review".to_string()],
            |_| None, // nothing on disk — this is a bundled command
        );
        let enriched = apply_doc_descriptions(merged, &docs);
        let cmd = enriched
            .iter()
            .find(|c| c.name == "security-review")
            .unwrap();
        assert_eq!(
            cmd.description.as_deref(),
            Some("Analyze pending changes for vulnerabilities")
        );
    }

    #[test]
    fn doc_description_never_overrides_metadata_resolved_from_disk() {
        let docs = parse_commands_doc(
            "| Command | Purpose |\n| --- | --- |\n| `/brainstorm` | Docs wording |\n",
        );
        let scanned = vec![scanned_cmd("brainstorm")];
        let enriched = apply_doc_descriptions(scanned, &docs);
        assert_eq!(
            enriched[0].description.as_deref(),
            Some("scanned brainstorm"),
            "on-disk metadata is richer and must win"
        );
    }

    #[test]
    fn resolver_roots_exclude_uninstalled_marketplace_plugins() {
        // Regression: /code-review is served from Claude's own bundle, but an
        // identically-named command exists in the marketplace *catalog* for a plugin
        // that is not installed. Enriching from the catalog showed a stranger's prompt.
        let tmp = tempfile::tempdir().unwrap();
        let catalog = tmp
            .path()
            .join(".claude")
            .join("plugins")
            .join("marketplaces")
            .join("claude-plugins-official")
            .join("plugins")
            .join("code-review")
            .join("commands");
        std::fs::create_dir_all(&catalog).unwrap();
        std::fs::write(
            catalog.join("code-review.md"),
            "---\ndescription: Code review a pull request\n---\nbody",
        )
        .unwrap();

        let roots = resolver_roots(&[]);
        assert!(
            roots.is_empty(),
            "no plugin is installed, so nothing may be resolved from the catalog: {roots:?}"
        );
        assert!(resolve_command_source("code-review", &roots).is_none());
        // The catalog file is present on disk — proving the resolver simply never looks.
        assert!(catalog.join("code-review.md").exists());
    }

    #[test]
    fn resolver_roots_keep_the_plugin_roots_claude_reports_as_active() {
        let tmp = tempfile::tempdir().unwrap();
        let active = tmp.path().join("cache").join("superpowers").join("6.2.0");
        std::fs::create_dir_all(&active).unwrap();
        let roots = resolver_roots(std::slice::from_ref(&active));
        assert_eq!(roots, vec![active]);
    }
}
