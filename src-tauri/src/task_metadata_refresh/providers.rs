use super::prompt::{parse_task_display_title_output, MetadataJob, MetadataJobKind};
use std::path::Path;
use std::time::Duration;

const TITLE_PROVIDER_TIMEOUT_SECONDS: u64 = 60;

pub(super) fn build_claude_metadata_job_args(prompt: &str, output_schema: &str) -> Vec<String> {
    vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--json-schema".to_string(),
        output_schema.to_string(),
        "--no-session-persistence".to_string(),
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        prompt.to_string(),
    ]
}

pub(super) fn build_opencode_title_headless_args(prompt: &str) -> Vec<String> {
    vec!["run".to_string(), prompt.to_string()]
}

pub(super) fn build_pi_metadata_job_args(prompt: &str) -> Vec<String> {
    vec![
        "--no-session".to_string(),
        "--no-tools".to_string(),
        "--no-extensions".to_string(),
        "--no-skills".to_string(),
        "--no-prompt-templates".to_string(),
        "--no-context-files".to_string(),
        "-p".to_string(),
        prompt.to_string(),
    ]
}
pub(super) fn build_codex_title_headless_args(
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

async fn run_codex_metadata_job(job: &MetadataJob, prompt: &str) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join(format!(
        "openforge-metadata-{}-{}",
        job.kind.as_str(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("failed to create metadata job temp dir: {error}"))?;
    let schema_path = temp_dir.join("output.schema.json");
    let output_path = temp_dir.join("output.json");
    if let Err(error) = std::fs::write(&schema_path, &job.output_schema) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!("failed to write metadata job schema: {error}"));
    }

    let args = build_codex_title_headless_args(&schema_path, &output_path, prompt);
    let result = run_headless_metadata_command(job, "codex", &args, Some(&output_path)).await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

async fn run_metadata_job(job: &MetadataJob, prompt: &str) -> Result<String, String> {
    match job.provider.as_str() {
        "codex" => run_codex_metadata_job(job, prompt).await,
        "claude-code" => {
            let args = build_claude_metadata_job_args(prompt, &job.output_schema);
            run_headless_metadata_command(job, "claude", &args, None).await
        }
        "opencode" => {
            let args = build_opencode_title_headless_args(prompt);
            run_headless_metadata_command(job, "opencode", &args, None).await
        }
        "pi" => {
            let args = build_pi_metadata_job_args(prompt);
            run_headless_metadata_command(job, "pi", &args, None).await
        }
        other => Err(format!(
            "metadata job '{}' is not supported for provider '{other}'",
            job.kind.as_str()
        )),
    }
}

pub(super) fn task_display_title_metadata_error_kind(error: &str) -> &'static str {
    if error.contains("timed out") {
        "timeout"
    } else if error.contains("failed to launch") {
        "launch"
    } else if error.contains("metadata generation failed") {
        "exit_status"
    } else if error.contains("task display title generation failed") {
        "provider_error"
    } else if error.contains("failed to parse task display title JSON")
        || error.contains("nested too deeply")
    {
        "parse"
    } else if error.contains("not supported for provider") {
        "unsupported_provider"
    } else {
        "unknown"
    }
}

pub(super) async fn run_task_display_title_metadata_job(
    job: &MetadataJob,
    prompt: &str,
) -> Result<Option<String>, String> {
    if job.kind != MetadataJobKind::TaskDisplayTitle {
        return Err(format!(
            "metadata job '{}' cannot produce a task display title",
            job.kind.as_str()
        ));
    }
    let raw = run_metadata_job(job, prompt).await?;
    let raw_bytes = raw.len();
    match parse_task_display_title_output(&raw) {
        Ok(Some(title)) => {
            info!(
                "[task_metadata_refresh] provider returned task display title task_id={} provider={} raw_bytes={} title_chars={}",
                job.task_id,
                job.provider,
                raw_bytes,
                title.chars().count()
            );
            Ok(Some(title))
        }
        Ok(None) => {
            info!(
                "[task_metadata_refresh] provider returned no task display title task_id={} provider={} raw_bytes={}",
                job.task_id, job.provider, raw_bytes
            );
            Ok(None)
        }
        Err(error) => {
            let error_kind = task_display_title_metadata_error_kind(&error);
            warn!(
                "[task_metadata_refresh] failed to parse task display title metadata task_id={} provider={} raw_bytes={} error_kind={}; suppressing parser detail to avoid leaking provider content",
                job.task_id, job.provider, raw_bytes, error_kind
            );
            Err(error)
        }
    }
}

