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
fn canonical_projections_serialize_with_exact_camel_case_shapes() {
    let task = TaskDetail {
        id: "T-1".to_string(),
        status: "backlog".to_string(),
        project_id: Some("P-1".to_string()),
        created_at: 1,
        updated_at: 2,
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

    let active = db.tasks().active(&project.id).expect("active Tasks");
    let active_bytes = serde_json::to_vec(&active)
        .expect("serialize active Tasks")
        .len();

    assert_eq!(completed.tasks.len(), 50);
    assert!(completed.next_cursor.is_some());
    assert!(completed_bytes < 64 * 1_024);
    assert_eq!(active.tasks.len(), ACTIVE_TASKS);
    assert!(completed_elapsed.as_secs() < 2);
    eprintln!(
        "canonical scale fixture: completed_prompt_bytes={}, completed_page_bytes={}, completed_query_micros={}, active_payload_bytes={active_bytes}",
        COMPLETED_TASKS * PROMPT_BYTES,
        completed_bytes,
        completed_elapsed.as_micros(),
    );
}
