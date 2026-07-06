//! Discovery and portability for local Claude Code session transcripts.
//!
//! Claude Code stores each session as `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`,
//! where the file stem is the session id and the directory name is the session's working
//! directory with every non-alphanumeric character replaced by `-`.
//!
//! This module lets OpenForge enumerate those local sessions (to power a "continue an
//! existing session" picker) and copy a chosen transcript into a task's worktree so that
//! `claude --resume <id>` resolves it deterministically regardless of Claude's own
//! worktree scoping.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// A lightweight summary of a local Claude session, suitable for a picker UI.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    /// Human-friendly label: Claude's generated `ai-title`, falling back to the first
    /// user prompt (truncated).
    pub title: Option<String>,
    /// The most recent prompt in the session, for additional context in the picker.
    pub last_prompt: Option<String>,
    /// The working directory the session was recorded in.
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    /// The latest ISO-8601 timestamp seen in the transcript (sorts correctly as a string).
    pub updated_at: Option<String>,
    /// Rough count of user/assistant turns.
    pub message_count: u32,
}

/// Whether `session_id` is safe to use as a filesystem path component. Claude
/// session ids are UUIDs; we accept the broader `[A-Za-z0-9-]` set and reject
/// anything else (empty, path separators, `..`, whitespace) so a caller-supplied
/// id can never traverse out of the Claude projects directory when staging a
/// transcript.
pub fn is_valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Encode an absolute working directory into the directory name Claude uses under
/// `~/.claude/projects/`. Every non-alphanumeric character becomes `-`.
pub fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Whether a `~/.claude/projects` subdirectory — named `encode_project_dir(cwd)` — could
/// hold sessions recorded within `encoded_root` (itself `encode_project_dir(project_root)`).
/// Lets [`list_sessions_in`] skip parsing unrelated projects' transcripts entirely.
///
/// This is deliberately a *superset* test: the exact cwd check in [`list_sessions_in`]
/// still runs afterwards, so this must never exclude a directory that cwd filter would
/// accept. Because `encode_project_dir` maps each character independently, a raw path
/// prefix always survives encoding, so a plain `starts_with` on the encoded names is a
/// sound superset of the component-wise cwd `starts_with`.
fn dir_could_contain_project(dir_name: &str, encoded_root: &str) -> bool {
    dir_name.starts_with(encoded_root)
}

fn truncate(s: &str, max: usize) -> String {
    let normalized = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max {
        return normalized;
    }
    let truncated: String = normalized.chars().take(max).collect();
    format!("{truncated}…")
}

/// Whether a user message is a genuine typed prompt rather than injected content
/// (system reminders, slash-command echoes). Claude Code injects a `<system-reminder>`
/// user turn when a session is named, which must not be mistaken for the user's prompt.
fn is_genuine_user_text(text: &str) -> bool {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    const INJECTED_PREFIXES: [&str; 6] = [
        "<system-reminder>",
        "<command-name>",
        "<command-message>",
        "<command-args>",
        "<local-command-stdout>",
        "<local-command-stderr>",
    ];
    !INJECTED_PREFIXES
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
}

fn extract_message_text(obj: &Value) -> Option<String> {
    let content = obj.get("message")?.get("content")?;
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let parts: Vec<&str> = arr
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect();
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }
    None
}

