use super::*;
use crate::db::{test_helpers::make_test_db, TaskReadError};
use serde_json::json;
use std::{collections::HashSet, time::Instant};

fn task_read_contract_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../docs/contracts/task-read-contract-fixtures.json",
    ))
    .expect("Task read contract fixture")
}

#[test]
fn completed_period_contract_distinguishes_known_dates_from_unknown_history() {
    let fixture = task_read_contract_fixture();
    let (db, _temp_dir) = make_test_db("completed_period_contract");
    let project = db
        .create_project("Project", "/tmp/completed-period-contract")
        .expect("create Project");
    let known = db
        .create_task("Known", "doing", Some(&project.id), None, None)
        .expect("create known Task");
    db.complete_task_if_status(&known.id, "doing")
        .expect("complete known Task");
    db.create_task("Unknown", "done", Some(&project.id), None, None)
        .expect("import unknown Task");
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.execute(
            "UPDATE tasks SET completed_at = ?1 WHERE id = ?2",
            rusqlite::params![fixture["knownCompletedAt"].as_i64().unwrap(), known.id],
        )
        .expect("seed known historical date");
        conn.execute(
            "UPDATE task_completion_coverage SET tracked_from = ?1 WHERE id = 1",
            [fixture["trackedFrom"].as_i64().unwrap()],
        )
        .expect("seed verified tracking interval");
    }
    let query: CompletedTaskQuery = serde_json::from_value(json!({
        "completedFrom": fixture["completedFrom"],
        "completedBefore": fixture["completedBefore"],
    }))
    .expect("parse canonical period filter");
    let page = db
        .tasks()
        .completed(&project.id, query)
        .expect("read period");
    let value = serde_json::to_value(&page).expect("serialize period page");
    assert_eq!(page.tasks.len(), 1);
    assert_eq!(value["tasks"][0]["id"], known.id);
    assert_eq!(
        value["tasks"][0]["completedAt"],
        fixture["knownCompletedAt"]
    );
    let detail = db
        .tasks()
        .detail(&project.id, &known.id)
        .expect("read completed detail")
        .expect("known Task exists");
    assert_eq!(detail.task.completed_at, page.tasks[0].completed_at);
    assert_eq!(
        value["completionCoverage"]["trackedFrom"],
        fixture["trackedFrom"]
    );
    assert_eq!(
        value["completionCoverage"]["unknownCompletedTaskCount"],
        fixture["unknownCompletedTaskCount"]
    );
    assert_eq!(value["completionCoverage"]["rangeStatus"], "complete");
    let empty: CompletedTaskQuery = serde_json::from_value(json!({
        "completedFrom": fixture["knownCompletedAt"].as_i64().unwrap() + 1,
        "completedBefore": fixture["knownCompletedAt"].as_i64().unwrap() + 2,
    }))
    .expect("parse empty interval");
    let empty = db
        .tasks()
        .completed(&project.id, empty)
        .expect("read empty period");
    let empty = serde_json::to_value(empty).expect("serialize empty page");
    assert_eq!(empty["tasks"], json!([]));
    assert_eq!(empty["completionCoverage"]["rangeStatus"], "complete");
    assert_eq!(
        empty["completionCoverage"]["unknownCompletedTaskCount"],
        fixture["unknownCompletedTaskCount"]
    );
    let invalid: CompletedTaskQuery = serde_json::from_value(json!({
        "completedFrom": fixture["completedFrom"],
        "completedBefore": fixture["invalidCompletedBefore"],
    }))
    .expect("parse range for validation");
    assert!(db.tasks().completed(&project.id, invalid).is_err());
}
#[test]
fn completed_period_rejects_unpaired_negative_and_unsafe_second_bounds() {
    let (db, _temp_dir) = make_test_db("completed_invalid_period");
    let project = db
        .create_project("Project", "/tmp/completed-invalid-period")
        .expect("create Project");
    for (from, before) in [
        (Some(1), None),
        (None, Some(2)),
        (Some(-1), Some(2)),
        (Some(3), Some(3)),
        (Some(4), Some(3)),
        (Some(1), Some(9_007_199_254_740_992)),
    ] {
        assert!(matches!(
            db.tasks().completed(
                &project.id,
                CompletedTaskQuery {
                    completed_from: from,
                    completed_before: before,
                    ..CompletedTaskQuery::default()
                }
            ),
            Err(TaskReadError::InvalidCompletionRange)
        ));
    }
}

