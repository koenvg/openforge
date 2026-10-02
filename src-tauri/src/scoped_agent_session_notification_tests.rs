use super::tests::{fixture, request, Fixture};
use super::{lock, ScopedAgentSessionStatus};
use crate::app_events::AppEventEnvelope;

struct ChangeRecorder(tokio::sync::broadcast::Receiver<AppEventEnvelope>);

impl ChangeRecorder {
    fn published(&mut self) -> Vec<String> {
        std::iter::from_fn(|| self.0.try_recv().ok())
            .map(|event| {
                assert_eq!(event.event_name, "scoped-agent-session-changed");
                format!(
                    "{}@{}",
                    event.payload["targetKey"].as_str().unwrap(),
                    event.payload["revision"].as_str().unwrap()
                )
            })
            .collect()
    }
}

fn record_changes(f: &Fixture) -> ChangeRecorder {
    ChangeRecorder(f.events.subscribe())
}

fn scopes(changes: &[&str]) -> Vec<String> {
    changes.iter().map(|change| change.to_string()).collect()
}

#[tokio::test]
async fn promotion_publishes_the_finished_session_then_every_shifted_waiter_then_the_promoted_session(
) {
    let f = fixture("scoped_promotion_changes");
    let mut states = Vec::new();
    for i in 1..=6 {
        states.push(f.service.start(request(&f.project_id, i)).await.unwrap());
    }
    let mut changes = record_changes(&f);

    f.service.complete(&states[0].id, 1, true).await.unwrap();

    assert_eq!(
        changes.published(),
        scopes(&[
            "owner/repo#1@head-a",
            "owner/repo#6@head-a",
            "owner/repo#5@head-a"
        ])
    );
}

#[tokio::test]
async fn aborting_a_waiter_publishes_it_and_the_waiters_behind_it() {
    let f = fixture("scoped_queue_shift_changes");
    for i in 1..=7 {
        f.service.start(request(&f.project_id, i)).await.unwrap();
    }
    let mut changes = record_changes(&f);
    let fifth = request(&f.project_id, 5);

    f.service
        .abort(&fifth.owner_plugin_id, &fifth.scope)
        .await
        .unwrap();

    assert_eq!(
        changes.published(),
        scopes(&[
            "owner/repo#5@head-a",
            "owner/repo#6@head-a",
            "owner/repo#7@head-a"
        ])
    );
}

#[tokio::test]
async fn completing_without_waiters_publishes_only_the_completed_session() {
    let f = fixture("scoped_idle_completion_changes");
    let started = f.service.start(request(&f.project_id, 1)).await.unwrap();
    let mut changes = record_changes(&f);

    f.service.complete(&started.id, 1, true).await.unwrap();

    assert_eq!(changes.published(), scopes(&["owner/repo#1@head-a"]));
}

#[tokio::test]
async fn rotating_a_waiters_revision_publishes_the_old_scope_the_shifted_waiters_and_the_new_scope()
{
    let f = fixture("scoped_rotation_queue_changes");
    for i in 1..=7 {
        f.service.start(request(&f.project_id, i)).await.unwrap();
    }
    let mut changes = record_changes(&f);
    let mut rotated = request(&f.project_id, 5);
    rotated.scope.revision = "head-b".into();

    f.service.start(rotated).await.unwrap();

    assert_eq!(
        changes.published(),
        scopes(&[
            "owner/repo#5@head-a",
            "owner/repo#6@head-a",
            "owner/repo#7@head-a",
            "owner/repo#5@head-b"
        ])
    );
}

#[tokio::test]
async fn rotating_a_running_revision_publishes_the_released_old_scope() {
    let f = fixture("scoped_rotation_running_changes");
    f.service.start(request(&f.project_id, 1)).await.unwrap();
    let mut changes = record_changes(&f);
    let mut rotated = request(&f.project_id, 1);
    rotated.scope.revision = "head-b".into();

    f.service.start(rotated).await.unwrap();

    assert_eq!(
        changes.published(),
        scopes(&["owner/repo#1@head-a", "owner/repo#1@head-b"])
    );
}

#[tokio::test]
async fn a_failed_start_launch_still_publishes_the_failed_session() {
    let f = fixture("scoped_failed_start_changes");
    lock(&f.runtime.failed_targets).push("owner/repo#1".into());
    let mut changes = record_changes(&f);

    assert!(f.service.start(request(&f.project_id, 1)).await.is_err());

    assert_eq!(changes.published(), scopes(&["owner/repo#1@head-a"]));
}

#[tokio::test]
async fn a_failed_continuation_launch_still_publishes_the_failed_session() {
    let f = fixture("scoped_failed_continuation_changes");
    let started = f.service.start(request(&f.project_id, 1)).await.unwrap();
    f.service.complete(&started.id, 1, true).await.unwrap();
    lock(&f.runtime.failed_targets).push("owner/repo#1".into());
    let first = request(&f.project_id, 1);
    let mut changes = record_changes(&f);

    assert!(f
        .service
        .input(&first.owner_plugin_id, &first.scope, "again")
        .await
        .is_err());

    assert_eq!(changes.published(), scopes(&["owner/repo#1@head-a"]));
}

#[tokio::test]
async fn a_failed_promoted_launch_still_publishes_the_promoted_session() {
    let f = fixture("scoped_failed_promotion_changes");
    let mut states = Vec::new();
    for i in 1..=5 {
        states.push(f.service.start(request(&f.project_id, i)).await.unwrap());
    }
    lock(&f.runtime.failed_targets).push("owner/repo#5".into());
    let mut changes = record_changes(&f);

    f.service.complete(&states[0].id, 1, true).await.unwrap();

    assert_eq!(
        changes.published(),
        scopes(&["owner/repo#1@head-a", "owner/repo#5@head-a"])
    );
    let promoted = request(&f.project_id, 5);
    let state = f
        .service
        .status(&promoted.owner_plugin_id, &promoted.scope)
        .unwrap()
        .unwrap();
    assert_eq!(state.status, ScopedAgentSessionStatus::Failed);
}

#[tokio::test]
async fn releasing_every_session_of_an_owner_publishes_each_released_scope() {
    let f = fixture("scoped_owner_release_changes");
    for i in 1..=2 {
        f.service.start(request(&f.project_id, i)).await.unwrap();
    }
    let mut changes = record_changes(&f);

    f.service
        .release_owner("com.example.review", None)
        .await
        .unwrap();

    let mut published = changes.published();
    published.sort();
    assert_eq!(
        published,
        scopes(&["owner/repo#1@head-a", "owner/repo#2@head-a"])
    );
}
