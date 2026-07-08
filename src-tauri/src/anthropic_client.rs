//! Anthropic Messages API client.
//!
//! Calls `POST /v1/messages` on the Anthropic cloud API using the user's stored
//! API key (see `secure_store` / the `anthropic_api_key` keychain secret). The
//! ticket-refinement flow reuses the roadmap prompt builder and the ticket-draft
//! parser so the request/response plumbing stays small and testable.

use crate::roadmap_ai::{
    build_ticket_draft_prompt, parse_ticket_draft_output, TicketDraft, TicketDraftRequest,
};
use serde_json::Value;
use std::time::Duration;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// The "high-Q" model requested for cloud refinement.
const HIGH_Q_MODEL: &str = "claude-opus-4-8";
const MAX_TOKENS: u32 = 4096;
const REQUEST_TIMEOUT_SECONDS: u64 = 120;
const ANTHROPIC_API_KEY_SECRET: &str = "anthropic_api_key";

/// Return the configured Anthropic API key, if a non-empty one is stored in the
/// OS keychain.
pub(crate) fn api_key() -> Option<String> {
    match crate::secure_store::get_secret(ANTHROPIC_API_KEY_SECRET) {
        Ok(Some(key)) if !key.trim().is_empty() => Some(key),
        _ => None,
    }
}

/// Whether an Anthropic API key is configured. Never exposes the key itself.
pub(crate) fn is_configured() -> bool {
    api_key().is_some()
}

/// Build the JSON body for a `POST /v1/messages` request with a single user
/// message.
pub(crate) fn build_messages_request_body(model: &str, max_tokens: u32, prompt: &str) -> Value {
    serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    })
}

/// Concatenate the `text` blocks of an Anthropic Messages API response.
pub(crate) fn extract_response_text(response: &Value) -> Result<String, String> {
    let blocks = response
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "Anthropic response is missing a content array".to_string())?;

    let mut text = String::new();
    for block in blocks {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(chunk) = block.get("text").and_then(Value::as_str) {
                text.push_str(chunk);
            }
        }
    }

    if text.trim().is_empty() {
        return Err("Anthropic response contained no text content".to_string());
    }

    Ok(text)
}

/// Refine a roadmap ticket draft through the Anthropic cloud API (Claude Opus
/// 4.8), reusing the shared prompt builder and ticket-draft parser.
pub(crate) async fn refine_ticket_draft(
    api_key: &str,
    request: &TicketDraftRequest,
) -> Result<TicketDraft, String> {
    request.validate()?;
    let prompt = build_ticket_draft_prompt(request);
    let body = build_messages_request_body(HIGH_Q_MODEL, MAX_TOKENS, &prompt);

    let response = reqwest::Client::new()
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .send()
        .await
        .map_err(|error| format!("failed to call the Anthropic API: {error}"))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("failed to read the Anthropic API response: {error}"))?;

    if !status.is_success() {
        let detail = response_text.trim();
        return Err(format!(
            "Anthropic API request failed ({status}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let json: Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("failed to parse the Anthropic API response: {error}"))?;
    let text = extract_response_text(&json)?;
    parse_ticket_draft_output(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_messages_request_body_with_model_tokens_and_user_message() {
        let body = build_messages_request_body("claude-opus-4-8", 4096, "draft a ticket");

        assert_eq!(
            body.get("model").and_then(Value::as_str),
            Some("claude-opus-4-8")
        );
        assert_eq!(body.get("max_tokens").and_then(Value::as_u64), Some(4096));

        let messages = body
            .get("messages")
            .and_then(Value::as_array)
            .expect("messages should be an array");
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].get("role").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            messages[0].get("content").and_then(Value::as_str),
            Some("draft a ticket")
        );
    }

    #[test]
    fn extracts_and_concatenates_text_blocks() {
        let response = serde_json::json!({
            "content": [
                { "type": "text", "text": "Hello " },
                { "type": "text", "text": "world" }
            ]
        });

        assert_eq!(extract_response_text(&response).unwrap(), "Hello world");
    }

    #[test]
    fn extract_response_text_ignores_non_text_blocks() {
        let response = serde_json::json!({
            "content": [
                { "type": "thinking", "thinking": "hmm" },
                { "type": "text", "text": "kept" }
            ]
        });

        assert_eq!(extract_response_text(&response).unwrap(), "kept");
    }

    #[test]
    fn extract_response_text_errors_on_empty_content() {
        let response = serde_json::json!({ "content": [] });
        assert!(extract_response_text(&response).is_err());
    }

    #[test]
    fn extract_response_text_errors_on_missing_content() {
        let response = serde_json::json!({});
        assert!(extract_response_text(&response).is_err());
    }
}
