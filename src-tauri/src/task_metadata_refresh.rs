use crate::db;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_TASK_DISPLAY_TITLE_CHARS: usize = 60;
const MAX_TRANSCRIPT_SNAPSHOT_BYTES: u64 = 16 * 1024;
const MAX_ACTIVITY_SNAPSHOT_BYTES: usize = 8 * 1024;
const TITLE_REFRESH_DELAY_SECONDS: u64 = 8;
const TITLE_PROVIDER_TIMEOUT_SECONDS: u64 = 60;
const TASK_DISPLAY_TITLE_JSON_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":60}},"required":["title"]}"#;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TaskDisplayTitleSnapshot {
    pub(crate) transcript_excerpt: Option<String>,
    pub(crate) activity_excerpt: Option<String>,
}

impl TaskDisplayTitleSnapshot {
    fn is_empty(&self) -> bool {
        self.transcript_excerpt
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
            && self
                .activity_excerpt
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
    }
}

/// Build a short Task Display Title candidate from bounded out-of-band metadata.
///
/// This is intentionally separate from the provider prompt so metadata refreshes do
/// not pollute the main Agent Session context. Provider adapters can pass bounded
/// transcript/activity snapshots through this module without changing the
/// write-safety rules.
pub(crate) fn task_display_title_candidate(task: &db::TaskRow) -> Option<String> {
    [task.prompt.as_deref(), Some(task.initial_prompt.as_str())]
        .into_iter()
        .flatten()
        .find_map(normalize_task_display_title)
}

fn normalize_task_display_title(text: &str) -> Option<String> {
    let first_line = text.lines().find_map(|line| {
        let trimmed = line.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    })?;

    let stripped = first_line
        .trim_matches(|ch: char| {
            matches!(ch, '#' | '*' | '-' | ':' | '"' | '\'' | '`') || ch.is_whitespace()
        })
        .trim();
    if stripped.is_empty() {
        return None;
    }

    let mut title = String::new();
    for ch in stripped.chars() {
        if ch.is_control() {
            continue;
        }
        if title.chars().count() >= MAX_TASK_DISPLAY_TITLE_CHARS {
            break;
        }
        title.push(ch);
    }
    let title = title.trim().to_string();
    (!title.is_empty()).then_some(title)
}

fn strip_between(mut text: String, start: &str, end: &str) -> String {
    loop {
        let Some(start_index) = text.find(start) else {
            return text;
        };
        let Some(relative_end) = text[start_index..].find(end) else {
            text.replace_range(start_index.., "");
            return text;
        };
        let end_index = start_index + relative_end + end.len();
        text.replace_range(start_index..end_index, "");
    }
}

