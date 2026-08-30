use super::prompt::{
    build_task_display_title_metadata_job, build_task_display_title_prompt,
    parse_task_display_title_output, task_display_title_candidate, MetadataJobKind,
    MetadataJobSnapshot, MAX_ACTIVITY_SNAPSHOT_BYTES, MAX_TRANSCRIPT_SNAPSHOT_BYTES,
    TASK_DISPLAY_TITLE_JSON_SCHEMA,
};
use super::providers::{
    build_claude_metadata_job_args, build_codex_title_headless_args,
    build_opencode_metadata_job_args, build_pi_metadata_job_args, resolve_metadata_program,
};
use super::refresh::{
    queue_task_display_title_refresh, refresh_queued_task_display_title_with_ai_once_after,
    refresh_task_display_title_once, refresh_task_display_title_once_with_provider,
};
use crate::db::test_helpers::*;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
fn task_metadata_refresh_diagnostic_formatter_redacts_sensitive_values() {
    let path = "/Users/koen/private/openforge/transcripts/task-123.jsonl";
    let prompt = "Rotate GitHub token ghp_promptsecret";
    let transcript = "Transcript mentions /tmp/private/repo and github_pat_transcriptsecret";
    let stdout = "provider stdout leaked title Actual Generated Title";
    let stderr = "provider stderr leaked Authorization=Bearer stderr-secret";
    let generated_title = "Actual Generated Title";
    let repo = "acme/private";
    let github_body = "body includes https://api.github.com/repos/acme/private/issues";

    let line = super::format_task_metadata_refresh_diagnostic(format_args!(
        "[task_metadata_refresh] unsafe diagnostic path={} prompt=\"{}\" transcript=\"{}\" stdout=\"{}\" stderr=\"{}\" generated_title=\"{}\" repo={} body=\"{}\" token=ghp_secretvalue",
        path, prompt, transcript, stdout, stderr, generated_title, repo, github_body
    ));

    assert!(line.contains("[task_metadata_refresh] unsafe diagnostic"));
    assert!(line.contains("path=<redacted>"));
    assert!(line.contains("prompt=<redacted>"));
    assert!(line.contains("transcript=<redacted>"));
    assert!(line.contains("stdout=<redacted>"));
    assert!(line.contains("stderr=<redacted>"));
    assert!(line.contains("generated_title=<redacted>"));
    assert!(line.contains("repo=<redacted>"));
    assert!(line.contains("body=<redacted>"));
    assert!(line.contains("token=<redacted>"));
    for sensitive in [
        path,
        prompt,
        transcript,
        stdout,
        stderr,
        generated_title,
        repo,
        github_body,
        "ghp_secretvalue",
        "github_pat_transcriptsecret",
        "Bearer stderr-secret",
        "https://api.github.com",
    ] {
        assert!(
            !line.contains(sensitive),
            "diagnostic leaked {sensitive:?}: {line}"
        );
    }
}

#[test]
fn task_metadata_refresh_debug_diagnostics_use_sidecar_logger_level_filter() {
    assert_eq!(
        crate::sidecar_logger::level_filter_from_env_value(None),
        log::LevelFilter::Info
    );
    assert_eq!(
        crate::sidecar_logger::level_filter_from_env_value(Some("")),
        log::LevelFilter::Info
    );
    assert_eq!(
        crate::sidecar_logger::level_filter_from_env_value(Some("info")),
        log::LevelFilter::Info
    );
    assert_eq!(
        crate::sidecar_logger::level_filter_from_env_value(Some("debug")),
        log::LevelFilter::Debug
    );
    assert_eq!(
        crate::sidecar_logger::level_filter_from_env_value(Some("trace")),
        log::LevelFilter::Trace
    );
}

#[test]
fn task_display_title_candidate_uses_short_first_prompt_line() {
    let (db, _temp_dir) = make_test_db("metadata_title_candidate");
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
}

#[test]
fn refresh_task_display_title_once_sets_generated_title() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_generated_title");
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
}