#[test]
fn completion_date_agrees_between_detail_and_unfiltered_summary() {
    let (db, _temp_dir) = make_test_db("completion_date_projection_parity");
    let project = db
        .create_project("Project", "/tmp/completion-date-projection-parity")
        .expect("create Project");
    let task = db
        .create_task("Doing", "doing", Some(&project.id), None, None)
        .expect("create Task");
    db.complete_task_if_status(&task.id, "doing")
        .expect("complete Task");
    let summary = db
        .tasks()
        .completed(&project.id, CompletedTaskQuery::default())
        .expect("completed Tasks")
        .tasks
        .into_iter()
        .next()
        .expect("completed summary");
    let detail = db
        .tasks()
        .detail(&project.id, &task.id)
        .expect("read Task detail")
        .expect("Task exists");
    assert!(summary.completed_at.is_some());
    assert_eq!(summary.completed_at, detail.task.completed_at);
}

#[test]
fn canonical_projections_serialize_with_exact_camel_case_shapes() {
    let task = TaskDetail {
        id: "T-1".to_string(),
        status: "backlog".to_string(),
        project_id: Some("P-1".to_string()),
        created_at: 1,
        updated_at: 2,
        completed_at: None,
        title: "Title".to_string(),
        source_ticket_url: Some("https://example.com/T-1".to_string()),
        prompt: "Prompt".to_string(),
        prompt_preview: "Prompt".to_string(),
        agent: None,
        permission_mode: None,
        worktree_source: None,
        worktree_branch: None,
        title_source: None,
        title_generated_at: None,
        depends_on: vec!["T-0".to_string()],
        labels: Vec::new(),
    };
    let value = serde_json::to_value(&task).expect("serialize Task detail");
    assert_eq!(
        value,
        json!({
            "id": "T-1",
            "status": "backlog",
            "projectId": "P-1",
            "createdAt": 1,
            "updatedAt": 2,
            "completedAt": null,
            "title": "Title",
            "sourceTicketUrl": "https://example.com/T-1",
            "prompt": "Prompt",
            "promptPreview": "Prompt",
            "agent": null,
            "permissionMode": null,
            "worktreeSource": null,
            "worktreeBranch": null,
            "titleSource": null,
            "titleGeneratedAt": null,
            "dependsOn": ["T-0"],
            "labels": [],
        })
    );
}

