use crate::db;
use log::{debug, warn};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(super) const MAX_TASK_DISPLAY_TITLE_CHARS: usize = 60;
pub(super) const MAX_TRANSCRIPT_SNAPSHOT_BYTES: u64 = 16 * 1024;
pub(super) const MAX_ACTIVITY_SNAPSHOT_BYTES: usize = 8 * 1024;
pub(super) const TASK_DISPLAY_TITLE_JSON_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":60}},"required":["title"]}"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MetadataJobKind {
    TaskDisplayTitle,
}

impl MetadataJobKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::TaskDisplayTitle => "task_display_title",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct MetadataJobSnapshot {
    pub(super) transcript_path: Option<PathBuf>,
    pub(super) transcript_excerpt: Option<String>,
    pub(super) activity_excerpt: Option<String>,
}

impl MetadataJobSnapshot {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MetadataJob {
    pub(super) task_id: String,
    pub(super) provider: String,
    pub(super) kind: MetadataJobKind,
    pub(super) snapshot: Option<MetadataJobSnapshot>,
    pub(super) output_schema: String,
}

/// Build a short Task Display Title candidate from bounded out-of-band metadata.
///
/// This is intentionally separate from the provider prompt so metadata refreshes do
/// not pollute the main Agent Session context. Provider adapters can pass bounded
/// transcript/activity snapshots through this module without changing the
/// write-safety rules.
pub(super) fn task_display_title_candidate(task: &db::TaskRow) -> Option<String> {
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
    strip_between(
        text.to_string(),
        "<openforge_start_prompt_contribution",
        "</openforge_start_prompt_contribution>",
    )
    .trim()
    .to_string()
}

fn tail_bounded_lossy(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    String::from_utf8_lossy(&text.as_bytes()[text.len() - max_bytes..]).to_string()
}

fn metadata_job_snapshot(
    transcript_path: Option<&Path>,
    activity_snapshot: Option<&str>,
) -> Option<MetadataJobSnapshot> {
    let snapshot = MetadataJobSnapshot {
        transcript_path: transcript_path.map(Path::to_path_buf),
        transcript_excerpt: transcript_path.and_then(read_transcript_excerpt),
        activity_excerpt: activity_snapshot.and_then(|activity| {
            let trimmed = activity.trim();
            (!trimmed.is_empty()).then(|| tail_bounded_lossy(trimmed, MAX_ACTIVITY_SNAPSHOT_BYTES))
        }),
    };

    (!snapshot.is_empty()).then_some(snapshot)
}

pub(super) fn build_task_display_title_metadata_job(
    task_id: &str,
    provider: &str,
    transcript_path: Option<PathBuf>,
    activity_snapshot: Option<String>,
) -> MetadataJob {
    MetadataJob {
        task_id: task_id.to_string(),
        provider: provider.to_string(),
        kind: MetadataJobKind::TaskDisplayTitle,
        snapshot: metadata_job_snapshot(transcript_path.as_deref(), activity_snapshot.as_deref()),
        output_schema: TASK_DISPLAY_TITLE_JSON_SCHEMA.to_string(),
    }
}

pub(super) fn build_task_display_title_prompt(
    task: &db::TaskRow,
    snapshot: Option<&MetadataJobSnapshot>,
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
Do not mention OpenForge task management, branches, or generic words like task/thread/session.\n\n\
Task prompt:\n{task_prompt}\n\n\
Provider transcript snapshot:\n{transcript}\n\n\
Provider activity snapshot:\n{activity}\n"
    )
}

pub(super) fn parse_task_display_title_output(raw: &str) -> Result<Option<String>, String> {
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
        .or_else(|_| extract_json_object(cleaned).and_then(serde_json::from_str))
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
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) => {
            warn!("[task_metadata_refresh] failed to open transcript snapshot: {error}");
            return None;
        }
    };
    let len = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            warn!("[task_metadata_refresh] failed to read transcript snapshot metadata: {error}");
            return None;
        }
    };
    let start = len.saturating_sub(MAX_TRANSCRIPT_SNAPSHOT_BYTES);
    let mut reader = std::io::BufReader::new(file);
    use std::io::{Read, Seek};
    if let Err(error) = reader.seek(std::io::SeekFrom::Start(start)) {
        warn!("[task_metadata_refresh] failed to seek transcript snapshot len={len}: {error}");
        return None;
    }
    let mut buf = Vec::new();
    if let Err(error) = reader.read_to_end(&mut buf) {
        warn!("[task_metadata_refresh] failed to read transcript snapshot len={len}: {error}");
        return None;
    }
    debug!(
        "[task_metadata_refresh] loaded transcript snapshot len={} excerpt_bytes={}",
        len,
        buf.len()
    );
    Some(String::from_utf8_lossy(&buf).to_string())
}