#[test]
fn build_task_display_title_prompt_uses_snapshot_activity() {
    let (db, _temp_dir) = make_test_db("metadata_title_prompt_snapshot");
    let task = db
        .create_task("Initial vague request", "doing", None, None, None)
        .expect("create task");
    let snapshot = MetadataJobSnapshot {
        transcript_path: None,
        transcript_excerpt: Some("Actual topic: repair OAuth token refresh race".to_string()),
        activity_excerpt: Some("Tool activity: edited auth middleware".to_string()),
    };

    let prompt = build_task_display_title_prompt(&task, Some(&snapshot));

    assert!(prompt.contains("repair OAuth token refresh race"));
    assert!(prompt.contains("edited auth middleware"));
    assert!(prompt.contains("Return only JSON"));
}

#[test]
fn build_task_display_title_prompt_excludes_start_prompt_contribution_envelopes() {
    let (db, _temp_dir) = make_test_db("metadata_title_prompt_contributions");
    let task = db
        .create_task(
            "Implement title sanitization\n\n<openforge_start_prompt_contribution id=\"task-guidance\">\ntask guidance must not influence title\n</openforge_start_prompt_contribution>\n\nKeep task details",
            "doing",
            None,
            None,
            None,
        )
        .expect("create task");
    let snapshot = MetadataJobSnapshot {
        transcript_path: None,
        transcript_excerpt: Some(
            "Transcript details\n<openforge_start_prompt_contribution id=\"transcript-guidance\">\ntranscript guidance must not influence title\n</openforge_start_prompt_contribution>\nTranscript result"
                .to_string(),
        ),
        activity_excerpt: Some(
            "Activity details\n<openforge_start_prompt_contribution id=\"activity-guidance\">\nactivity guidance must not influence title\n</openforge_start_prompt_contribution>\nActivity result"
                .to_string(),
        ),
    };

    let prompt = build_task_display_title_prompt(&task, Some(&snapshot));

    assert!(prompt.contains("Implement title sanitization"));
    assert!(prompt.contains("Keep task details"));
    assert!(prompt.contains("Transcript details"));
    assert!(prompt.contains("Transcript result"));
    assert!(prompt.contains("Activity details"));
    assert!(prompt.contains("Activity result"));
    assert!(!prompt.contains("openforge_start_prompt_contribution"));
    assert!(!prompt.contains("guidance must not influence title"));
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
fn provider_metadata_job_args_are_session_isolated_and_reusable() {
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

    let opencode_job = build_task_display_title_metadata_job(
        "task-provider-adapter",
        "opencode",
        None,
        Some("message.updated snapshot".to_string()),
    );
    let opencode_args = build_opencode_metadata_job_args(&opencode_job, "Name this work");
    assert_eq!(
        opencode_args,
        vec!["run".to_string(), "Name this work".to_string()]
    );
    assert_eq!(opencode_job.kind, MetadataJobKind::TaskDisplayTitle);

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
fn codex_metadata_job_places_global_approval_policy_before_exec() {
    let codex_args = build_codex_title_headless_args(
        Path::new("/tmp/title.schema.json"),
        Path::new("/tmp/title.output.json"),
        "Name this work",
    );

    assert_eq!(&codex_args[..3], &["--ask-for-approval", "never", "exec"]);
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
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title");
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
}

#[tokio::test]
async fn queued_task_display_title_refresh_recovers_from_poisoned_database_lock() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title_poisoned_database_lock");
    let task = db
        .create_task("Vague OpenCode activity", "doing", None, None, None)
        .expect("create task");
    let db = Arc::new(Mutex::new(db));

    let database = Arc::clone(&db);
    let poison_result = std::thread::spawn(move || {
        let _database = database.lock().expect("lock healthy test database");
        panic!("poison test database lock");
    })
    .join();
    assert!(poison_result.is_err());

    let queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(r#"{"type":"message.updated","message":"Recover queued title refresh"}"#.to_string()),
    );
    let refreshed = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        queued,
        Duration::ZERO,
        |_job, _prompt| async { Ok(Some("Recovered Title Refresh".to_string())) },
    )
    .await
    .expect("refresh title through poisoned database lock");

    assert!(refreshed);
    let updated = crate::db::acquire_db(&db)
        .get_task(&task.id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(updated.title.as_deref(), Some("Recovered Title Refresh"));
    assert_eq!(updated.title_source.as_deref(), Some("generated"));
}

#[tokio::test]
async fn queued_task_display_title_refresh_coalesces_after_pending_lock_is_poisoned() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title_poisoned_pending_lock");
    let task = db
        .create_task("Vague OpenCode activity", "doing", None, None, None)
        .expect("create task");
    let db = Arc::new(Mutex::new(db));

    super::refresh::poison_pending_task_display_title_refreshes_for_test();

    let first_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(r#"{"type":"session.status","status":"running"}"#.to_string()),
    );
    let second_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(r#"{"type":"message.updated","message":"Recover poisoned queue state"}"#.to_string()),
    );

    let first_result = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        first_queued,
        Duration::ZERO,
        |_job, _prompt| async { panic!("superseded refresh must not call provider") },
    )
    .await
    .expect("first refresh result");
    assert!(!first_result);

    let second_result = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        second_queued,
        Duration::ZERO,
        |_job, prompt| async move {
            assert!(prompt.contains("message.updated"));
            assert!(prompt.contains("Recover poisoned queue state"));
            assert!(!prompt.contains("session.status"));
            Ok(Some("Recovered Queue Coalescing".to_string()))
        },
    )
    .await
    .expect("second refresh result");

    assert!(second_result);
    let updated = crate::db::acquire_db(&db)
        .get_task(&task.id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(updated.title.as_deref(), Some("Recovered Queue Coalescing"));
}

