use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

const TICKET_DRAFT_JSON_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1},"body":{"type":"string"}},"required":["title","body"]}"#;
const HEADLESS_TIMEOUT_SECONDS: u64 = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TicketDraft {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TicketDraftRequest {
    pub repo: String,
    pub text: String,
    pub draft: Option<TicketDraft>,
    pub feedback: String,
    pub labels: Vec<String>,
}

impl TicketDraftRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let text = self.text.trim();
        let feedback = self.feedback.trim();
        if self.draft.is_some() {
            if feedback.is_empty() {
                return Err("feedback is required when revising a draft".to_string());
            }
        } else if text.is_empty() {
            return Err("text is required".to_string());
        }
        Ok(())
    }
}

pub(crate) async fn refine_ticket(
    provider: &str,
    project_path: Option<&Path>,
    request: &TicketDraftRequest,
) -> Result<TicketDraft, String> {
    request.validate()?;
    let prompt = build_ticket_draft_prompt(request);

    match provider {
        "codex" => run_codex_headless(project_path, &prompt).await,
        "claude-code" => run_claude_headless(project_path, &prompt).await,
        "opencode" => run_opencode_headless(project_path, &prompt).await,
        "pi" => Err(
            "Pi headless ticket drafting is not supported yet; switch this project to Codex or Claude Code to use Refine."
                .to_string(),
        ),
        other => Err(format!(
            "AI ticket drafting is not supported for provider '{other}'"
        )),
    }
}

pub(crate) fn build_ticket_draft_prompt(request: &TicketDraftRequest) -> String {
    let labels = if request.labels.is_empty() {
        "none".to_string()
    } else {
        request.labels.join(", ")
    };

    let mut prompt = String::new();
    prompt.push_str(
        "You are drafting a GitHub issue for a software roadmap board.\n\
Return only a JSON object with exactly these string fields: title, body.\n\
Do not wrap the JSON in Markdown fences.\n\
The body must be useful Markdown for an engineer: include a short summary and concrete acceptance criteria when they are inferable.\n\
Keep the title concise and action-oriented.\n\n",
    );
    prompt.push_str(&format!("Repository: {}\n", request.repo));
    prompt.push_str(&format!("Selected labels: {labels}\n\n"));

    if let Some(draft) = &request.draft {
        prompt.push_str("Revise the current draft using the feedback. Keep useful user edits.\n\n");
        if !request.text.trim().is_empty() {
            prompt.push_str(&format!("Original note:\n{}\n\n", request.text.trim()));
        }
        prompt.push_str(&format!(
            "Current draft title:\n{}\n\nCurrent draft body:\n{}\n\nFeedback:\n{}\n",
            draft.title.trim(),
            draft.body.trim(),
            request.feedback.trim(),
        ));
    } else {
        prompt.push_str("Create the initial issue draft from this rough note:\n");
        prompt.push_str(request.text.trim());
        prompt.push('\n');
    }

    prompt
}

pub(crate) fn build_codex_headless_args(
    schema_path: &Path,
    output_path: &Path,
    project_path: Option<&Path>,
    prompt: &str,
) -> Vec<String> {
    let mut args = vec![
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
    ];
    if let Some(path) = project_path {
        args.push("-C".to_string());
        args.push(path.to_string_lossy().to_string());
    }
    args.push(prompt.to_string());
    args
}

fn build_claude_headless_args(prompt: &str) -> Vec<String> {
    vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--json-schema".to_string(),
        TICKET_DRAFT_JSON_SCHEMA.to_string(),
        "--no-session-persistence".to_string(),
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        prompt.to_string(),
    ]
}

fn build_opencode_headless_args(prompt: &str) -> Vec<String> {
    vec![
        "run".to_string(),
        "--prompt".to_string(),
        prompt.to_string(),
    ]
}