#[test]
fn active_and_detail_are_project_scoped_and_include_immediate_relationship_context() {
    let (db, _temp_dir) = make_test_db("canonical_task_active_and_detail");
    let project = db
        .create_project("Project", "/tmp/canonical-task-active")
        .expect("project");
    let other_project = db
        .create_project("Other", "/tmp/canonical-task-other")
        .expect("other project");
    let dependency = db
        .create_task("Done dependency", "done", Some(&project.id), None, None)
        .expect("dependency");
    let active = db
        .create_task("Active", "backlog", Some(&project.id), None, None)
        .expect("active");
    let dependent = db
        .create_task("Done dependent", "done", Some(&project.id), None, None)
        .expect("dependent");
    let unrelated = db
        .create_task("Unrelated", "backlog", Some(&other_project.id), None, None)
        .expect("unrelated");
    db.add_task_dependency(&active.id, &dependency.id)
        .expect("dependency edge");
    db.add_task_dependency(&dependent.id, &active.id)
        .expect("dependent edge");

    let snapshot = db.tasks().active(&project.id).expect("active Tasks");
    assert_eq!(
        snapshot
            .tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect::<Vec<_>>(),
        [active.id.as_str()]
    );
    let related_ids = snapshot
        .related
        .iter()
        .map(|task| task.id.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(
        related_ids,
        HashSet::from([dependency.id.as_str(), dependent.id.as_str()])
    );
    assert!(!related_ids.contains(unrelated.id.as_str()));

    let detail = db
        .tasks()
        .detail(&project.id, &active.id)
        .expect("Task detail")
        .expect("existing Task");
    assert_eq!(detail.task.id, active.id);
    assert_eq!(detail.task.completed_at, None);
    assert_eq!(
        detail
            .related
            .iter()
            .map(|task| task.id.as_str())
            .collect::<HashSet<_>>(),
        related_ids
    );
    assert!(db
        .tasks()
        .detail(&other_project.id, &active.id)
        .expect("scoped detail")
        .is_none());
    assert!(db
        .tasks()
        .detail(&project.id, "T-missing")
        .expect("missing detail")
        .is_none());
    assert!(matches!(
        db.tasks().active("P-missing"),
        Err(TaskReadError::ProjectNotFound(project_id)) if project_id == "P-missing"
    ));
}

#[test]
fn completed_pages_are_fixed_at_fifty_and_cursors_are_scope_bound() {
    let contract = task_read_contract_fixture();
    let completed_task_count = contract["completedTaskCount"]
        .as_u64()
        .expect("completed Task fixture count") as usize;
    let completed_page_size = contract["completedPageSize"]
        .as_u64()
        .expect("Completed Task page size") as usize;
    let (db, _temp_dir) = make_test_db("canonical_completed_pages");
    let project = db
        .create_project("Project", "/tmp/canonical-completed")
        .expect("project");
    let other_project = db
        .create_project("Other", "/tmp/canonical-completed-other")
        .expect("other project");
    assert_eq!(project.id, contract["projectId"]);
    assert_eq!(other_project.id, contract["otherProjectId"]);
    for index in 0..completed_task_count {
        db.create_task(
            &format!("Completed {index:02}"),
            "done",
            Some(&project.id),
            None,
            None,
        )
        .expect("completed Task");
    }
    db.create_task(
        "Other completed",
        "done",
        Some(&other_project.id),
        None,
        None,
    )
    .expect("other completed Task");

    let first = db
        .tasks()
        .completed(&project.id, CompletedTaskQuery::default())
        .expect("first page");
    assert_eq!(first.tasks.len(), completed_page_size);
    assert!(first
        .tasks
        .iter()
        .all(|task| task.project_id.as_deref() == Some(project.id.as_str())));
    let cursor = first.next_cursor.expect("next cursor");
    let second = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                cursor: Some(cursor.clone()),
                ..CompletedTaskQuery::default()
            },
        )
        .expect("second page");
    assert_eq!(
        second.tasks.len(),
        completed_task_count - completed_page_size
    );
    assert!(second.next_cursor.is_none());
    let first_ids = first
        .tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect::<HashSet<_>>();
    assert!(!first_ids.contains(second.tasks[0].id.as_str()));

    assert!(matches!(
        db.tasks().completed(
            &other_project.id,
            CompletedTaskQuery {
                cursor: Some(cursor),
                ..CompletedTaskQuery::default()
            },
        ),
        Err(TaskReadError::InvalidCursor)
    ));
}

