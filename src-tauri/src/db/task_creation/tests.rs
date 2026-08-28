use crate::db::{test_helpers::*, TaskDependencyPersistenceError, TaskLabelPersistenceError};
use std::error::Error as _;

#[test]
fn task_creation_error_preserves_sources_and_from_conversion() {
    let storage_error = super::TaskCreationError::from(rusqlite::Error::InvalidQuery);
    assert!(matches!(
        &storage_error,
        super::TaskCreationError::Storage(rusqlite::Error::InvalidQuery)
    ));
    assert_eq!(
        storage_error.to_string(),
        rusqlite::Error::InvalidQuery.to_string()
    );
    assert!(storage_error
        .source()
        .expect("storage error must be the source")
        .downcast_ref::<rusqlite::Error>()
        .is_some());

    let dependency_error = super::TaskCreationError::Dependencies(
        TaskDependencyPersistenceError::TaskNotFound("T-404".to_string()),
    );
    assert_eq!(dependency_error.to_string(), "task T-404 does not exist");
    assert!(dependency_error
        .source()
        .expect("dependency error must be the source")
        .downcast_ref::<TaskDependencyPersistenceError>()
        .is_some());

    let label_error = super::TaskCreationError::Labels(TaskLabelPersistenceError::BlankName);
    assert_eq!(label_error.to_string(), "label name is required");
    assert!(label_error
        .source()
        .expect("label error must be the source")
        .downcast_ref::<TaskLabelPersistenceError>()
        .is_some());
}

#[test]
fn test_create_task_with_prompt() {
    let (db, _temp_dir) = make_test_db("create_task_with_prompt");
    db.set_config("task_id_prefix", "T").unwrap();

    let task = db
        .create_task("My task", "backlog", None, Some("Custom prompt"), None)
        .expect("create failed");

    assert_eq!(task.id, "T-1");
    assert_eq!(task.initial_prompt, "My task");
    assert_eq!(task.prompt, Some("Custom prompt".to_string()));

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.prompt, Some("Custom prompt".to_string()));

    drop(db);
}

#[test]
fn test_create_task_prompt_defaults_to_title() {
    let (db, _temp_dir) = make_test_db("create_task_prompt_default");
    db.set_config("task_id_prefix", "T").unwrap();

    let task = db
        .create_task("My task", "backlog", None, None, None)
        .expect("create failed");

    assert_eq!(task.id, "T-1");
    assert_eq!(task.initial_prompt, "My task");
    assert_eq!(task.prompt, Some("My task".to_string()));

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.prompt, Some("My task".to_string()));

    drop(db);
}