#[tokio::test]
async fn refresh_task_display_title_with_ai_once_coalesces_same_task_to_latest_snapshot() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title_debounce");
    let task = db
        .create_task("Vague OpenCode activity", "doing", None, None, None)
        .expect("create task");
    let db = Arc::new(Mutex::new(db));
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let first_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(r#"{"type":"session.status","status":"running"}"#.to_string()),
    );
    let second_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(
            r#"{"type":"message.updated","message":"Implement debounced task display title refresh"}"#
                .to_string(),
        ),
    );

    let first_refresh = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        first_queued,
        Duration::from_millis(1),
        {
            let prompts = Arc::clone(&prompts);
            move |_job, prompt| {
                let prompts = Arc::clone(&prompts);
                async move {
                    prompts.lock().unwrap().push(prompt);
                    Ok(Some("Low Status Title".to_string()))
                }
            }
        },
    );
    let second_refresh = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        second_queued,
        Duration::from_millis(1),
        {
            let prompts = Arc::clone(&prompts);
            move |_job, prompt| {
                let prompts = Arc::clone(&prompts);
                async move {
                    prompts.lock().unwrap().push(prompt);
                    Ok(Some("Debounced Title Refresh".to_string()))
                }
            }
        },
    );

    let (second_result, first_result) = tokio::join!(second_refresh, first_refresh);

    assert!(!first_result.expect("first refresh result"));
    assert!(second_result.expect("second refresh result"));
    let prompts = prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains("message.updated"));
    assert!(prompts[0].contains("Implement debounced task display title refresh"));
    assert!(!prompts[0].contains("session.status"));
    drop(prompts);

    let updated = db
        .lock()
        .unwrap()
        .get_task(&task.id)
        .expect("get task")
        .unwrap();
    assert_eq!(updated.title.as_deref(), Some("Debounced Title Refresh"));
    assert_eq!(updated.title_source.as_deref(), Some("generated"));
}