fn sanitize_metadata_text(text: &str) -> String {
    let stripped = strip_between(
        strip_between(
            text.to_string(),
            "<openforge_task_management>",
            "</openforge_task_management>",
        ),
        "<openforge_code_cleanup>",
        "</openforge_code_cleanup>",
    );

    stripped
        .lines()
        .filter(|line| !line.contains("openforge update-task"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn tail_bounded_lossy(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    String::from_utf8_lossy(&text.as_bytes()[text.len() - max_bytes..]).to_string()
}

pub(crate) fn task_display_title_snapshot(
    transcript_path: Option<&Path>,
    activity_snapshot: Option<&str>,
) -> Option<TaskDisplayTitleSnapshot> {
    let snapshot = TaskDisplayTitleSnapshot {
        transcript_excerpt: transcript_path.and_then(read_transcript_excerpt),
        activity_excerpt: activity_snapshot.and_then(|activity| {
            let trimmed = activity.trim();
            (!trimmed.is_empty()).then(|| tail_bounded_lossy(trimmed, MAX_ACTIVITY_SNAPSHOT_BYTES))
        }),
    };

    (!snapshot.is_empty()).then_some(snapshot)
}

pub(crate) fn build_task_display_title_prompt(
    task: &db::TaskRow,
    snapshot: Option<&TaskDisplayTitleSnapshot>,
) -> String {
    let task_prompt =
        sanitize_metadata_text(task.prompt.as_deref().unwrap_or(&task.initial_prompt));
    let transcript = snapshot
        .and_then(|snapshot| snapshot.transcript_excerpt.as_deref())
        .map(sanitize_metadata_text)
        .unwrap_or_default();
    let activity = snapshot
        .and_then(|snapshot| snapshot.activity_excerpt.as_deref())
        .map(sanitize_metadata_text)
        .unwrap_or_default();
    format!(
        "You are naming an OpenForge Task from bounded provider metadata snapshots.\n\
Return only JSON with exactly one string field: title.\n\
The title must be 3-7 words, short, memorable, specific, and at most {MAX_TASK_DISPLAY_TITLE_CHARS} characters.\n\
Do not mention OpenForge task management, handoff notes, branches, or generic words like task/thread/session.\n\n\
Task prompt:\n{task_prompt}\n\n\
Provider transcript snapshot:\n{transcript}\n\n\
Provider activity snapshot:\n{activity}\n"
    )
}

pub(crate) fn parse_task_display_title_output(raw: &str) -> Result<Option<String>, String> {
    parse_task_display_title_output_inner(raw, 0)
}

fn parse_task_display_title_output_inner(raw: &str, depth: u8) -> Result<Option<String>, String> {
    if depth > 3 {
        return Err("task display title response was nested too deeply".to_string());
    }

    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let value = serde_json::from_str::<Value>(cleaned)
        .or_else(|_| extract_json_object(cleaned).and_then(|json| serde_json::from_str(json)))
        .map_err(|error| format!("failed to parse task display title JSON: {error}"))?;

    if let Some(title) = title_from_value(&value) {
        return Ok(Some(title));
    }

    if value.get("is_error").and_then(Value::as_bool) == Some(true) {
        let detail = provider_error_detail(&value);
        return Err(format!(
            "task display title generation failed{}",
            detail
                .as_deref()
                .map(|message| format!(": {message}"))
                .unwrap_or_default()
        ));
    }

    for key in [
        "structured_output",
        "result",
        "output",
        "message",
        "content",
        "text",
        "response",
    ] {
        if let Some(next) = value.get(key) {
            if let Some(text) = next.as_str() {
                if let Some(title) = parse_task_display_title_output_inner(text, depth + 1)? {
                    return Ok(Some(title));
                }
            } else if next.is_object() {
                if let Some(title) = title_from_value(next) {
                    return Ok(Some(title));
                }
            } else if let Some(items) = next.as_array() {
                for item in items {
                    if let Some(text) = item.as_str() {
                        if let Some(title) = parse_task_display_title_output_inner(text, depth + 1)?
                        {
                            return Ok(Some(title));
                        }
                    } else if let Some(text) = item.get("text").and_then(Value::as_str) {
                        if let Some(title) = parse_task_display_title_output_inner(text, depth + 1)?
                        {
                            return Ok(Some(title));
                        }
                    } else if let Some(title) = title_from_value(item) {
                        return Ok(Some(title));
                    }
                }
            }
        }
    }

    Ok(None)
}

fn title_from_value(value: &Value) -> Option<String> {
    value
        .get("title")
        .and_then(Value::as_str)
        .and_then(normalize_task_display_title)
}

fn provider_error_detail(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    for key in ["subtype", "error", "message", "result"] {
        if let Some(message) = value.get(key).and_then(Value::as_str) {
            let message = message.trim();
            if !message.is_empty() {
                parts.push(message.to_string());
            }
        }
    }

    if let Some(errors) = value.get("errors").and_then(Value::as_array) {
        for error in errors {
            if let Some(message) = error.as_str() {
                let message = message.trim();
                if !message.is_empty() {
                    parts.push(message.to_string());
                }
            }
        }
    }

    (!parts.is_empty()).then(|| parts.join(": "))
}

fn build_claude_title_headless_args(prompt: &str) -> Vec<String> {
    vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--json-schema".to_string(),
        TASK_DISPLAY_TITLE_JSON_SCHEMA.to_string(),
        "--no-session-persistence".to_string(),
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        prompt.to_string(),
    ]
}

fn build_opencode_title_headless_args(prompt: &str) -> Vec<String> {
    vec!["run".to_string(), prompt.to_string()]
}
fn extract_json_object(raw: &str) -> Result<&str, serde_json::Error> {
    let Some(start) = raw.find('{') else {
        return serde_json::from_str::<Value>(raw).map(|_| raw);
    };
    let Some(end) = raw.rfind('}') else {
        return serde_json::from_str::<Value>(raw).map(|_| raw);
    };
    Ok(&raw[start..=end])
}

fn read_transcript_excerpt(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(MAX_TRANSCRIPT_SNAPSHOT_BYTES);
    let mut reader = std::io::BufReader::new(file);
    use std::io::{Read, Seek};
    reader.seek(std::io::SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

fn build_codex_title_headless_args(
    schema_path: &Path,
    output_path: &Path,
    prompt: &str,
) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--ask-for-approval".to_string(),
        "never".to_string(),
        "--skip-git-repo-check".to_string(),
        "--ephemeral".to_string(),
        "--ignore-rules".to_string(),
        "--color".to_string(),
        "never".to_string(),
        "--output-schema".to_string(),
        schema_path.to_string_lossy().to_string(),
        "--output-last-message".to_string(),
        output_path.to_string_lossy().to_string(),
        prompt.to_string(),
    ]
}

async fn run_codex_title_headless(prompt: &str) -> Result<Option<String>, String> {
    let temp_dir =
        std::env::temp_dir().join(format!("openforge-task-title-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("failed to create task title temp dir: {error}"))?;
    let schema_path = temp_dir.join("task-title.schema.json");
    let output_path = temp_dir.join("task-title.output.json");
    if let Err(error) = std::fs::write(&schema_path, TASK_DISPLAY_TITLE_JSON_SCHEMA) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!("failed to write task title schema: {error}"));
    }

    let args = build_codex_title_headless_args(&schema_path, &output_path, prompt);
    let result = run_headless_title_command("codex", &args, Some(&output_path)).await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    result.and_then(|raw| parse_task_display_title_output(&raw))
}

async fn run_claude_title_headless(prompt: &str) -> Result<Option<String>, String> {
    let args = build_claude_title_headless_args(prompt);
    run_headless_title_command("claude", &args, None)
        .await
        .and_then(|raw| parse_task_display_title_output(&raw))
}

async fn run_opencode_title_headless(prompt: &str) -> Result<Option<String>, String> {
    let args = build_opencode_title_headless_args(prompt);
    run_headless_title_command("opencode", &args, None)
        .await
        .and_then(|raw| parse_task_display_title_output(&raw))
}

async fn run_headless_title_command(
    program: &str,
    args: &[String],
    output_file: Option<&Path>,
) -> Result<String, String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args);
    command.env("NO_COLOR", "1");
    for key in [
        "OPENFORGE_TASK_ID",
        "OPENFORGE_PTY_INSTANCE_ID",
        "OPENFORGE_HTTP_PORT",
        "CLAUDE_TASK_ID",
    ] {
        command.env_remove(key);
    }
    let output = tokio::time::timeout(
        Duration::from_secs(TITLE_PROVIDER_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .map_err(|_| format!("{program} task title generation timed out"))?
    .map_err(|error| format!("failed to launch {program} for task title generation: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{program} task title generation failed: {detail}"));
    }

    if let Some(path) = output_file {
        if let Ok(content) = std::fs::read_to_string(path) {
            if !content.trim().is_empty() {
                return Ok(content);
            }
        }
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn run_title_provider(provider: &str, prompt: &str) -> Result<Option<String>, String> {
    match provider {
        "codex" => run_codex_title_headless(prompt).await,
        "claude-code" => run_claude_title_headless(prompt).await,
        "opencode" => run_opencode_title_headless(prompt).await,
        "pi" => Err(
            "Pi headless task title generation is not supported yet; falling back to metadata"
                .to_string(),
        ),
        other => Err(format!(
            "task title AI generation is not supported for provider '{other}'"
        )),
    }
}

/// Attempt the early out-of-band Task Display Title refresh.
///
/// The database method performs the final atomic eligibility check so a manual
/// rename that happens while metadata is being prepared is never overwritten.
#[cfg(test)]
pub(crate) fn refresh_task_display_title_once(
    db: &db::Database,
    task_id: &str,
) -> Result<bool, String> {
    refresh_task_display_title_once_with_provider(db, task_id, None, |_| Ok(None))
}

#[cfg(test)]
pub(crate) fn refresh_task_display_title_once_with_provider<F>(
    db: &db::Database,
    task_id: &str,
    snapshot: Option<&TaskDisplayTitleSnapshot>,
    title_provider: F,
) -> Result<bool, String>
where
    F: FnOnce(&str) -> Result<Option<String>, String>,
{
    let Some(task) = db
        .get_task(task_id)
        .map_err(|error| format!("failed to load task for title refresh: {error}"))?
    else {
        return Ok(false);
    };

    if task.title_source.as_deref() == Some("manual") || task.title_generated_at.is_some() {
        return Ok(false);
    }

    let prompt = build_task_display_title_prompt(&task, snapshot);
    let candidate = title_provider(&prompt)
        .ok()
        .flatten()
        .or_else(|| task_display_title_candidate(&task));
    let Some(candidate) = candidate else {
        return Ok(false);
    };

    db.update_generated_task_title_once(task_id, &candidate)
        .map_err(|error| format!("failed to write generated task display title: {error}"))
}

pub(crate) async fn refresh_task_display_title_with_ai_once(
    db: Arc<Mutex<db::Database>>,
    task_id: String,
    provider: String,
    transcript_path: Option<PathBuf>,
    activity_snapshot: Option<String>,
) -> Result<bool, String> {
    tokio::time::sleep(Duration::from_secs(TITLE_REFRESH_DELAY_SECONDS)).await;

    let task = {
        let guard = db.lock().unwrap();
        guard
            .get_task(&task_id)
            .map_err(|error| format!("failed to load task for AI title refresh: {error}"))?
    };
    let snapshot =
        task_display_title_snapshot(transcript_path.as_deref(), activity_snapshot.as_deref());
    let Some(task) = task else {
        return Ok(false);
    };
    if task.title_source.as_deref() == Some("manual") || task.title_generated_at.is_some() {
        return Ok(false);
    }

    let prompt = build_task_display_title_prompt(&task, snapshot.as_ref());
    let provider_title = run_title_provider(&provider, &prompt).await.ok().flatten();
    let candidate = provider_title.or_else(|| task_display_title_candidate(&task));
    let Some(candidate) = candidate else {
        return Ok(false);
    };

    let guard = db.lock().unwrap();
    guard
        .update_generated_task_title_once(&task_id, &candidate)
        .map_err(|error| format!("failed to write AI generated task display title: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::*;

    #[test]
    fn task_display_title_candidate_uses_short_first_prompt_line() {
        let (db, path) = make_test_db("metadata_title_candidate");
        let task = db
            .create_task(
                "  Investigate flaky migration race\nwith lots of details",
                "doing",
                None,
                None,
                None,
            )
            .expect("create task");

        assert_eq!(
            task_display_title_candidate(&task).as_deref(),
            Some("Investigate flaky migration race")
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refresh_task_display_title_once_sets_generated_title() {
        let (db, path) = make_test_db("metadata_refresh_generated_title");
        let task = db
            .create_task(
                "Repair SQLite migration race\nExtra detail",
                "doing",
                None,
                None,
                None,
            )
            .expect("create task");

        assert!(refresh_task_display_title_once(&db, &task.id).expect("refresh title"));
        let updated = db.get_task(&task.id).expect("get task").unwrap();
        assert_eq!(
            updated.title.as_deref(),
            Some("Repair SQLite migration race")
        );
        assert_eq!(updated.title_source.as_deref(), Some("generated"));
        assert!(updated.title_generated_at.is_some());

        assert!(!refresh_task_display_title_once(&db, &task.id).expect("second refresh"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn build_task_display_title_prompt_uses_snapshot_without_management_blocks() {
        let (db, path) = make_test_db("metadata_title_prompt_snapshot");
        let task = db
            .create_task("Initial vague request", "doing", None, None, None)
            .expect("create task");
        let snapshot = TaskDisplayTitleSnapshot {
            transcript_excerpt: Some("<openforge_task_management>openforge update-task --task-id T-1 --summary ...</openforge_task_management>\nActual topic: repair OAuth token refresh race".to_string()),
            activity_excerpt: Some("<openforge_code_cleanup>noise</openforge_code_cleanup>\nTool activity: edited auth middleware".to_string()),
        };

        let prompt = build_task_display_title_prompt(&task, Some(&snapshot));

        assert!(prompt.contains("repair OAuth token refresh race"));
        assert!(prompt.contains("edited auth middleware"));
        assert!(!prompt.contains("openforge_task_management"));
        assert!(!prompt.contains("openforge_code_cleanup"));
        assert!(!prompt.contains("openforge update-task"));
        assert!(prompt.contains("Return only JSON"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_task_display_title_output_reads_json_title() {
        assert_eq!(
            parse_task_display_title_output(r#"{"title":"OAuth Refresh Race"}"#)
                .expect("parse title")
                .as_deref(),
            Some("OAuth Refresh Race")
        );
    }

    #[test]
    fn parse_task_display_title_output_reads_nested_provider_json() {
        assert_eq!(
            parse_task_display_title_output(
                r#"{"result":"{\"title\":\"Provider Snapshot Title\"}"}"#
            )
            .expect("parse nested title")
            .as_deref(),
            Some("Provider Snapshot Title")
        );
    }

    #[test]
    fn provider_title_headless_args_are_session_isolated() {
        let claude_args = build_claude_title_headless_args("Name this work");
        assert!(claude_args.contains(&"--no-session-persistence".to_string()));
        assert!(claude_args.contains(&"--permission-mode".to_string()));
        assert!(claude_args.contains(&"dontAsk".to_string()));

        let schema_path = Path::new("/tmp/title.schema.json");
        let output_path = Path::new("/tmp/title.output.json");
        let codex_args =
            build_codex_title_headless_args(schema_path, output_path, "Name this work");
        assert!(codex_args.contains(&"--ephemeral".to_string()));
        assert!(codex_args.contains(&"--ignore-rules".to_string()));

        let opencode_args = build_opencode_title_headless_args("Name this work");
        assert_eq!(
            opencode_args,
            vec!["run".to_string(), "Name this work".to_string()]
        );
    }

    #[test]
    fn refresh_task_display_title_once_uses_ai_title_when_provider_succeeds() {
        let (db, path) = make_test_db("metadata_refresh_ai_title");
        let task = db
            .create_task("Vague initial prompt", "doing", None, None, None)
            .expect("create task");

        let snapshot = TaskDisplayTitleSnapshot {
            transcript_excerpt: Some("Actual topic: repair SQLite lock contention".to_string()),
            activity_excerpt: Some("Edited database retry code after failing test".to_string()),
        };

        assert!(refresh_task_display_title_once_with_provider(
            &db,
            &task.id,
            Some(&snapshot),
            |_| Ok(Some("SQLite Lock Fix".to_string())),
        )
        .expect("refresh title"));
        let updated = db.get_task(&task.id).expect("get task").unwrap();
        assert_eq!(updated.title.as_deref(), Some("SQLite Lock Fix"));
        assert_eq!(updated.title_source.as_deref(), Some("generated"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refresh_task_display_title_once_skips_manual_title() {
        let (db, path) = make_test_db("metadata_refresh_manual_title");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "Generated candidate",
                status: "doing",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: Some("Manual title"),
                handoff_notes_enabled: true,
            })
            .expect("create task");

        assert!(!refresh_task_display_title_once(&db, &task.id).expect("refresh title"));
        let updated = db.get_task(&task.id).expect("get task").unwrap();
        assert_eq!(updated.title.as_deref(), Some("Manual title"));
        assert_eq!(updated.title_source.as_deref(), Some("manual"));

        let _ = std::fs::remove_file(&path);
    }
}
