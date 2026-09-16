use super::*;

async fn run_shell(
    script: &str,
    timeout_secs: u64,
    abort_rx: oneshot::Receiver<()>,
) -> ChildExecution {
    let args = ["-c".to_string(), script.to_string()];
    let env = HashMap::new();
    run_child(
        AgentProcess {
            binary: Path::new("/bin/sh"),
            args: &args,
            env: &env,
            prompt: "",
            working_directory: None,
            agent_config_path: None,
            timeout_secs,
        },
        abort_rx,
    )
    .await
}

#[test]
fn parses_result_envelope_model_text() {
    let envelope = r#"{"type":"result","subtype":"success","is_error":false,"result":"{\"steps\":[{\"id\":\"step-1\",\"title\":\"Hello\"}]}","structured_output":{"steps":[{"id":"step-1","title":"Hello"}]}}"#;
    assert_eq!(
        parse_json_result_envelope(envelope),
        Some(ResultEnvelope::Success(
            r#"{"steps":[{"id":"step-1","title":"Hello"}]}"#.to_string()
        )),
    );
}

#[test]
fn rejects_non_envelope_output() {
    assert_eq!(parse_json_result_envelope(r#"{"steps":[]}"#), None);
    assert_eq!(parse_json_result_envelope("plain text"), None);
}

#[test]
fn identifies_error_envelopes() {
    let envelope =
        r#"{"type":"result","subtype":"error","is_error":true,"result":"rate limit exceeded"}"#;
    assert_eq!(
        parse_json_result_envelope(envelope),
        Some(ResultEnvelope::Error("rate limit exceeded".to_string()))
    );
}

#[tokio::test]
async fn structured_error_envelope_surfaces_reason_even_when_process_exits_nonzero() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell(
        "printf '%s' '{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"rate limit exceeded\"}'; exit 1",
        10,
        abort_rx,
    )
    .await;

    let outcome = classify_generation(execution, GenerationOutputMode::Structured);

    assert_eq!(
        outcome.into_result(),
        Err("agent generation reported an error: rate limit exceeded".to_string())
    );
}

#[tokio::test]
async fn structured_error_envelope_surfaces_reason_when_process_exits_successfully() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell(
        "printf '%s' '{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"authentication failed\"}'",
        10,
        abort_rx,
    )
    .await;

    let outcome = classify_generation(execution, GenerationOutputMode::Structured);

    assert_eq!(
        outcome.into_result(),
        Err("agent generation reported an error: authentication failed".to_string())
    );
}

#[tokio::test]
async fn structured_nonzero_exit_without_envelope_reports_status_and_error_output() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell(
        "printf '%s' 'not an envelope'; printf '%s' 'permission denied' >&2; exit 3",
        10,
        abort_rx,
    )
    .await;

    let outcome = classify_generation(execution, GenerationOutputMode::Structured);

    assert_eq!(
        outcome.into_result(),
        Err("agent process exited with status exit status: 3: permission denied".to_string())
    );
}

#[tokio::test]
async fn text_generation_returns_raw_output_without_envelope_parsing() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let envelope_shaped_text =
        r#"{"type":"result","is_error":true,"result":"model-authored text"}"#;
    let execution = run_shell(
        &format!("printf '%s' '{envelope_shaped_text}'"),
        10,
        abort_rx,
    )
    .await;

    let outcome = classify_generation(execution, GenerationOutputMode::Text);

    assert_eq!(outcome.into_result(), Ok(envelope_shaped_text.to_string()));
}

#[tokio::test]
async fn text_generation_nonzero_exit_reports_status_and_error_output() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell(
        "printf '%s' 'blocked tool prompt' >&2; exit 4",
        10,
        abort_rx,
    )
    .await;

    let outcome = classify_generation(execution, GenerationOutputMode::Text);

    assert_eq!(
        outcome.into_result(),
        Err("agent process exited with status exit status: 4: blocked tool prompt".to_string())
    );
}

#[tokio::test]
async fn text_generation_nonzero_exit_without_error_output_reports_clean_status() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell("exit 5", 10, abort_rx).await;

    let outcome = classify_generation(execution, GenerationOutputMode::Text);

    assert_eq!(
        outcome.into_result(),
        Err("agent process exited with status exit status: 5".to_string())
    );
}

#[tokio::test]
async fn structured_success_without_result_envelope_reports_unusable_output() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell("printf '%s' 'plain text'", 10, abort_rx).await;

    let outcome = classify_generation(execution, GenerationOutputMode::Structured);

    assert_eq!(
        outcome.into_result(),
        Err("agent generation returned unusable structured output".to_string())
    );
}

#[tokio::test]
async fn generation_timeout_reports_its_deadline() {
    let (_abort_tx, abort_rx) = oneshot::channel();
    let execution = run_shell("sleep 10", 0, abort_rx).await;

    let outcome = classify_generation(execution, GenerationOutputMode::Text);

    assert_eq!(
        outcome.into_result(),
        Err("agent generation timed out after 0s".to_string())
    );
}

#[tokio::test]
async fn aborted_generation_reports_abort_instead_of_timeout() {
    let (abort_tx, abort_rx) = oneshot::channel();
    abort_tx.send(()).expect("abort receiver must be active");
    let execution = run_shell("sleep 10", 10, abort_rx).await;

    let outcome = classify_generation(execution, GenerationOutputMode::Text);

    assert_eq!(
        outcome.into_result(),
        Err("agent generation was aborted".to_string())
    );
}

#[test]
fn generation_diagnostic_classifies_every_terminal_outcome() {
    let cases = [
        (
            GenerationOutcome::Success("private result".to_string()),
            "success",
        ),
        (
            GenerationOutcome::ProviderError("private provider reason".to_string()),
            "provider_error",
        ),
        (
            GenerationOutcome::TimedOut { timeout_secs: 240 },
            "timed_out",
        ),
        (GenerationOutcome::Aborted, "aborted"),
        (GenerationOutcome::UnusableOutput, "unusable_output"),
        (
            GenerationOutcome::ProcessFailure("private process reason".to_string()),
            "process_failure",
        ),
    ];

    for (outcome, expected_label) in cases {
        let diagnostic = generation_outcome_diagnostic(
            "claude-code",
            GenerationOutputMode::Structured,
            &outcome,
        );
        assert!(
            diagnostic.contains(&format!("generation_outcome={expected_label}")),
            "unexpected diagnostic: {diagnostic}"
        );
    }
}

#[test]
fn generation_diagnostic_fields_survive_log_redaction_without_private_content() {
    let outcome = GenerationOutcome::ProviderError(
        "secret prompt and provider response must not be logged".to_string(),
    );
    let diagnostic =
        generation_outcome_diagnostic("claude-code", GenerationOutputMode::Structured, &outcome);

    let line = crate::sidecar_logger::format_log_line(
        log::Level::Info,
        "openforge::app_invoke::agent_generate",
        &diagnostic,
    );

    assert!(line.contains("provider=claude-code"));
    assert!(line.contains("output_mode=structured"));
    assert!(line.contains("generation_outcome=provider_error"));
    assert!(!line.contains("secret prompt"));
    assert!(!line.contains("provider response"));
    assert!(!line.contains("<redacted>"));
}

#[test]
fn generation_setup_failure_is_classified_as_a_process_failure() {
    let outcome =
        classify_generation_attempt(Err("claude executable was not found on PATH".to_string()));

    assert_eq!(outcome.diagnostic_label(), "process_failure");
    assert_eq!(
        outcome.into_result(),
        Err("claude executable was not found on PATH".to_string())
    );
}
