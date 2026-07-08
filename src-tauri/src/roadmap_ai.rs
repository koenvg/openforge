//! Shared ticket-draft prompt building and response parsing for roadmap Refine.
//!
//! The refinement call itself is made against the Anthropic cloud API (see
//! `anthropic_client`). This module keeps the provider-agnostic pieces: the
//! ticket-draft types, the prompt builder, and the robust JSON parser for the
//! model's `{ title, body }` output.

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
            "ticket drafting failed{}",
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
    fn roadmap_ai_parses_result_wrapper_json() {
        let draft = parse_ticket_draft_output(
            r#"{"type":"result","result":"{\"title\":\"Tighter title\",\"body\":\"Markdown body\"}"}"#,
        )
        .expect("wrapped draft should parse");

        assert_eq!(draft.title, "Tighter title");
        assert_eq!(draft.body, "Markdown body");
    }

    #[test]
    fn roadmap_ai_parses_structured_output_before_result_text() {
        let draft = parse_ticket_draft_output(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","structured_output":{"title":"Tighter title","body":"Markdown body"}}"#,
        )
        .expect("structured output should parse before plain result text");

        assert_eq!(draft.title, "Tighter title");
        assert_eq!(draft.body, "Markdown body");
    }

    #[test]
    fn roadmap_ai_reports_error_wrapper() {
        let err = parse_ticket_draft_output(
            r#"{"type":"result","subtype":"error_max_budget_usd","is_error":true,"errors":["Reached maximum budget ($0.02)"]}"#,
        )
        .expect_err("provider error wrapper should fail");

        assert!(err.contains("ticket drafting failed"));
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

    #[test]
    fn roadmap_ai_builds_initial_prompt_from_rough_note() {
        let request = TicketDraftRequest {
            repo: "acme/widgets".to_string(),
            text: "users lose drafts on reload".to_string(),
            draft: None,
            feedback: String::new(),
            labels: vec![],
        };

        let prompt = build_ticket_draft_prompt(&request);

        assert!(prompt.contains("acme/widgets"));
        assert!(prompt.contains("Selected labels: none"));
        assert!(prompt.contains("users lose drafts on reload"));
    }
}
