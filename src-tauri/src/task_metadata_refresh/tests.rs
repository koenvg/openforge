use super::prompt::{
    build_task_display_title_metadata_job, build_task_display_title_prompt,
    parse_task_display_title_output, task_display_title_candidate, MetadataJobKind,
    MetadataJobSnapshot, MAX_ACTIVITY_SNAPSHOT_BYTES, MAX_TRANSCRIPT_SNAPSHOT_BYTES,
    TASK_DISPLAY_TITLE_JSON_SCHEMA,
};
use super::providers::{
    build_claude_metadata_job_args, build_codex_title_headless_args,
    build_opencode_title_headless_args, build_pi_metadata_job_args, resolve_metadata_program,
};
use super::refresh::{
    refresh_task_display_title_once, refresh_task_display_title_once_with_provider,
};
use crate::db::test_helpers::*;
use std::collections::HashMap;
use std::path::Path;

#[test]
fn task_metadata_refresh_diagnostic_formatter_keeps_safe_metadata_only_message() {
    let generated_title = "Actual Generated Title";
    let prompt = "Fix user-visible auth prompt";
    let raw_provider_output = r#"{"title":"Actual Generated Title"}"#;
    let stdout = "provider stdout with raw content";
    let stderr = "provider stderr with raw content";

    let line = super::format_task_metadata_refresh_diagnostic(format_args!(
        "[task_metadata_refresh] metadata command completed task_id={} provider={} kind={} program={} status={} stdout_bytes={} stderr_bytes={}",
        "T-123",
        "codex",
        "task_display_title",
        "codex",
        "exit status: 0",
        stdout.len(),
        stderr.len()
    ));

    assert!(line.contains("task_id=T-123"));
    assert!(line.contains("provider=codex"));
    assert!(line.contains("stdout_bytes="));
    assert!(line.contains("stderr_bytes="));
    assert!(!line.contains(generated_title));
    assert!(!line.contains(prompt));
    assert!(!line.contains(raw_provider_output));
    assert!(!line.contains(stdout));
    assert!(!line.contains(stderr));
}

#[test]
fn task_metadata_refresh_debug_diagnostics_require_explicit_opt_in() {
    assert!(!super::task_metadata_refresh_debug_enabled_from_env(None));
    assert!(!super::task_metadata_refresh_debug_enabled_from_env(Some(
        ""
    )));
    assert!(!super::task_metadata_refresh_debug_enabled_from_env(Some(
        "info"
    )));
    assert!(super::task_metadata_refresh_debug_enabled_from_env(Some(
        "1"
    )));
    assert!(super::task_metadata_refresh_debug_enabled_from_env(Some(
        "true"
    )));
    assert!(super::task_metadata_refresh_debug_enabled_from_env(Some(
        "debug"
    )));
    assert!(super::task_metadata_refresh_debug_enabled_from_env(Some(
        "trace"
    )));
}

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
    let snapshot = MetadataJobSnapshot {
            transcript_path: None,
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
        parse_task_display_title_output(r#"{"result":"{\"title\":\"Provider Snapshot Title\"}"}"#)
            .expect("parse nested title")
            .as_deref(),
        Some("Provider Snapshot Title")
    );
}

#[test]
fn provider_title_headless_args_are_session_isolated() {
    let claude_args =
        build_claude_metadata_job_args("Name this work", TASK_DISPLAY_TITLE_JSON_SCHEMA);
    assert!(claude_args.contains(&"--no-session-persistence".to_string()));
    assert!(claude_args.contains(&"--permission-mode".to_string()));
    assert!(claude_args.contains(&"dontAsk".to_string()));

    let schema_path = Path::new("/tmp/title.schema.json");
    let output_path = Path::new("/tmp/title.output.json");
    let codex_args = build_codex_title_headless_args(schema_path, output_path, "Name this work");
    assert!(codex_args.contains(&"--ephemeral".to_string()));
    assert!(codex_args.contains(&"--ignore-rules".to_string()));

    let opencode_args = build_opencode_title_headless_args("Name this work");
    assert_eq!(
        opencode_args,
        vec!["run".to_string(), "Name this work".to_string()]
    );

    let pi_args = build_pi_metadata_job_args("Name this work");
    assert_eq!(
        pi_args,
        vec![
            "--no-session".to_string(),
            "--no-tools".to_string(),
            "--no-extensions".to_string(),
            "--no-skills".to_string(),
            "--no-prompt-templates".to_string(),
            "--no-context-files".to_string(),
            "-p".to_string(),
            "Name this work".to_string(),
        ]
    );
}