#[tokio::test]
async fn refresh_task_display_title_serializes_in_flight_work_for_one_task() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title_serialized");
    let task = db
        .create_task("Vague title", "doing", None, None, None)
        .expect("create task");
    let db = Arc::new(Mutex::new(db));
    let first_started = Arc::new(tokio::sync::Notify::new());
    let release_first = Arc::new(tokio::sync::Notify::new());
    let second_started = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let first_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some("first snapshot".to_string()),
    );
    let first_refresh = tokio::spawn(refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        first_queued,
        Duration::ZERO,
        {
            let first_started = Arc::clone(&first_started);
            let release_first = Arc::clone(&release_first);
            move |_job, _prompt| async move {
                first_started.notify_one();
                release_first.notified().await;
                Ok(Some("Superseded Title".to_string()))
            }
        },
    ));
    first_started.notified().await;

    let second_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some("second snapshot".to_string()),
    );
    let second_refresh = tokio::spawn(refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        second_queued,
        Duration::ZERO,
        {
            let second_started = Arc::clone(&second_started);
            move |_job, _prompt| async move {
                second_started.store(true, std::sync::atomic::Ordering::Release);
                Ok(Some("Serialized Title".to_string()))
            }
        },
    ));

    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !second_started.load(std::sync::atomic::Ordering::Acquire),
        "newer metadata work must wait for the in-flight provider"
    );
    release_first.notify_one();

    assert!(!first_refresh
        .await
        .expect("first task")
        .expect("first refresh"));
    assert!(second_refresh
        .await
        .expect("second task")
        .expect("second refresh"));
}

#[tokio::test]
async fn refresh_task_display_title_with_ai_once_skips_in_flight_title_when_newer_snapshot_arrives()
{
    let (db, _temp_dir) = make_test_db("metadata_refresh_ai_title_in_flight_superseded");
    let task = db
        .create_task("Vague OpenCode activity", "doing", None, None, None)
        .expect("create task");
    let db = Arc::new(Mutex::new(db));
    let newer_queued = Arc::new(Mutex::new(None));
    let first_queued = queue_task_display_title_refresh(
        task.id.clone(),
        "opencode".to_string(),
        None,
        Some(r#"{"type":"session.status","status":"running"}"#.to_string()),
    );

    let first_result = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        first_queued,
        Duration::from_millis(1),
        {
            let task_id = task.id.clone();
            let newer_queued = Arc::clone(&newer_queued);
            move |_job, _prompt| async move {
                let queued = queue_task_display_title_refresh(
                    task_id,
                    "opencode".to_string(),
                    None,
                    Some(
                        r#"{"type":"message.updated","message":"Richer update while provider is running"}"#
                            .to_string(),
                    ),
                );
                *newer_queued.lock().unwrap() = Some(queued);
                Ok(Some("Low Status Title".to_string()))
            }
        },
    )
    .await
    .expect("first refresh result");

    assert!(!first_result);
    assert_eq!(
        db.lock()
            .unwrap()
            .get_task(&task.id)
            .expect("get task")
            .unwrap()
            .title,
        None
    );

    let second_queued = newer_queued
        .lock()
        .unwrap()
        .take()
        .expect("newer queued refresh");
    let second_result = refresh_queued_task_display_title_with_ai_once_after(
        Arc::clone(&db),
        second_queued,
        Duration::from_millis(1),
        |_job, prompt| async move {
            assert!(prompt.contains("message.updated"));
            assert!(prompt.contains("Richer update while provider is running"));
            Ok(Some("Richer Running Update".to_string()))
        },
    )
    .await
    .expect("second refresh result");

    assert!(second_result);
    let updated = db
        .lock()
        .unwrap()
        .get_task(&task.id)
        .expect("get task")
        .unwrap();
    assert_eq!(updated.title.as_deref(), Some("Richer Running Update"));
    assert_eq!(updated.title_source.as_deref(), Some("generated"));
}

#[test]
fn refresh_task_display_title_once_skips_manual_title() {
    let (db, _temp_dir) = make_test_db("metadata_refresh_manual_title");
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
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create task");

    assert!(!refresh_task_display_title_once(&db, &task.id).expect("refresh title"));
    let updated = db.get_task(&task.id).expect("get task").unwrap();
    assert_eq!(updated.title.as_deref(), Some("Manual title"));
    assert_eq!(updated.title_source.as_deref(), Some("manual"));
}
