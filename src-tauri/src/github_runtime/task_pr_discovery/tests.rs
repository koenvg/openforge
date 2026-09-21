use super::*;
use crate::{
    app_events::{AppEventBus, RuntimeEventPublisher},
    db::{acquire_db, test_helpers::make_test_db, Database},
    github_client::GitHubClient,
};
use axum::{routing::get, Json, Router};
use std::sync::{Arc, Mutex};
mod capacity;
mod completion;
mod daemon;
mod daemon_hyperlinks;
mod hyperlinks;
mod retries;
pub(crate) mod support;
use support::Fixture;

#[tokio::test]
async fn hidden_discovered_pr_hydrates_from_persisted_events_without_polling() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut events = f.bus.sender().subscribe();
    f.output(42);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name == "task-pull-request-updated"
                && event.payload["action"] == "updated"
            {
                break;
            }
        }
    })
    .await
    .expect("discovery must hydrate a hidden task without polling");
    let prs = crate::github_runtime::get_pull_requests_for_task(&f.db, &f.task_id).unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].head_sha, "abc");
    assert_eq!(prs[0].ci_status.as_deref(), Some("none"));
    assert!(prs[0].readiness_updated_at.is_some());
}
#[tokio::test]
async fn first_pr_from_hidden_local_output_is_persisted_and_notified_without_polling() {
    let f = Fixture::new(false, Some("test-token")).await;
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
    let mut events = f.bus.sender().subscribe();
    let mut output = f.local.observer("registered-shell", 1).unwrap();
    output.output("created https://github.com/acme/widgets/pull/4");
    output.output("2\n");
    f.discovery.settled().await;
    let event = events.try_recv().expect("immediate link event");
    assert_eq!(event.event_name, "task-pull-request-updated");
    assert_eq!(event.payload["task_id"], f.task_id);
    let prs = acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].title, "verified");
    assert!(prs[0].draft);
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
}

#[tokio::test]
async fn slow_verification_coalesces_duplicates_and_retains_distinct_candidates() {
    let f = Fixture::new(true, Some("test-token")).await;
    f.output(42);
    f.calls(1).await;
    f.output(42);
    f.output(43);
    f.output(43);
    f.api.gate.add_permits(10);
    f.discovery.settled().await;
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42, 43]);
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn stale_results_and_concurrent_manual_linking_never_commit() {
    for race in [
        "replacement",
        "completed",
        "deleted",
        "branch",
        "worktree",
        "manual",
    ] {
        let f = Fixture::new(true, Some("test-token")).await;
        let mut events = f.bus.sender().subscribe();
        f.output(42);
        f.calls(1).await;
        match race {
            "replacement" => {
                f.local
                    .register("registered-shell", &f.task_id, f.dir.path().into(), 2)
            }
            "completed" => {
                acquire_db(&f.db)
                    .update_task_status(&f.task_id, "done")
                    .unwrap();
            }
            "deleted" => {
                acquire_db(&f.db).hard_delete_task(&f.task_id).unwrap();
            }
            "branch" => {
                let repo = git2::Repository::open(f.dir.path()).unwrap();
                let commit = repo.head().unwrap().peel_to_commit().unwrap();
                repo.branch("changed", &commit, false).unwrap();
                repo.set_head("refs/heads/changed").unwrap();
            }
            "worktree" => {
                acquire_db(&f.db)
                    .upsert_task_workspace_record(
                        &f.task_id,
                        &f.project_id,
                        "/missing",
                        "/missing",
                        "worktree",
                        None,
                        "pi",
                        "active",
                    )
                    .unwrap();
            }
            "manual" => {
                let other = acquire_db(&f.db)
                    .create_task("manual", "doing", Some(&f.project_id), None, None)
                    .unwrap();
                crate::github_runtime::link_pull_request(
                    &f.db,
                    &other.id,
                    "https://github.com/acme/widgets/pull/42",
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        f.api.gate.add_permits(1);
        f.discovery.settled().await;
        assert!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .is_empty(),
            "{race}"
        );
        assert!(events.try_recv().is_err(), "{race}");
    }
}

#[tokio::test]
async fn normal_completion_preserves_verification_and_rediscovery_does_not_notify_twice() {
    let f = Fixture::new(true, Some("test-token")).await;
    let mut events = f.bus.sender().subscribe();
    f.output(42);
    f.calls(1).await;
    f.local.finish("registered-shell", 1);
    f.api.gate.add_permits(5);
    f.discovery.settled().await;
    assert_eq!(
        events.try_recv().unwrap().event_name,
        "task-pull-request-updated"
    );
    f.local
        .register("registered-shell", &f.task_id, f.dir.path().into(), 2);
    f.local
        .observer("registered-shell", 2)
        .unwrap()
        .output("https://github.com/acme/widgets/pull/42\n");
    f.discovery.settled().await;
    while let Ok(event) = events.try_recv() {
        assert_ne!(
            event.payload["action"], "linked",
            "rediscovery must not emit another link"
        );
    }
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn unattributed_superseded_and_mismatched_output_fails_closed() {
    let f = Fixture::new(false, Some("test-token")).await;
    assert!(f.local.observer("project-only-shell", 1).is_none());
    assert!(f.local.observer("review-only", 1).is_none());
    assert!(f.local.observer("registered-shell", 0).is_none());
    let mut old = f.local.observer("registered-shell", 1).unwrap();
    f.local.invalidate("registered-shell");
    old.output("https://github.com/acme/widgets/pull/42\n");
    f.discovery.settled().await;
    assert!(f.api.calls.lock().unwrap().is_empty());
    f.local
        .register("registered-shell", &f.task_id, f.dir.path().into(), 1);
    f.api.body.lock().unwrap()["head"]["ref"] = "other-branch".into();
    f.output(42);
    f.discovery.settled().await;
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn fork_with_tracked_branch_links_but_untrusted_candidate_never_uses_github() {
    let f = Fixture::new(false, Some("test-token")).await;
    let repo = git2::Repository::open(f.dir.path()).unwrap();
    repo.remote_set_url("origin", "git@github.com:fork/widgets.git")
        .unwrap();
    repo.remote("upstream", "https://github.com/acme/widgets.git")
        .unwrap();
    repo.config()
        .unwrap()
        .set_str("branch.task-branch.remote", "origin")
        .unwrap();
    repo.config()
        .unwrap()
        .set_str("branch.task-branch.merge", "refs/heads/published")
        .unwrap();
    {
        let mut body = f.api.body.lock().unwrap();
        body["head"]["ref"] = "published".into();
        body["head"]["repo"]["full_name"] = "fork/widgets".into();
    }
    f.output(42);
    f.discovery.settled().await;
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
    f.local
        .observer("registered-shell", 1)
        .unwrap()
        .output("https://github.com/untrusted/widgets/pull/42\n");
    f.discovery.settled().await;
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
}