#[test]
fn test_create_task_with_metadata_normalizes_and_deduplicates_label_names() {
    let (db, _temp_dir) = make_test_db("create_task_with_normalized_labels");
    db.set_config("task_id_prefix", "T").unwrap();
    let project = db
        .create_project("Project", "/tmp/create-task-with-normalized-labels")
        .expect("create project");
    let existing = db
        .create_task_label(&project.id, "Bug")
        .expect("create existing label");
    let labels = [
        "  Bug  ".to_string(),
        "bug".to_string(),
        "BUG".to_string(),
        " feature ".to_string(),
    ];

    let task = db
        .create_task_with_metadata(
            super::NewTaskOptions {
                initial_prompt: "Task with labels",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            },
            &[],
            &labels,
        )
        .expect("create task with labels");

    assert_eq!(
        task.labels
            .iter()
            .map(|label| label.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Bug", "feature"]
    );
    assert_eq!(task.labels[0].id, existing.id);
    assert_eq!(
        db.get_task(&task.id).expect("get task").unwrap().labels,
        task.labels
    );
    assert_eq!(
        db.get_project_task_labels(&project.id)
            .expect("get project labels"),
        task.labels
    );

    drop(db);
}

#[test]
fn test_create_task_with_metadata_rolls_back_every_write_when_label_assignment_fails() {
    let (db, _temp_dir) = make_test_db("create_task_with_metadata_rollback");
    db.set_config("task_id_prefix", "T").unwrap();
    let project = db
        .create_project("Project", "/tmp/create-task-with-metadata-rollback")
        .expect("create project");
    let dependency = db
        .create_task("Dependency", "backlog", Some(&project.id), None, None)
        .expect("create dependency");
    {
        let conn = db.connection();
        conn.lock()
            .expect("lock connection")
            .execute_batch(
                "CREATE TRIGGER fail_blocked_task_label_assignment
                 BEFORE INSERT ON task_label_assignments
                 WHEN (SELECT name FROM task_labels WHERE id = NEW.label_id) = 'blocked'
                 BEGIN
                     SELECT RAISE(ABORT, 'forced label assignment failure');
                 END;",
            )
            .expect("create failure trigger");
    }
    let dependency_ids = [dependency.id];
    let label_names = ["cleanup".to_string(), "blocked".to_string()];
    let failed_task_id = "T-2";

    let error = db
        .create_task_with_metadata(
            super::NewTaskOptions {
                initial_prompt: "Atomic task",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                task_display_title_updates_enabled: Some(false),
                ai_provider: Some("opencode"),
            },
            &dependency_ids,
            &label_names,
        )
        .expect_err("label assignment failure must abort task creation");

    assert!(matches!(error, super::TaskCreationError::Storage(_)));
    assert!(db
        .get_task(failed_task_id)
        .expect("get rolled-back task")
        .is_none());
    for key in ["task_display_title_metadata_updates_enabled", "ai_provider"] {
        assert_eq!(
            db.get_task_config(failed_task_id, key)
                .expect("get rolled-back task config"),
            None,
            "task config snapshot {key} was not rolled back"
        );
    }
    assert!(db
        .get_project_task_labels(&project.id)
        .expect("get rolled-back labels")
        .is_empty());
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock connection");
        let (dependency_count, label_assignment_count): (i64, i64) = conn
            .query_row(
                "SELECT
                     (SELECT COUNT(*) FROM task_dependencies WHERE task_id = ?1),
                     (SELECT COUNT(*) FROM task_label_assignments WHERE task_id = ?1)",
                [failed_task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("count rolled-back task metadata");
        assert_eq!(dependency_count, 0);
        assert_eq!(label_assignment_count, 0);
    }

    let next_task = db
        .create_task("Next task", "backlog", Some(&project.id), None, None)
        .expect("create next task");
    assert_eq!(next_task.id, failed_task_id);

    drop(db);
}
#[test]
fn test_create_task_and_retrieve() {
    let (db, _temp_dir) = make_test_db("create_task");
    db.set_config("task_id_prefix", "T").unwrap();

    let task = db
        .create_task("My task", "backlog", None, None, None)
        .expect("create failed");

    assert_eq!(task.id, "T-1");
    assert_eq!(task.initial_prompt, "My task");
    assert_eq!(task.status, "backlog");

    let tasks = db.get_all_tasks().expect("get_all failed");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, "T-1");
    assert_eq!(tasks[0].initial_prompt, "My task");

    drop(db);
}

#[test]
fn test_create_task_title_defaults_to_null() {
    let (db, _temp_dir) = make_test_db("create_task_title_null");

    let task = db
        .create_task("Original", "backlog", None, None, None)
        .expect("create failed");

    assert_eq!(task.title, None);
    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.title, None);

    drop(db);
}