#[test]
fn completion_date_pages_use_immutable_keysets_and_scope_bound_cursors() {
    let fixture = task_read_contract_fixture();
    let (db, _temp_dir) = make_test_db("completed_date_keyset");
    let project = db
        .create_project("Project", "/tmp/completed-date-keyset")
        .expect("create Project");
    let other = db
        .create_project("Other", "/tmp/completed-date-keyset-other")
        .expect("create other Project");
    for index in 0..fixture["completedTaskCount"].as_u64().unwrap() {
        db.create_task(
            &format!("Dated {index}"),
            "done",
            Some(&project.id),
            None,
            None,
        )
        .expect("seed completed Task");
    }
    db.create_task("Other dated", "done", Some(&other.id), None, None)
        .expect("seed another Project");
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.execute(
            "UPDATE tasks SET completed_at = ?1 WHERE status = 'done'",
            [fixture["knownCompletedAt"].as_i64().unwrap()],
        )
        .expect("seed verified dates");
    }
    let from = fixture["completedFrom"].as_i64().unwrap();
    let before = fixture["completedBefore"].as_i64().unwrap();
    let query = CompletedTaskQuery {
        completed_from: Some(from),
        completed_before: Some(before),
        ..CompletedTaskQuery::default()
    };
    let first = db
        .tasks()
        .completed(&project.id, query.clone())
        .expect("first date page");
    assert_eq!(first.tasks.len(), 50);
    assert!(first.tasks.windows(2).all(|pair| pair[0].id > pair[1].id));
    let cursor = first.next_cursor.expect("next date cursor");
    let second = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                cursor: Some(cursor.clone()),
                ..query.clone()
            },
        )
        .expect("second date page");
    assert_eq!(second.tasks.len(), 1);
    assert!(second.next_cursor.is_none());
    assert!(first.tasks.iter().all(|task| task.id != second.tasks[0].id));
    assert!(matches!(
        db.tasks().completed(
            &other.id,
            CompletedTaskQuery {
                cursor: Some(cursor.clone()),
                ..query.clone()
            }
        ),
        Err(TaskReadError::InvalidCursor)
    ));
    assert!(matches!(
        db.tasks().completed(
            &project.id,
            CompletedTaskQuery {
                completed_before: Some(before + 1),
                cursor: Some(cursor.clone()),
                ..query.clone()
            }
        ),
        Err(TaskReadError::InvalidCursor)
    ));
    assert!(matches!(
        db.tasks().completed(
            &project.id,
            CompletedTaskQuery {
                cursor: Some(cursor),
                ..CompletedTaskQuery::default()
            }
        ),
        Err(TaskReadError::InvalidCursor)
    ));
}

#[test]
fn completed_filters_are_bounded_normalized_and_use_persisted_previews() {
    let contract = task_read_contract_fixture();
    let maximum_search_characters = contract["maximumSearchCharacters"]
        .as_u64()
        .expect("maximum search characters") as usize;
    let maximum_label_filters = contract["maximumLabelFilters"]
        .as_u64()
        .expect("maximum label filters") as usize;
    let maximum_label_characters = contract["maximumLabelCharacters"]
        .as_u64()
        .expect("maximum label characters") as usize;
    let (db, _temp_dir) = make_test_db("canonical_completed_filters");
    let project = db
        .create_project("Project", "/tmp/canonical-completed-filters")
        .expect("project");
    let matching = db
        .create_task(
            "Visible needle\n[image#1]: data:image/png;base64,AAAA",
            "done",
            Some(&project.id),
            None,
            None,
        )
        .expect("matching Task");
    db.add_task_label(&matching.id, "Urgent")
        .expect("Task Label");
    db.create_task("Unrelated", "done", Some(&project.id), None, None)
        .expect("unrelated Task");

    let page = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                search: Some(" NEEDLE ".to_string()),
                labels: vec![" urgent ".to_string()],
                cursor: None,
                completed_from: None,
                completed_before: None,
            },
        )
        .expect("filtered page");
    assert_eq!(page.tasks.len(), 1);
    assert_eq!(page.tasks[0].id, matching.id);
    assert_eq!(page.tasks[0].prompt_preview, "Visible needle");
    let serialized = serde_json::to_value(&page).expect("serialize page");
    assert!(serialized.get("tasks").is_some());
    assert!(serialized.get("nextCursor").is_some());
    assert!(serialized.to_string().find("initial_prompt").is_none());

    assert!(matches!(
        db.tasks().completed(
            &project.id,
            CompletedTaskQuery {
                search: Some("x".repeat(maximum_search_characters + 1)),
                ..CompletedTaskQuery::default()
            },
        ),
        Err(TaskReadError::SearchTooLong { .. })
    ));
    assert!(matches!(
        db.tasks().completed(
            &project.id,
            CompletedTaskQuery {
                labels: vec!["label".to_string(); maximum_label_filters + 1],
                ..CompletedTaskQuery::default()
            },
        ),
        Err(TaskReadError::TooManyLabels { .. })
    ));
    assert!(matches!(
        db.tasks().completed(
            &project.id,
            CompletedTaskQuery {
                labels: vec!["x".repeat(maximum_label_characters + 1)],
                ..CompletedTaskQuery::default()
            },
        ),
        Err(TaskReadError::LabelNameTooLong { .. })
    ));
}