/// Parse a single `.jsonl` transcript into a summary. Returns `None` if the file cannot
/// be read; malformed individual lines are skipped tolerantly.
fn parse_session_file(path: &Path) -> Option<ClaudeSessionSummary> {
    let content = fs::read_to_string(path).ok()?;
    let session_id = path.file_stem()?.to_string_lossy().to_string();

    let mut custom_title: Option<String> = None;
    let mut ai_title: Option<String> = None;
    let mut first_user: Option<String> = None;
    let mut last_prompt: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut updated_at: Option<String> = None;
    let mut message_count: u32 = 0;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let record_type = obj.get("type").and_then(Value::as_str).unwrap_or("");

        if let Some(ts) = obj.get("timestamp").and_then(Value::as_str) {
            if updated_at.as_deref().map(|cur| ts > cur).unwrap_or(true) {
                updated_at = Some(ts.to_string());
            }
        }
        if cwd.is_none() {
            if let Some(c) = obj
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                cwd = Some(c.to_string());
            }
        }
        if git_branch.is_none() {
            if let Some(b) = obj
                .get("gitBranch")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                git_branch = Some(b.to_string());
            }
        }

        match record_type {
            // A session the user renamed (`/rename`) — the cleanest, most intentional label.
            "custom-title" => {
                if let Some(name) = obj
                    .get("customTitle")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    custom_title = Some(name.to_string());
                }
            }
            "agent-name" => {
                if custom_title.is_none() {
                    if let Some(name) = obj
                        .get("agentName")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                    {
                        custom_title = Some(name.to_string());
                    }
                }
            }
            "ai-title" => {
                if let Some(title) = obj
                    .get("aiTitle")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    ai_title = Some(title.to_string());
                }
            }
            "last-prompt" => {
                if let Some(lp) = obj
                    .get("lastPrompt")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    last_prompt = Some(lp.to_string());
                }
            }
            "user" | "assistant" => {
                message_count += 1;
                if record_type == "user" && first_user.is_none() {
                    if let Some(txt) = extract_message_text(&obj)
                        .filter(|s| is_genuine_user_text(s))
                        .map(|s| s.trim().to_string())
                    {
                        first_user = Some(txt);
                    }
                }
            }
            _ => {}
        }
    }

    // Prefer the user's explicit session name, then Claude's generated title, then a
    // trimmed first genuine prompt. Never surface injected system-reminder text.
    let title = custom_title
        .or(ai_title)
        .or_else(|| first_user.as_deref().map(|s| truncate(s, 100)));
    let last_prompt = last_prompt.or(first_user);

    Some(ClaudeSessionSummary {
        session_id,
        title,
        last_prompt,
        cwd,
        git_branch,
        updated_at,
        message_count,
    })
}