#[test]
fn test_create_task_with_options_persists_manual_title() {
    let (db, _temp_dir) = make_test_db("create_task_options_title");
    db.set_config("task_id_prefix", "T").unwrap();

    let task = db
        .create_task_with_options(super::NewTaskOptions {
            initial_prompt: "Do the work",
            status: "backlog",
            project_id: None,
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: Some("  Custom title  "),
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create failed");

    // Titles are trimmed and treated as manual user input.
    assert_eq!(task.title.as_deref(), Some("Custom title"));
    assert_eq!(task.title_source.as_deref(), Some("manual"));
    assert_eq!(task.title_generated_at, None);

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.title.as_deref(), Some("Custom title"));
    assert_eq!(retrieved.title_source.as_deref(), Some("manual"));
    assert_eq!(retrieved.title_generated_at, None);

    drop(db);
}

#[test]
fn test_task_id_prefix_prefers_project_override() {
    let (db, _temp_dir) = crate::db::test_helpers::make_test_db("prefix_override");
    let project = db.create_project("Web", "/tmp/web").unwrap();
    db.set_project_config(&project.id, "task_id_prefix", "WEB")
        .unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .unwrap();
    assert!(task.id.starts_with("WEB-"), "got {}", task.id);

    drop(db);
}

#[test]
fn task_creation_falls_back_when_project_prefix_is_missing() {
    let (db, _temp_dir) = make_test_db("task_project_prefix_missing");
    db.set_config("task_id_prefix", "GLOBAL")
        .expect("set global prefix");
    let project = db.create_project("Web", "/tmp/web").unwrap();

    let task = db
        .create_task(
            "Use global prefix",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("missing project prefix should fall back");

    assert_eq!(task.id, "GLOBAL-1");
}

#[test]
fn task_creation_propagates_project_prefix_storage_errors() {
    let (db, _temp_dir) = make_test_db("task_project_prefix_storage_error");
    let project = db.create_project("Web", "/tmp/web").unwrap();
    let conn = db.connection();
    conn.lock()
        .expect("lock database")
        .execute(
            "INSERT INTO project_config (project_id, key, value) VALUES (?1, 'task_id_prefix', X'00')",
            [&project.id],
        )
        .expect("store malformed project prefix");
    drop(conn);

    let error = db
        .create_task("Must fail", "backlog", Some(&project.id), None, None)
        .expect_err("malformed project prefix must fail task creation");

    assert!(matches!(
        error,
        rusqlite::Error::InvalidColumnType(0, _, rusqlite::types::Type::Blob)
    ));
    assert!(
        db.get_all_tasks().expect("read tasks").is_empty(),
        "failed task creation must not insert a task"
    );
}

#[test]
fn test_create_task_snapshots_task_config_when_provided() {
    let (db, _temp_dir) = crate::db::test_helpers::make_test_db("task_snapshot");
    let project = db.create_project("P", "/tmp/p").unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            source_ticket_url: None,
            task_display_title_updates_enabled: Some(false),
            ai_provider: Some("opencode"),
        })
        .unwrap();

    assert_eq!(
        db.get_task_config(&task.id, "task_display_title_metadata_updates_enabled")
            .unwrap(),
        Some("false".to_string())
    );
    assert_eq!(
        db.get_task_config(&task.id, "ai_provider").unwrap(),
        Some("opencode".to_string())
    );
    // Resolver reads the snapshot.
    assert_eq!(
        db.resolve_ai_provider_for_task(&task.id).unwrap(),
        "opencode"
    );

    drop(db);
}