async fn run_headless_metadata_command(
    job: &MetadataJob,
    program: &str,
    args: &[String],
    output_file: Option<&Path>,
) -> Result<String, String> {
    info!(
        "[task_metadata_refresh] launching metadata command task_id={} provider={} kind={} program={} args_count={} has_output_file={} timeout_seconds={}",
        job.task_id,
        job.provider,
        job.kind.as_str(),
        program,
        args.len(),
        output_file.is_some(),
        TITLE_PROVIDER_TIMEOUT_SECONDS
    );
    let mut command = tokio::process::Command::new(program);
    command.args(args);
    command.env("NO_COLOR", "1");
    command.env("OPENFORGE_METADATA_JOB_KIND", job.kind.as_str());
    command.env("OPENFORGE_METADATA_PROVIDER", &job.provider);
    command.env("OPENFORGE_METADATA_TASK_ID", &job.task_id);
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
    .map_err(|_| {
        warn!(
            "[task_metadata_refresh] metadata command timed out task_id={} provider={} kind={} program={} failure_kind=timeout timeout_seconds={}",
            job.task_id,
            job.provider,
            job.kind.as_str(),
            program,
            TITLE_PROVIDER_TIMEOUT_SECONDS
        );
        format!(
            "{program} {} metadata generation timed out",
            job.kind.as_str()
        )
    })?
    .map_err(|error| {
        warn!(
            "[task_metadata_refresh] failed to launch metadata command task_id={} provider={} kind={} program={} failure_kind=launch: {error}",
            job.task_id,
            job.provider,
            job.kind.as_str(),
            program
        );
        format!(
            "failed to launch {program} for {} metadata generation: {error}",
            job.kind.as_str()
        )
    })?;

    let stderr_bytes = output.stderr.len();
    let stdout_bytes = output.stdout.len();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        warn!(
            "[task_metadata_refresh] metadata command failed task_id={} provider={} kind={} program={} failure_kind=exit_status status={} stdout_bytes={} stderr_bytes={}",
            job.task_id,
            job.provider,
            job.kind.as_str(),
            program,
            output.status,
            stdout_bytes,
            stderr_bytes
        );
        return Err(format!(
            "{program} {} metadata generation failed: {detail}",
            job.kind.as_str()
        ));
    }

    info!(
        "[task_metadata_refresh] metadata command completed task_id={} provider={} kind={} program={} status={} stdout_bytes={} stderr_bytes={}",
        job.task_id,
        job.provider,
        job.kind.as_str(),
        program,
        output.status,
        stdout_bytes,
        stderr_bytes
    );

    if let Some(path) = output_file {
        match std::fs::read_to_string(path) {
            Ok(content) if !content.trim().is_empty() => {
                info!(
                    "[task_metadata_refresh] metadata command output selected task_id={} provider={} source=output_file bytes={}",
                    job.task_id,
                    job.provider,
                    content.len()
                );
                return Ok(content);
            }
            Ok(_) => {
                info!(
                    "[task_metadata_refresh] metadata output file was empty task_id={} provider={}; falling back to stdout",
                    job.task_id, job.provider
                );
            }
            Err(error) => {
                info!(
                    "[task_metadata_refresh] failed to read metadata output file task_id={} provider={}: {error}; falling back to stdout",
                    job.task_id, job.provider
                );
            }
        }
    }
    info!(
        "[task_metadata_refresh] metadata command output selected task_id={} provider={} source=stdout bytes={}",
        job.task_id, job.provider, stdout_bytes
    );
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