/// Locate the transcript file for `session_id` anywhere under `base`.
fn resolve_transcript_path_in(base: &Path, session_id: &str) -> Option<PathBuf> {
    let file_name = format!("{session_id}.jsonl");
    for entry in fs::read_dir(base).ok()?.flatten() {
        let dir = entry.path();
        if dir.is_dir() {
            let candidate = dir.join(&file_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Enumerate all local sessions under `base`, optionally filtered to those whose
/// recorded `cwd` is within `project_root`, sorted most-recently-updated first.
pub fn list_sessions_in(base: &Path, project_root: Option<&Path>) -> Vec<ClaudeSessionSummary> {
    let mut out: Vec<ClaudeSessionSummary> = Vec::new();
    let Ok(entries) = fs::read_dir(base) else {
        return out;
    };

    // When scoping to a project, only transcripts whose directory name is prefixed by the
    // project's encoded path can possibly pass the cwd filter below. Skipping the rest
    // avoids reading and parsing every unrelated transcript on disk (hundreds of MB),
    // which otherwise made enumeration slow enough to look hung in the New Task dialog.
    let encoded_root =
        project_root.map(|root| encode_project_dir(root.to_string_lossy().trim_end_matches('/')));

    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Some(encoded_root) = encoded_root.as_deref() {
            match dir.file_name().and_then(|n| n.to_str()) {
                Some(name) if dir_could_contain_project(name, encoded_root) => {}
                _ => continue,
            }
        }
        let Ok(files) = fs::read_dir(&dir) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some(summary) = parse_session_file(&path) {
                out.push(summary);
            }
        }
    }

    // Exact scoping guard. `Path::starts_with` is component-wise (so `/a/b` never matches
    // `/a/bc`), which keeps this a strict subset of the directory pre-filter above.
    if let Some(root) = project_root {
        out.retain(|s| match &s.cwd {
            Some(cwd) => Path::new(cwd).starts_with(root),
            None => false,
        });
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// Copy the transcript for `session_id` into `worktree`'s Claude project directory so a
/// subsequent `claude --resume <id>` run inside `worktree` finds it. Idempotent: if the
/// destination already exists it is left untouched.
pub fn copy_transcript_into_worktree_in(
    base: &Path,
    session_id: &str,
    worktree: &Path,
) -> Result<PathBuf, String> {
    // Reject ids that could escape the projects directory before touching the FS.
    if !is_valid_session_id(session_id) {
        return Err(format!("invalid session id: {session_id:?}"));
    }
    let src = resolve_transcript_path_in(base, session_id)
        .ok_or_else(|| format!("no local transcript found for session {session_id}"))?;

    let worktree_str = worktree.to_string_lossy();
    let target_dir = base.join(encode_project_dir(&worktree_str));
    let target = target_dir.join(format!("{session_id}.jsonl"));

    if target.is_file() {
        return Ok(target);
    }

    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("failed to create session dir {}: {e}", target_dir.display()))?;
    fs::copy(&src, &target).map_err(|e| format!("failed to copy transcript: {e}"))?;
    Ok(target)
}

fn projects_base() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}

/// List local Claude sessions from the real `~/.claude/projects` directory.
pub fn list_sessions(project_root: Option<&Path>) -> Vec<ClaudeSessionSummary> {
    match projects_base() {
        Some(base) => list_sessions_in(&base, project_root),
        None => Vec::new(),
    }
}

/// Copy a session transcript into a worktree using the real `~/.claude/projects` directory.
pub fn copy_transcript_into_worktree(session_id: &str, worktree: &Path) -> Result<PathBuf, String> {
    let base = projects_base().ok_or_else(|| "could not resolve home directory".to_string())?;
    copy_transcript_into_worktree_in(&base, session_id, worktree)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_session(base: &Path, dir: &str, session_id: &str, lines: &[&str]) -> PathBuf {
        let dir_path = base.join(dir);
        fs::create_dir_all(&dir_path).unwrap();
        let file = dir_path.join(format!("{session_id}.jsonl"));
        fs::write(&file, lines.join("\n")).unwrap();
        file
    }

    #[test]
    fn encode_project_dir_matches_claude_layout() {
        assert_eq!(
            encode_project_dir("/Users/aviv.hadar/repos/1-collibra/openforge"),
            "-Users-aviv-hadar-repos-1-collibra-openforge"
        );
        assert_eq!(
            encode_project_dir("/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-169"),
            "-Users-aviv-hadar--openforge-worktrees-openforge-AVIV-169"
        );
    }

    #[test]
    fn parse_prefers_ai_title_and_extracts_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_session(
            tmp.path(),
            "-repo",
            "abc123",
            &[
                r#"{"type":"attachment","timestamp":"2026-07-05T13:42:48.964Z","cwd":"/repo","gitBranch":"main","sessionId":"abc123"}"#,
                r#"{"type":"user","timestamp":"2026-07-05T13:42:49.000Z","message":{"role":"user","content":"are we clean on main?"}}"#,
                r#"{"type":"assistant","timestamp":"2026-07-05T13:42:50.000Z","message":{"role":"assistant","content":[{"type":"text","text":"yes"}]}}"#,
                r#"{"type":"ai-title","aiTitle":"Check main branch status","sessionId":"abc123"}"#,
                r#"{"type":"last-prompt","lastPrompt":"pnpm i","timestamp":"2026-07-05T13:45:00.000Z","sessionId":"abc123"}"#,
            ],
        );

        let s = parse_session_file(&file).unwrap();
        assert_eq!(s.session_id, "abc123");
        assert_eq!(s.title.as_deref(), Some("Check main branch status"));
        assert_eq!(s.last_prompt.as_deref(), Some("pnpm i"));
        assert_eq!(s.cwd.as_deref(), Some("/repo"));
        assert_eq!(s.git_branch.as_deref(), Some("main"));
        assert_eq!(s.updated_at.as_deref(), Some("2026-07-05T13:45:00.000Z"));
        assert_eq!(s.message_count, 2);
    }

    #[test]
    fn parse_falls_back_to_first_user_prompt_when_no_ai_title() {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_session(
            tmp.path(),
            "-repo",
            "def456",
            &[
                r#"{"type":"user","message":{"role":"user","content":"implement the resume feature please"}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}"#,
            ],
        );

        let s = parse_session_file(&file).unwrap();
        assert_eq!(
            s.title.as_deref(),
            Some("implement the resume feature please")
        );
        assert_eq!(
            s.last_prompt.as_deref(),
            Some("implement the resume feature please")
        );
    }

    #[test]
    fn parse_prefers_custom_title_and_skips_injected_user_text() {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_session(
            tmp.path(),
            "-repo",
            "named1",
            &[
                r#"{"type":"custom-title","customTitle":"continue-from-session","sessionId":"named1"}"#,
                r#"{"type":"user","message":{"role":"user","content":"<system-reminder>\nThe user named this session \"continue-from-session\".\n</system-reminder>"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"sup?"}}"#,
                r#"{"type":"last-prompt","lastPrompt":"sup?","sessionId":"named1"}"#,
            ],
        );

        let s = parse_session_file(&file).unwrap();
        // The user's rename wins over everything.
        assert_eq!(s.title.as_deref(), Some("continue-from-session"));
        // The injected system-reminder is never treated as the prompt.
        assert_eq!(s.last_prompt.as_deref(), Some("sup?"));
    }

    #[test]
    fn parse_title_fallback_skips_system_reminder_to_first_real_prompt() {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_session(
            tmp.path(),
            "-repo",
            "reminder1",
            &[
                r#"{"type":"user","message":{"role":"user","content":"<system-reminder>\nThe user named this session.\n</system-reminder>"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"<command-name>/rename</command-name>"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"actually do the thing"}}"#,
            ],
        );

        let s = parse_session_file(&file).unwrap();
        assert_eq!(s.title.as_deref(), Some("actually do the thing"));
        assert_eq!(s.last_prompt.as_deref(), Some("actually do the thing"));
    }

    #[test]
    fn is_genuine_user_text_rejects_injected_content() {
        assert!(is_genuine_user_text("do the thing"));
        assert!(!is_genuine_user_text("   "));
        assert!(!is_genuine_user_text(
            "<system-reminder>\nhi\n</system-reminder>"
        ));
        assert!(!is_genuine_user_text(
            "<command-name>/rename</command-name>"
        ));
        assert!(!is_genuine_user_text(
            "<local-command-stdout>Session renamed</local-command-stdout>"
        ));
    }

    #[test]
    fn list_sessions_sorts_by_recency_and_filters_by_project_root() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("projects");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let repo_str = repo.to_string_lossy().to_string();

        write_session(
            &base,
            &encode_project_dir(&repo_str),
            "older",
            &[&format!(
                r#"{{"type":"user","timestamp":"2026-07-01T00:00:00.000Z","cwd":"{repo_str}","message":{{"role":"user","content":"first"}}}}"#
            )],
        );
        write_session(
            &base,
            &encode_project_dir(&repo_str),
            "newer",
            &[&format!(
                r#"{{"type":"user","timestamp":"2026-07-05T00:00:00.000Z","cwd":"{repo_str}","message":{{"role":"user","content":"second"}}}}"#
            )],
        );
        // A session from an unrelated directory that must be filtered out.
        write_session(
            &base,
            "-somewhere-else",
            "other",
            &[
                r#"{"type":"user","timestamp":"2026-07-09T00:00:00.000Z","cwd":"/somewhere/else","message":{"role":"user","content":"nope"}}"#,
            ],
        );

        let all = list_sessions_in(&base, None);
        assert_eq!(all.len(), 3);

        let filtered = list_sessions_in(&base, Some(&repo));
        let ids: Vec<&str> = filtered.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["newer", "older"]);
    }

    #[test]
    fn dir_could_contain_project_is_a_superset_of_the_cwd_filter() {
        let root = "/Users/x/repo";
        let encoded = encode_project_dir(root);
        // Exact project dir and subdirectory cwds must be admitted.
        assert!(dir_could_contain_project(&encoded, &encoded));
        assert!(dir_could_contain_project(
            &encode_project_dir("/Users/x/repo/src"),
            &encoded
        ));
        // A sibling that merely shares a character prefix is admitted here (superset) but
        // is removed later by the component-wise cwd `starts_with`, so results stay exact.
        assert!(dir_could_contain_project(
            &encode_project_dir("/Users/x/repofoo"),
            &encoded
        ));
        assert!(!Path::new("/Users/x/repofoo").starts_with(root));
        // Unrelated projects are skipped without being parsed.
        assert!(!dir_could_contain_project(
            &encode_project_dir("/Users/x/other"),
            &encoded
        ));
    }

    #[test]
    fn list_sessions_skips_unrelated_project_dirs_without_reading_them() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("projects");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let repo_str = repo.to_string_lossy().to_string();

        write_session(
            &base,
            &encode_project_dir(&repo_str),
            "mine",
            &[&format!(
                r#"{{"type":"user","timestamp":"2026-07-05T00:00:00.000Z","cwd":"{repo_str}","message":{{"role":"user","content":"mine"}}}}"#
            )],
        );
        // An unrelated project whose transcript is unparseable garbage: if the pre-filter
        // works we never read it, and enumeration returns only the project's own session.
        let other_dir = base.join("-Users-someone-else-elsewhere");
        fs::create_dir_all(&other_dir).unwrap();
        fs::write(other_dir.join("garbage.jsonl"), "not json at all").unwrap();

        let filtered = list_sessions_in(&base, Some(&repo));
        let ids: Vec<&str> = filtered.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["mine"]);
    }

    #[test]
    fn copy_transcript_into_worktree_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("projects");
        write_session(
            &base,
            "-repo",
            "sess1",
            &[r#"{"type":"user","message":{"role":"user","content":"hi"}}"#],
        );
        let worktree = tmp.path().join("worktrees").join("AVIV-1");
        fs::create_dir_all(&worktree).unwrap();

        let target = copy_transcript_into_worktree_in(&base, "sess1", &worktree).unwrap();
        assert!(target.is_file());
        let expected_dir = base.join(encode_project_dir(&worktree.to_string_lossy()));
        assert_eq!(target, expected_dir.join("sess1.jsonl"));

        // Mutate the copy, then copy again: idempotent copy must not clobber it.
        fs::write(&target, "SENTINEL").unwrap();
        let again = copy_transcript_into_worktree_in(&base, "sess1", &worktree).unwrap();
        assert_eq!(again, target);
        assert_eq!(fs::read_to_string(&target).unwrap(), "SENTINEL");
    }

    #[test]
    fn is_valid_session_id_rejects_traversal_and_separators() {
        assert!(is_valid_session_id("86c3fa06-9b59-47ec-b522-0d1c3c58fde7"));
        assert!(is_valid_session_id("abc123"));
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("../../etc/passwd"));
        assert!(!is_valid_session_id("a/b"));
        assert!(!is_valid_session_id(".."));
        assert!(!is_valid_session_id("has space"));
    }

    #[test]
    fn copy_transcript_rejects_unsafe_session_id() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("projects");
        fs::create_dir_all(&base).unwrap();
        let worktree = tmp.path().join("wt");
        fs::create_dir_all(&worktree).unwrap();
        let err = copy_transcript_into_worktree_in(&base, "../../../tmp/evil", &worktree)
            .expect_err("must reject traversal ids");
        assert!(err.contains("invalid session id"));
    }

    #[test]
    fn copy_transcript_errors_for_unknown_session() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("projects");
        fs::create_dir_all(&base).unwrap();
        let worktree = tmp.path().join("wt");
        fs::create_dir_all(&worktree).unwrap();
        assert!(copy_transcript_into_worktree_in(&base, "missing", &worktree).is_err());
    }
}