#[test]
fn test_create_task_with_options_blank_title_falls_back_to_null() {
    let (db, _temp_dir) = make_test_db("create_task_options_blank_title");

    let task = db
        .create_task_with_options(super::NewTaskOptions {
            initial_prompt: "Do the work",
            status: "backlog",
            project_id: None,
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: Some("   "),
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create failed");

    assert_eq!(task.title, None);
    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.title, None);

    drop(db);
}

#[test]
fn test_create_task_with_options_persists_source_ticket_url() {
    let (db, _temp_dir) = make_test_db("create_task_options_source_ticket");

    let url = "https://github.com/koenvg/openforge/issues/1294";
    let task = db
        .create_task_with_options(super::NewTaskOptions {
            initial_prompt: "Do the work",
            status: "backlog",
            project_id: None,
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            source_ticket_url: Some(url),
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create failed");

    assert_eq!(task.source_ticket_url.as_deref(), Some(url));

    // Round-trips through the single-row read path.
    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.source_ticket_url.as_deref(), Some(url));

    // And through the bulk read path.
    let all = db.get_all_tasks().expect("get_all failed");
    let found = all.iter().find(|t| t.id == task.id).expect("task missing");
    assert_eq!(found.source_ticket_url.as_deref(), Some(url));

    drop(db);
}

#[test]
fn test_create_task_with_options_blank_source_ticket_url_falls_back_to_null() {
    let (db, _temp_dir) = make_test_db("create_task_options_blank_source_ticket");

    let task = db
        .create_task_with_options(super::NewTaskOptions {
            initial_prompt: "Do the work",
            status: "backlog",
            project_id: None,
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            source_ticket_url: Some("   "),
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create failed");

    assert_eq!(task.source_ticket_url, None);
    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.source_ticket_url, None);

    drop(db);
}

#[test]
fn test_create_task_defaults_source_ticket_url_to_none() {
    let (db, _temp_dir) = make_test_db("create_task_source_ticket_default_none");

    let task = db
        .create_task("Original", "backlog", None, None, None)
        .expect("create failed");

    assert_eq!(task.source_ticket_url, None);
    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.source_ticket_url, None);

    drop(db);
}

#[test]
fn test_create_task_autoincrement() {
    let (db, _temp_dir) = make_test_db("task_autoincrement");
    db.set_config("task_id_prefix", "T").unwrap();

    let task1 = db
        .create_task("Task 1", "backlog", None, None, None)
        .expect("create 1 failed");
    let task2 = db
        .create_task("Task 2", "backlog", None, None, None)
        .expect("create 2 failed");
    let task3 = db
        .create_task("Task 3", "backlog", None, None, None)
        .expect("create 3 failed");

    assert_eq!(task1.id, "T-1");
    assert_eq!(task2.id, "T-2");
    assert_eq!(task3.id, "T-3");

    drop(db);
}

#[test]
fn test_create_task_rejects_malformed_next_task_id_values() {
    for (case, value) in [
        ("blank", ""),
        ("non-numeric", "not-a-number"),
        ("zero", "0"),
        ("negative", "-7"),
        ("overflow", "9223372036854775808"),
        ("exhausted", "9223372036854775807"),
    ] {
        let (db, _temp_dir) = make_test_db(&format!("malformed_task_counter_{case}"));
        db.set_config("next_task_id", value)
            .expect("set malformed task counter");

        let error = db
            .create_task("Must not be created", "backlog", None, None, None)
            .expect_err("malformed task counter must fail task creation");

        assert!(
            error
                .to_string()
                .contains("invalid next_task_id config value"),
            "unexpected error for {case}: {error}"
        );
        assert!(
            db.get_all_tasks()
                .expect("get tasks after failed creation")
                .is_empty(),
            "task was created for {case}"
        );
        assert_eq!(
            db.get_config("next_task_id")
                .expect("get malformed task counter")
                .as_deref(),
            Some(value),
            "task counter changed for {case}"
        );
    }
}

#[test]
fn test_create_task_reports_malformed_counter_before_duplicate_id_collision() {
    let (db, _temp_dir) = make_test_db("malformed_counter_duplicate_collision");
    let existing = db
        .create_task("Existing task", "backlog", None, None, None)
        .expect("create existing task");
    db.set_config("next_task_id", "not-a-number")
        .expect("set malformed task counter");

    let error = db
        .create_task("Must not collide", "backlog", None, None, None)
        .expect_err("malformed task counter must fail before task insertion");

    assert!(
        error
            .to_string()
            .contains("invalid next_task_id config value"),
        "unexpected error: {error}"
    );
    let tasks = db.get_all_tasks().expect("get tasks after failed creation");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, existing.id);
    assert_eq!(
        db.get_config("next_task_id")
            .expect("get malformed task counter")
            .as_deref(),
        Some("not-a-number")
    );
}

#[test]
fn test_create_task_custom_prefix() {
    let (db, _temp_dir) = make_test_db("task_custom_prefix");
    db.set_config("task_id_prefix", "FOO").unwrap();
    let task = db
        .create_task("Custom prefix task", "backlog", None, None, None)
        .expect("create failed");
    assert_eq!(task.id, "FOO-1");
    drop(db);
}

#[test]
fn test_create_task_fallback_when_prefix_missing() {
    let (db, _temp_dir) = make_test_db("task_fallback_missing");
    let conn = db.connection();
    conn.lock()
        .unwrap()
        .execute("DELETE FROM config WHERE key = 'task_id_prefix'", [])
        .unwrap();
    drop(conn);
    let task = db
        .create_task("Fallback task", "backlog", None, None, None)
        .expect("create failed");
    assert!(
        task.id.starts_with("T-"),
        "Expected T- prefix as fallback, got: {}",
        task.id
    );
    drop(db);
}

#[test]
fn task_creation_propagates_global_prefix_storage_errors() {
    let (db, _temp_dir) = make_test_db("task_global_prefix_storage_error");
    let conn = db.connection();
    conn.lock()
        .expect("lock database")
        .execute(
            "UPDATE config SET value = X'00' WHERE key = 'task_id_prefix'",
            [],
        )
        .expect("store malformed global prefix");
    drop(conn);

    let error = db
        .create_task("Must fail", "backlog", None, None, None)
        .expect_err("malformed global prefix must fail task creation");

    assert!(matches!(
        error,
        rusqlite::Error::InvalidColumnType(0, _, rusqlite::types::Type::Blob)
    ));
    assert!(
        db.get_all_tasks().expect("read tasks").is_empty(),
        "failed task creation must not insert a task"
    );
}

#[test]
fn test_create_task_fallback_when_prefix_empty() {
    let (db, _temp_dir) = make_test_db("task_fallback_empty");
    db.set_config("task_id_prefix", "").unwrap();
    let task = db
        .create_task("Fallback task", "backlog", None, None, None)
        .expect("create failed");
    assert!(
        task.id.starts_with("T-"),
        "Expected T- prefix as fallback, got: {}",
        task.id
    );
    drop(db);
}

#[test]
fn test_create_task_with_permission_mode_defaults_agent_to_none() {
    let (db, _temp_dir) = make_test_db("create_task_permission_mode");
    db.set_config("task_id_prefix", "T").unwrap();

    let task = db
        .create_task(
            "Permission mode task",
            "backlog",
            None,
            Some("Do permission-mode work"),
            Some("auto"),
        )
        .expect("create failed");

    assert_eq!(task.id, "T-1");
    assert_eq!(task.agent, None);
    assert_eq!(task.permission_mode, Some("auto".to_string()));

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.agent, None);
    assert_eq!(retrieved.permission_mode, Some("auto".to_string()));

    drop(db);
}