async fn run_codex_headless(
    project_path: Option<&Path>,
    prompt: &str,
) -> Result<TicketDraft, String> {
    let temp_dir =
        std::env::temp_dir().join(format!("openforge-roadmap-ai-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("failed to create temporary Codex schema directory: {error}"))?;
    let schema_path = temp_dir.join("ticket-draft.schema.json");
    let output_path = temp_dir.join("ticket-draft.output.json");
    if let Err(error) = std::fs::write(&schema_path, TICKET_DRAFT_JSON_SCHEMA) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!("failed to write Codex output schema: {error}"));
    }

    let args = build_codex_headless_args(&schema_path, &output_path, project_path, prompt);
    let result = run_headless_command("codex", &args, None, Some(&output_path))
        .await
        .and_then(|stdout| parse_ticket_draft_output(&stdout));
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

async fn run_claude_headless(
    project_path: Option<&Path>,
    prompt: &str,
) -> Result<TicketDraft, String> {
    let args = build_claude_headless_args(prompt);
    let stdout = run_headless_command("claude", &args, project_path, None).await?;
    parse_ticket_draft_output(&stdout)
}

async fn run_opencode_headless(
    project_path: Option<&Path>,
    prompt: &str,
) -> Result<TicketDraft, String> {
    let args = build_opencode_headless_args(prompt);
    let stdout = run_headless_command("opencode", &args, project_path, None).await?;
    parse_ticket_draft_output(&stdout)
}

async fn run_headless_command(
    program: &str,
    args: &[String],
    current_dir: Option<&Path>,
    output_file: Option<&Path>,
) -> Result<String, String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args);
    command.env("NO_COLOR", "1");
    if let Some(path) = current_dir {
        command.current_dir(path);
    }

    let output = tokio::time::timeout(
        Duration::from_secs(HEADLESS_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .map_err(|_| {
        format!("{program} ticket drafting timed out after {HEADLESS_TIMEOUT_SECONDS} seconds")
    })?
    .map_err(|error| format!("failed to launch {program} for ticket drafting: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "{program} ticket drafting failed{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
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

pub(crate) fn parse_ticket_draft_output(raw: &str) -> Result<TicketDraft, String> {
    parse_ticket_draft_output_inner(raw, 0)
}

fn parse_ticket_draft_output_inner(raw: &str, depth: u8) -> Result<TicketDraft, String> {
    if depth > 3 {
        return Err("ticket draft response was nested too deeply".to_string());
    }

    let cleaned = strip_json_code_fence(raw.trim());
    let value = serde_json::from_str::<Value>(cleaned)
        .or_else(|_| extract_json_object(cleaned).and_then(|json| serde_json::from_str(json)))
        .map_err(|error| format!("failed to parse ticket draft JSON: {error}"))?;

    if value.get("title").is_some() || value.get("body").is_some() {
        return draft_from_value(&value);
    }

    if value.get("is_error").and_then(Value::as_bool) == Some(true) {
        let detail = provider_error_detail(&value);
        return Err(format!(
            "Claude Code ticket drafting failed{}",
            detail
                .as_deref()
                .map(|message| format!(": {message}"))
                .unwrap_or_default()
        ));
    }

    if let Some(next) = value.get("structured_output") {
        if let Some(text) = next.as_str() {
            return parse_ticket_draft_output_inner(text, depth + 1);
        }
        if next.is_object() {
            return draft_from_value(next);
        }
    }

    for key in ["result", "output", "message", "content", "text", "response"] {
        if let Some(next) = value.get(key) {
            if let Some(text) = next.as_str() {
                return parse_ticket_draft_output_inner(text, depth + 1);
            }
            if next.is_object() {
                return draft_from_value(next);
            }
            if let Some(items) = next.as_array() {
                for item in items {
                    if let Some(text) = item.as_str() {
                        if let Ok(draft) = parse_ticket_draft_output_inner(text, depth + 1) {
                            return Ok(draft);
                        }
                    } else if let Some(text) = item.get("text").and_then(Value::as_str) {
                        if let Ok(draft) = parse_ticket_draft_output_inner(text, depth + 1) {
                            return Ok(draft);
                        }
                    }
                }
            }
        }
    }

    Err("ticket draft response did not contain title/body JSON".to_string())
}

fn provider_error_detail(value: &Value) -> Option<String> {
    let mut parts = Vec::new();

    if let Some(subtype) = value.get("subtype").and_then(Value::as_str) {
        let subtype = subtype.trim();
        if !subtype.is_empty() {
            parts.push(subtype.to_string());
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

    for key in ["error", "message", "result"] {
        if let Some(message) = value.get(key).and_then(Value::as_str) {
            let message = message.trim();
            if !message.is_empty() {
                parts.push(message.to_string());
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(": "))
    }
}

fn draft_from_value(value: &Value) -> Result<TicketDraft, String> {
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let body = value
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if title.is_empty() {
        return Err("ticket draft title is required".to_string());
    }

    Ok(TicketDraft { title, body })
}

fn strip_json_code_fence(raw: &str) -> &str {
    let Some(without_opening) = raw.strip_prefix("```") else {
        return raw;
    };
    let Some(first_newline) = without_opening.find('\n') else {
        return raw;
    };
    without_opening[first_newline + 1..]
        .trim()
        .strip_suffix("```")
        .unwrap_or(&without_opening[first_newline + 1..])
        .trim()
}

fn extract_json_object(raw: &str) -> Result<&str, serde_json::Error> {
    let Some(start) = raw.find('{') else {
        return serde_json::from_str::<Value>(raw).map(|_| raw);
    };
    let Some(end) = raw.rfind('}') else {
        return serde_json::from_str::<Value>(raw).map(|_| raw);
    };
    if start > end {
        return serde_json::from_str::<Value>(raw).map(|_| raw);
    }
    serde_json::from_str::<Value>(&raw[start..=end]).map(|_| &raw[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roadmap_ai_parses_direct_ticket_draft_json() {
        let draft = parse_ticket_draft_output(
            r#"{"title":"Autosave drafts","body":"Persist drafts on reload."}"#,
        )
        .expect("draft should parse");

        assert_eq!(draft.title, "Autosave drafts");
        assert_eq!(draft.body, "Persist drafts on reload.");
    }

    #[test]
    fn roadmap_ai_parses_claude_result_wrapper_json() {
        let draft = parse_ticket_draft_output(
            r#"{"type":"result","result":"{\"title\":\"Tighter title\",\"body\":\"Markdown body\"}"}"#,
        )
        .expect("wrapped draft should parse");

        assert_eq!(draft.title, "Tighter title");
        assert_eq!(draft.body, "Markdown body");
    }

    #[test]
    fn roadmap_ai_parses_claude_structured_output_before_result_text() {
        let draft = parse_ticket_draft_output(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","structured_output":{"title":"Tighter title","body":"Markdown body"}}"#,
        )
        .expect("structured output should parse before plain result text");

        assert_eq!(draft.title, "Tighter title");
        assert_eq!(draft.body, "Markdown body");
    }

    #[test]
    fn roadmap_ai_reports_claude_error_wrapper() {
        let err = parse_ticket_draft_output(
            r#"{"type":"result","subtype":"error_max_budget_usd","is_error":true,"errors":["Reached maximum budget ($0.02)"]}"#,
        )
        .expect_err("provider error wrapper should fail");

        assert!(err.contains("Claude Code ticket drafting failed"));
        assert!(err.contains("Reached maximum budget ($0.02)"));
    }

    #[test]
    fn roadmap_ai_rejects_empty_title() {
        let err = parse_ticket_draft_output(r#"{"title":" ","body":"Body"}"#)
            .expect_err("empty title should fail");

        assert!(err.contains("title"));
    }

    #[test]
    fn roadmap_ai_rejects_empty_provider_output_without_panicking() {
        let err = parse_ticket_draft_output("").expect_err("empty output should fail");

        assert!(err.contains("failed to parse ticket draft JSON"));
    }

    #[test]
    fn roadmap_ai_builds_codex_headless_args_with_schema_and_output_paths() {
        let args = build_codex_headless_args(
            Path::new("/tmp/schema.json"),
            Path::new("/tmp/output.json"),
            Some(Path::new("/repo")),
            "draft a ticket",
        );

        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--sandbox".to_string()));
        assert!(args.contains(&"read-only".to_string()));
        assert!(args.contains(&"--output-schema".to_string()));
        assert!(args.contains(&"/tmp/schema.json".to_string()));
        assert!(args.contains(&"--output-last-message".to_string()));
        assert!(args.contains(&"/tmp/output.json".to_string()));
        assert!(args.contains(&"-C".to_string()));
        assert!(args.contains(&"/repo".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("draft a ticket"));
    }

    #[test]
    fn roadmap_ai_builds_revision_prompt_with_current_draft_and_feedback() {
        let request = TicketDraftRequest {
            repo: "acme/widgets".to_string(),
            text: "users lose drafts".to_string(),
            draft: Some(TicketDraft {
                title: "Draft v1".to_string(),
                body: "First body.".to_string(),
            }),
            feedback: "make it tighter".to_string(),
            labels: vec!["bug".to_string()],
        };

        let prompt = build_ticket_draft_prompt(&request);

        assert!(prompt.contains("acme/widgets"));
        assert!(prompt.contains("users lose drafts"));
        assert!(prompt.contains("Draft v1"));
        assert!(prompt.contains("make it tighter"));
        assert!(prompt.contains("bug"));
    }
}