#[test]
fn pi_metadata_job_resolves_installed_pi_executable_for_sidecar_launch() {
    let dir = tempfile::tempdir().expect("temp dir");
    let pi_path = dir.path().join("pi");
    std::fs::write(&pi_path, "#!/bin/sh\nexit 0\n").expect("write fake pi");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&pi_path)
            .expect("fake pi metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&pi_path, permissions).expect("make fake pi executable");
    }

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), dir.path().to_string_lossy().to_string());

    assert_eq!(
        resolve_metadata_program("pi", &env),
        pi_path.to_string_lossy().to_string()
    );
    assert_eq!(
        resolve_metadata_program("missing-openforge-tool", &env),
        "missing-openforge-tool"
    );
}

#[test]
fn task_display_title_metadata_job_contract_is_provider_agnostic_and_bounded() {
    let transcript_path = std::env::temp_dir().join(format!(
        "openforge-metadata-job-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    let transcript = format!(
        "{}Transcript tail: fixed indexed PTY routing",
        "x".repeat(MAX_TRANSCRIPT_SNAPSHOT_BYTES as usize + 128)
    );
    std::fs::write(&transcript_path, transcript).expect("write transcript");
    let activity = format!(
        "{}Activity tail: shell tab metadata updated",
        "y".repeat(MAX_ACTIVITY_SNAPSHOT_BYTES + 128)
    );

    let job = build_task_display_title_metadata_job(
        "task-123",
        "pi",
        Some(transcript_path.clone()),
        Some(activity),
    );

    assert_eq!(job.task_id, "task-123");
    assert_eq!(job.provider, "pi");
    assert_eq!(job.kind, MetadataJobKind::TaskDisplayTitle);
    assert_eq!(job.kind.as_str(), "task_display_title");
    assert_eq!(job.output_schema, TASK_DISPLAY_TITLE_JSON_SCHEMA);

    let snapshot = job.snapshot.as_ref().expect("bounded snapshot");
    assert_eq!(
        snapshot.transcript_path.as_deref(),
        Some(transcript_path.as_path())
    );
    let transcript_excerpt = snapshot
        .transcript_excerpt
        .as_deref()
        .expect("transcript excerpt");
    assert!(transcript_excerpt.len() <= MAX_TRANSCRIPT_SNAPSHOT_BYTES as usize);
    assert!(transcript_excerpt.contains("Transcript tail: fixed indexed PTY routing"));
    let activity_excerpt = snapshot
        .activity_excerpt
        .as_deref()
        .expect("activity excerpt");
    assert!(activity_excerpt.len() <= MAX_ACTIVITY_SNAPSHOT_BYTES);
    assert!(activity_excerpt.contains("Activity tail: shell tab metadata updated"));

    let _ = std::fs::remove_file(&transcript_path);
}

#[test]
fn refresh_task_display_title_once_uses_ai_title_when_provider_succeeds() {
    let (db, path) = make_test_db("metadata_refresh_ai_title");
    let task = db
        .create_task("Vague initial prompt", "doing", None, None, None)
        .expect("create task");

    let snapshot = MetadataJobSnapshot {
        transcript_path: None,
        transcript_excerpt: Some("Actual topic: repair SQLite lock contention".to_string()),
        activity_excerpt: Some("Edited database retry code after failing test".to_string()),
    };

    assert!(
        refresh_task_display_title_once_with_provider(&db, &task.id, Some(&snapshot), |_| Ok(
            Some("SQLite Lock Fix".to_string())
        ),)
        .expect("refresh title")
    );
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
