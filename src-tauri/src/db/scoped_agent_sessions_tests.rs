use super::*;
use crate::db::test_helpers::make_test_db;

fn new_session<'a>(
    id: &'a str,
    owner_plugin_id: &'a str,
    revision: &'a str,
    project_id: &'a str,
    terminal_key: &'a str,
) -> NewScopedAgentSession<'a> {
    NewScopedAgentSession {
        id,
        owner_plugin_id,
        namespace: "github-pr",
        target_key: "owner/repo#42",
        revision,
        project_id,
        checkout_revision: revision,
        provider: "claude-code",
        terminal_key,
        status: ScopedAgentSessionStatus::Starting,
        queue_sequence: None,
    }
}

#[test]
fn stores_exact_scope_and_refuses_cross_plugin_control() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_scope_owner");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    let created = db
        .create_scoped_agent_session(&new_session(
            "sas-1",
            "com.example.review",
            "head-a",
            &project.id,
            "scoped-agent-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ))
        .expect("create Scoped Agent Session");

    assert_eq!(created.status, ScopedAgentSessionStatus::Starting);
    assert_eq!(
        db.scoped_agent_session("github-pr", "owner/repo#42", "head-a")
            .expect("read exact scope"),
        Some(created.clone())
    );
    assert_eq!(
        db.scoped_agent_session("github-pr", "owner/repo#42", "head-b")
            .expect("read unrelated revision"),
        None
    );

    let error = db
        .create_scoped_agent_session(&new_session(
            "sas-2",
            "com.example.other",
            "head-b",
            &project.id,
            "scoped-agent-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ))
        .expect_err("another plugin must not take the logical scope");
    assert!(matches!(
        error,
        ScopedAgentSessionStoreError::OwnershipConflict { owner_plugin_id }
            if owner_plugin_id == "com.example.review"
    ));
}

#[test]
fn runtime_transitions_ignore_stale_pty_instances() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_runtime_transition");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    db.create_scoped_agent_session(&new_session(
        "sas-runtime",
        "com.example.review",
        "head-a",
        &project.id,
        "scoped-agent-v1-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ))
    .expect("create session");
    db.mark_scoped_agent_session_running("sas-runtime", Some("claude-session-1"), 41)
        .expect("mark running");

    assert!(db
        .set_scoped_agent_provider_session_id("sas-runtime", "claude-code", 41, "claude-session-1",)
        .expect("accept matching provider identity"));
    assert!(!db
        .set_scoped_agent_provider_session_id(
            "sas-runtime",
            "claude-code",
            41,
            "claude-sub-session",
        )
        .expect("reject conflicting provider identity"));

    assert!(
        !db.finish_scoped_agent_session(
            "sas-runtime",
            40,
            ScopedAgentSessionStatus::Completed,
            None,
            None,
            4,
        )
        .expect("ignore stale exit")
        .0
    );
    assert!(
        db.finish_scoped_agent_session(
            "sas-runtime",
            41,
            ScopedAgentSessionStatus::Completed,
            None,
            None,
            4,
        )
        .expect("finish current instance")
        .0
    );

    let finished = db
        .scoped_agent_session("github-pr", "owner/repo#42", "head-a")
        .expect("read session")
        .expect("session");
    assert_eq!(finished.status, ScopedAgentSessionStatus::Completed);
    assert_eq!(
        finished.provider_session_id.as_deref(),
        Some("claude-session-1")
    );
    assert_eq!(finished.pty_instance_id, Some(41));
}

#[test]
fn interactive_turns_are_fenced_by_pty_and_turn_identity() {
    let (db, _temp_dir) = make_test_db("scoped_agent_interactive_turns");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    db.create_scoped_agent_session(&new_session(
        "sas-turns",
        "com.example.review",
        "head-a",
        &project.id,
        "scoped-agent-v1-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ))
    .expect("create session");
    db.mark_scoped_agent_session_running("sas-turns", Some("claude-session"), 41)
        .expect("mark running");

    assert_eq!(
        db.begin_scoped_agent_turn("sas-turns", 41, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Applied,
    );
    assert_eq!(
        db.begin_scoped_agent_turn("sas-turns", 41, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Duplicate,
    );
    assert_eq!(
        db.begin_scoped_agent_turn("sas-turns", 41, "turn-b")
            .unwrap(),
        ScopedTurnTransition::Rejected,
    );
    let active = db.scoped_agent_session_by_id("sas-turns").unwrap().unwrap();
    assert_eq!(active.status, ScopedAgentSessionStatus::Running);
    assert_eq!(active.turn_id.as_deref(), Some("turn-a"));
    assert_eq!(
        db.pause_scoped_agent_turn("sas-turns", 40, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Rejected,
    );
    assert_eq!(
        db.pause_scoped_agent_turn("sas-turns", 41, "turn-other")
            .unwrap(),
        ScopedTurnTransition::Rejected,
    );
    assert_eq!(
        db.pause_scoped_agent_turn("sas-turns", 41, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Applied,
    );
    assert_eq!(
        db.pause_scoped_agent_turn("sas-turns", 41, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Duplicate,
    );
    assert_eq!(
        db.begin_scoped_agent_turn("sas-turns", 41, "turn-a")
            .unwrap(),
        ScopedTurnTransition::Duplicate,
    );

    let paused = db.scoped_agent_session_by_id("sas-turns").unwrap().unwrap();
    assert_eq!(paused.status, ScopedAgentSessionStatus::Paused);
    assert_eq!(paused.turn_id.as_deref(), Some("turn-a"));

    assert_eq!(
        db.begin_scoped_agent_turn("sas-turns", 41, "turn-b")
            .unwrap(),
        ScopedTurnTransition::Applied,
    );
    let running = db.scoped_agent_session_by_id("sas-turns").unwrap().unwrap();
    assert_eq!(running.status, ScopedAgentSessionStatus::Running);
    assert_eq!(running.turn_id.as_deref(), Some("turn-b"));
}

#[test]
fn turn_transition_history_preserves_states_that_are_replaced_before_observation() {
    let (db, _temp_dir) = make_test_db("scoped_agent_turn_transition_history");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    db.create_scoped_agent_session(&new_session(
        "sas-history",
        "com.example.review",
        "head-a",
        &project.id,
        "scoped-agent-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ))
    .expect("create session");
    db.mark_scoped_agent_session_running("sas-history", Some("claude-session"), 41)
        .expect("mark running");

    db.begin_scoped_agent_turn("sas-history", 41, "turn-a")
        .expect("begin first turn");
    db.pause_scoped_agent_turn("sas-history", 41, "turn-a")
        .expect("pause first turn");
    db.begin_scoped_agent_turn("sas-history", 41, "turn-b")
        .expect("begin second turn");

    let transitions = db
        .scoped_agent_session_events_after(
            "com.example.review",
            "github-pr",
            "owner/repo#42",
            "head-a",
            0,
            100,
        )
        .expect("read turn transition history");
    assert_eq!(transitions.len(), 3);
    assert!(transitions
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
    assert_eq!(
        transitions
            .iter()
            .map(|transition| (transition.turn_id.as_deref(), transition.status))
            .collect::<Vec<_>>(),
        vec![
            (Some("turn-a"), ScopedAgentSessionStatus::Running),
            (Some("turn-a"), ScopedAgentSessionStatus::Paused),
            (Some("turn-b"), ScopedAgentSessionStatus::Running),
        ],
    );
}

#[test]
fn scheduler_queues_the_fifth_session_and_promotes_fifo() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_scheduler");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    let admit = |index: usize| {
        let id = format!("sas-{index}");
        let target_key = format!("owner/repo#{index}");
        let terminal_key = format!("scoped-agent-v1-{index:064x}");
        db.admit_scoped_agent_session(
            &NewScopedAgentSession {
                id: &id,
                owner_plugin_id: "com.example.review",
                namespace: "github-pr",
                target_key: &target_key,
                revision: "head-a",
                project_id: &project.id,
                checkout_revision: "head-a",
                provider: "claude-code",
                terminal_key: &terminal_key,
                status: ScopedAgentSessionStatus::Starting,
                queue_sequence: None,
            },
            4,
            32,
        )
    };

    for index in 1..=4 {
        let admitted = admit(index).expect("admit active session");
        assert_eq!(admitted.status, ScopedAgentSessionStatus::Starting);
    }
    let fifth = admit(5).expect("queue fifth session");
    assert_eq!(fifth.status, ScopedAgentSessionStatus::Queued);
    assert_eq!(fifth.queue_sequence, Some(1));
    assert_eq!(
        db.scoped_agent_queue_position("sas-5")
            .expect("queue position"),
        Some(1)
    );

    let promoted = db
        .abort_scoped_agent_session("sas-1", 4)
        .expect("abort active session")
        .expect("promote queued session");
    assert_eq!(promoted.id, "sas-5");
    assert_eq!(promoted.status, ScopedAgentSessionStatus::Starting);
    assert_eq!(promoted.queue_sequence, Some(1));
}

#[test]
fn promotion_never_exceeds_the_execution_limit_when_another_start_claimed_the_slot() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_promotion_capacity");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    for index in 1..=5 {
        let id = format!("sas-capacity-{index}");
        let target_key = format!("owner/repo#{index}");
        let terminal_key = format!("scoped-agent-v1-{index:064x}");
        db.admit_scoped_agent_session(
            &NewScopedAgentSession {
                id: &id,
                owner_plugin_id: "com.example.review",
                namespace: "github-pr",
                target_key: &target_key,
                revision: "head-a",
                project_id: &project.id,
                checkout_revision: "head-a",
                provider: "claude-code",
                terminal_key: &terminal_key,
                status: ScopedAgentSessionStatus::Starting,
                queue_sequence: None,
            },
            4,
            32,
        )
        .expect("admit session");
    }

    assert!(db
        .promote_next_scoped_agent_session(4)
        .expect("capacity-checked promotion")
        .is_none());
    let promoted = db
        .abort_scoped_agent_session("sas-capacity-1", 4)
        .expect("abort and promote atomically")
        .expect("queued session should be promoted");
    assert_eq!(promoted.id, "sas-capacity-5");
}

#[test]
fn startup_interrupts_scoped_sessions_without_touching_task_sessions() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_restart");
    let project = db
        .create_project("Repository", "/tmp/repository")
        .expect("create Project");
    let task = db
        .create_task("Task session", "doing", None, None, None)
        .expect("create Task");
    db.create_scoped_agent_session(&new_session(
        "sas-restart",
        "com.example.review",
        "head-a",
        &project.id,
        "scoped-agent-v1-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ))
    .expect("create scoped session");

    assert_eq!(
        db.interrupt_live_scoped_agent_sessions()
            .expect("interrupt scoped sessions"),
        1
    );
    assert_eq!(
        db.scoped_agent_session_by_id("sas-restart")
            .expect("read scoped session")
            .expect("scoped session")
            .status,
        ScopedAgentSessionStatus::Interrupted
    );
    assert_eq!(
        db.get_task(&task.id)
            .expect("read Task")
            .expect("Task")
            .status,
        "doing"
    );
}

#[test]
fn scoped_rows_never_enter_task_session_or_attention_projections() {
    let (db, _temp_dir) = make_test_db("scoped_agent_session_projection_isolation");
    let project = db.create_project("Repository", "/tmp/repository").unwrap();
    let attention_before = db.get_project_attention_summaries().unwrap();
    db.create_scoped_agent_session(&new_session(
        "sas-isolated",
        "com.example.review",
        "head-a",
        &project.id,
        "scoped-agent-v1-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ))
    .unwrap();

    assert!(db
        .list_agent_sessions("claude-code", 0, i64::MAX, None, None, 20)
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        serde_json::to_value(db.get_project_attention_summaries().unwrap()).unwrap(),
        serde_json::to_value(attention_before).unwrap()
    );
}