#[test]
fn canonical_reads_stay_bounded_with_production_scale_completed_prompts() {
    const COMPLETED_TASKS: usize = 2_000;
    const ACTIVE_TASKS: usize = 70;
    const PROMPT_BYTES: usize = 2_048;

    let (db, _temp_dir) = make_test_db("canonical_production_scale_reads");
    let project = db
        .create_project("Project", "/tmp/canonical-production-scale")
        .expect("project");
    let prompt_body = "x".repeat(PROMPT_BYTES);
    for index in 0..COMPLETED_TASKS {
        db.create_task(
            &format!("Completed {index}\n{prompt_body}"),
            "done",
            Some(&project.id),
            None,
            None,
        )
        .expect("Completed Task fixture");
    }
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock scale database");
        conn.execute(
            "UPDATE tasks SET completed_at = 1700000000 WHERE id IN (SELECT id FROM tasks WHERE status = 'done' ORDER BY id LIMIT 1000)",
            [],
        )
        .expect("seed dated scale fixture");
    }
    for index in 0..ACTIVE_TASKS {
        db.create_task(
            &format!("Active {index}\n{prompt_body}"),
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("active Task fixture");
    }

    let completed_started = Instant::now();
    let completed = db
        .tasks()
        .completed(&project.id, CompletedTaskQuery::default())
        .expect("Completed Task page");
    let completed_elapsed = completed_started.elapsed();
    let completed_bytes = serde_json::to_vec(&completed)
        .expect("serialize Completed Task page")
        .len();

    let period_started = Instant::now();
    let period = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                completed_from: Some(1_700_000_000),
                completed_before: Some(1_700_000_001),
                ..CompletedTaskQuery::default()
            },
        )
        .expect("dated Completed Task page");
    let period_elapsed = period_started.elapsed();
    let period_bytes = serde_json::to_vec(&period)
        .expect("serialize period page")
        .len();
    let [date_plan, unknown_plan] = {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database for query plans");
        let plans = [
            (
                "EXPLAIN QUERY PLAN SELECT tasks.id FROM tasks WHERE tasks.status = 'done' AND tasks.project_id = ?1 AND tasks.completed_at IS NOT NULL AND tasks.completed_at >= ?2 AND tasks.completed_at < ?3 ORDER BY tasks.completed_at DESC, tasks.id DESC LIMIT 51",
                vec![rusqlite::types::Value::Text(project.id.clone()), rusqlite::types::Value::Integer(1_700_000_000), rusqlite::types::Value::Integer(1_700_000_001)],
            ),
            (
                "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM tasks WHERE tasks.status = 'done' AND tasks.project_id = ?1 AND tasks.completed_at IS NULL",
                vec![rusqlite::types::Value::Text(project.id.clone())],
            ),
        ];
        plans.map(|(sql, params)| {
            let mut statement = conn.prepare(sql).expect("prepare query plan");
            statement
                .query_map(rusqlite::params_from_iter(params), |row| {
                    row.get::<_, String>(3)
                })
                .expect("query plan")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("read query plan")
                .join(" ")
        })
    };
    let active = db.tasks().active(&project.id).expect("active Tasks");
    let active_bytes = serde_json::to_vec(&active)
        .expect("serialize active Tasks")
        .len();

    assert_eq!(completed.tasks.len(), 50);
    assert!(completed.next_cursor.is_some());
    assert!(completed_bytes < 64 * 1_024);
    assert_eq!(period.tasks.len(), 50);
    assert!(period.next_cursor.is_some());
    assert_eq!(
        period.completion_coverage.unknown_completed_task_count,
        1000
    );
    assert!(period_bytes < 64 * 1_024);
    assert!(period_elapsed.as_secs() < 2);
    assert!(
        date_plan.contains("idx_tasks_project_completed_at"),
        "{date_plan}"
    );
    assert!(
        unknown_plan.contains("idx_tasks_project_unknown_completed_at"),
        "{unknown_plan}"
    );
    assert_eq!(active.tasks.len(), ACTIVE_TASKS);
    assert!(completed_elapsed.as_secs() < 2);
    eprintln!(
        "canonical scale fixture: completed_prompt_bytes={}, completed_page_bytes={}, completed_query_micros={}, active_payload_bytes={active_bytes}",
        COMPLETED_TASKS * PROMPT_BYTES,
        completed_bytes,
        completed_elapsed.as_micros(),
    );
}