#[test]
fn test_create_task_with_existing_worktree_branch_source() {
    let (db, _temp_dir) = make_test_db("create_task_existing_worktree_branch");

    let task = db
        .create_task_with_worktree_source(
            "Continue PR",
            "backlog",
            None,
            None,
            None,
            super::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create failed");

    assert_eq!(task.worktree_source.as_deref(), Some("existingBranch"));
    assert_eq!(task.worktree_branch.as_deref(), Some("feature/open-pr"));

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.worktree_source.as_deref(), Some("existingBranch"));
    assert_eq!(
        retrieved.worktree_branch.as_deref(),
        Some("feature/open-pr")
    );

    drop(db);
}

#[test]
fn test_create_task_with_disabled_worktree_source() {
    let (db, _temp_dir) = make_test_db("create_task_disabled_worktree_source");

    let task = db
        .create_task_with_worktree_source(
            "Run in project directory",
            "backlog",
            None,
            None,
            None,
            super::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: Some("feature/ignored"),
            },
        )
        .expect("create failed");

    assert_eq!(task.worktree_source.as_deref(), Some("disabled"));
    assert_eq!(task.worktree_branch, None);

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.worktree_source.as_deref(), Some("disabled"));
    assert_eq!(retrieved.worktree_branch, None);

    drop(db);
}

#[test]
fn test_create_task_agent_fields_default_to_none() {
    let (db, _temp_dir) = make_test_db("create_task_agent_none");

    let task = db
        .create_task("No agent task", "backlog", None, None, None)
        .expect("create failed");

    assert_eq!(task.agent, None);
    assert_eq!(task.permission_mode, None);

    let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
    assert_eq!(retrieved.agent, None);
    assert_eq!(retrieved.permission_mode, None);

    drop(db);
}