#[test]
fn period_pages_ignore_metadata_update_order_and_report_boundary_coverage() {
    let fixture = task_read_contract_fixture();
    let (db, _temp_dir) = make_test_db("period_metadata_and_coverage");
    let project = db
        .create_project("Project", "/tmp/period-metadata")
        .expect("create Project");
    let from = fixture["completedFrom"].as_i64().unwrap();
    let before = fixture["completedBefore"].as_i64().unwrap();
    let mut ids = Vec::new();
    for index in 0..51 {
        ids.push(
            db.create_task(
                &format!("Matching {index}"),
                "done",
                Some(&project.id),
                None,
                None,
            )
            .expect("seed Task")
            .id,
        );
    }
    let upper = db
        .create_task("Upper boundary", "done", Some(&project.id), None, None)
        .expect("seed upper boundary");
    let unknown = db
        .create_task("Undated", "done", Some(&project.id), None, None)
        .expect("seed unknown Task");
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        for id in &ids {
            conn.execute(
                "UPDATE tasks SET completed_at = ?1 WHERE id = ?2",
                rusqlite::params![from, id],
            )
            .expect("seed lower boundary");
        }
        conn.execute(
            "UPDATE tasks SET completed_at = ?1 WHERE id = ?2",
            rusqlite::params![before, upper.id],
        )
        .expect("seed upper boundary");
        conn.execute(
            "UPDATE task_completion_coverage SET tracked_from = ?1",
            [from],
        )
        .expect("seed tracking boundary");
    }
    let query = CompletedTaskQuery {
        completed_from: Some(from),
        completed_before: Some(before),
        ..CompletedTaskQuery::default()
    };
    let first = db
        .tasks()
        .completed(&project.id, query.clone())
        .expect("first page");
    assert_eq!(first.tasks.len(), 50);
    assert_eq!(first.completion_coverage.unknown_completed_task_count, 1);
    assert_eq!(
        first.completion_coverage.range_status,
        super::CompletionRangeStatus::Complete
    );
    assert!(!first
        .tasks
        .iter()
        .any(|task| task.id == upper.id || task.id == unknown.id));
    let last_id = ids
        .into_iter()
        .find(|id| !first.tasks.iter().any(|task| task.id == *id))
        .expect("task on second page");
    db.update_task_title(&last_id, "Edited after first page")
        .expect("edit Task metadata");
    {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![before + 1000, last_id],
        )
        .expect("force changed update order");
    }
    let second = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                cursor: first.next_cursor.clone(),
                ..query.clone()
            },
        )
        .expect("second page");
    assert_eq!(
        second.tasks.iter().map(|task| &task.id).collect::<Vec<_>>(),
        [&last_id]
    );
    assert_eq!(second.completion_coverage.unknown_completed_task_count, 1);
    let partial = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                completed_from: Some(from - 1),
                completed_before: Some(from + 1),
                ..CompletedTaskQuery::default()
            },
        )
        .expect("partial period");
    assert_eq!(
        partial.completion_coverage.range_status,
        super::CompletionRangeStatus::Partial
    );
    let unavailable = db
        .tasks()
        .completed(
            &project.id,
            CompletedTaskQuery {
                completed_from: Some(from - 2),
                completed_before: Some(from),
                ..CompletedTaskQuery::default()
            },
        )
        .expect("unavailable period");
    assert!(unavailable.tasks.is_empty());
    assert_eq!(
        unavailable.completion_coverage.range_status,
        super::CompletionRangeStatus::Unavailable
    );
    assert_eq!(
        unavailable.completion_coverage.unknown_completed_task_count,
        1
    );
}
