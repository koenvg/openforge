use super::*;
use crate::app_events::AppEventBus;
use crate::db::acquire_db;
use crate::github_poller::poll_execution::poll_github_once_with_state;
use axum::{
    extract::{Query, State},
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

#[derive(Default)]
struct Api {
    authored_searches: AtomicUsize,
    requests: AtomicUsize,
    review_requests: AtomicUsize,
    external_stage: AtomicUsize,
    fail_search: AtomicBool,
    fail_details: AtomicBool,
    empty_authored_search: AtomicBool,
    fail_review_list: AtomicBool,
    task_id: String,
}

async fn respond(
    State(api): State<Arc<Api>>,
    uri: Uri,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    api.requests.fetch_add(1, Ordering::SeqCst);
    if uri.path() == "/repos/acme/widgets/pulls/7/reviews" {
        api.review_requests.fetch_add(1, Ordering::SeqCst);
    }
    if uri.path() == "/repos/acme/widgets/pulls/7" && api.fail_details.load(Ordering::SeqCst) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"message":"unavailable"})),
        )
            .into_response();
    }
    let stage = api.external_stage.load(Ordering::SeqCst);
    let body = match uri.path() {
        "/user" => json!({"login":"me"}),
        "/search/issues" => {
            if !query.get("q").is_some_and(|q| q.starts_with("author:")) {
                if api.fail_review_list.load(Ordering::SeqCst) {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(json!({"message":"unavailable"})),
                    )
                        .into_response();
                }
                return Json(json!({"total_count":0,"items":[]})).into_response();
            }
            api.authored_searches.fetch_add(1, Ordering::SeqCst);
            if api.fail_search.load(Ordering::SeqCst) {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({"message":"unavailable"})),
                )
                    .into_response();
            }
            if api.empty_authored_search.load(Ordering::SeqCst) {
                return Json(json!({"total_count":0,"items":[]})).into_response();
            }
            json!({"total_count":1,"items":[{
                "id":42,"number":7,"title":format!("Recover {}", api.task_id),"body":null,
                "state":"open","draft":false,"html_url":"https://github.com/acme/widgets/pull/7",
                "user":{"login":"me"},"repository_url":"https://api.github.com/repos/acme/widgets",
                "created_at":"2026-09-14T08:30:00Z","updated_at":"2026-09-15T09:45:00Z"
            }]})
        }
        "/repos/acme/widgets/pulls/7" => json!({
            "id":42,"number":7,"title":format!("Recover {}", api.task_id),
            "state":if stage == 2 { "closed" } else { "open" },
            "merged":stage == 2,"merged_at":if stage == 2 { Some("2026-09-20T10:00:00Z") } else { None },
            "html_url":"https://github.com/acme/widgets/pull/7","user":{"login":"me"},
            "head":{"ref":"feature/external","sha":"abc"},"base":{"ref":"main"},
            "draft":false,"mergeable":true,"mergeable_state":"clean"
        }),
        "/repos/acme/widgets/commits/abc/check-runs" => json!({"total_count":1,"check_runs":[{
            "id":91,"name":"test","status":"completed","conclusion":if stage == 1 { "failure" } else { "success" },
            "html_url":"https://github.com/acme/widgets/actions/runs/91"
        }]}),
        "/repos/acme/widgets/commits/abc/status" => {
            json!({"state":"success","statuses":[],"sha":"abc","total_count":0})
        }
        "/repos/acme/widgets/pulls/7/reviews" if stage > 0 => json!([{
            "id":81,"user":{"login":"reviewer"},"body":"Looks good","state":"APPROVED",
            "submitted_at":"2026-09-20T09:00:00Z","html_url":"https://github.com/acme/widgets/pull/7#review-81"
        }]),
        "/repos/acme/widgets/issues/7/comments" if stage > 0 => json!([{
            "id":82,"user":{"login":"reviewer"},"body":"External comment",
            "created_at":"2026-09-20T09:00:00Z","updated_at":"2026-09-20T09:00:00Z",
            "html_url":"https://github.com/acme/widgets/pull/7#issuecomment-82"
        }]),
        "/repos/acme/widgets/pulls/7/reviews"
        | "/repos/acme/widgets/pulls/7/comments"
        | "/repos/acme/widgets/issues/7/comments" => json!([]),
        _ => return (StatusCode::NOT_FOUND, Json(json!({"message":"not found"}))).into_response(),
    };
    Json(body).into_response()
}

struct Fixture {
    db: Arc<Mutex<crate::db::Database>>,
    client: GitHubClient,
    api: Arc<Api>,
    bus: AppEventBus,
    server: tokio::task::JoinHandle<()>,
    _dir: tempfile::TempDir,
}
impl Fixture {
    async fn new() -> Self {
        let (db, dir) = make_test_db("recovery_execution");
        let project = db
            .create_project("test", dir.path().to_str().unwrap())
            .unwrap();
        let task = db
            .create_task("Created elsewhere", "doing", Some(&project.id), None, None)
            .unwrap();
        db.set_config("github_username", "me").unwrap();
        let api = Arc::new(Api {
            task_id: task.id,
            ..Default::default()
        });
        let router = Router::new().fallback(respond).with_state(api.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            db: Arc::new(Mutex::new(db)),
            client: GitHubClient::with_test_token(Ok(Some("token".into())))
                .with_test_api_base_url(format!("http://{address}")),
            api,
            bus: AppEventBus::new(64, 64),
            server,
            _dir: dir,
        }
    }
    async fn poll(&self, scope: PollScope) -> PollResult {
        poll_github_once_with_state(
            self.db.clone(),
            &self.client,
            &GitHubEventTarget::sidecar(Some(self.bus.sender())),
            &scope,
        )
        .await
    }
    fn links(&self) -> Vec<PrRow> {
        acquire_db(&self.db)
            .get_pull_requests_for_task(&self.api.task_id)
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

#[tokio::test]
async fn global_list_only_refresh_does_not_discover_task_links() {
    let f = Fixture::new().await;
    let mut events = f.bus.sender().subscribe();
    assert_eq!(
        f.poll(PollScope::GlobalReviewLists).await.outcome,
        PollOutcome::Completed
    );
    assert!(f.links().is_empty());
    assert_eq!(f.api.authored_searches.load(Ordering::SeqCst), 1);
    let mut authored_updated = false;
    while let Ok(event) = events.try_recv() {
        assert_ne!(event.event_name, "task-pull-request-updated");
        authored_updated |= event.event_name == "authored-prs-updated";
    }
    assert!(authored_updated);
}

#[tokio::test]
async fn recovery_success_is_independent_of_global_list_failure() {
    let f = Fixture::new().await;
    f.api.fail_review_list.store(true, Ordering::SeqCst);
    let execution = crate::github_poller::poll_execution::poll_github_scope(
        f.db.clone(),
        &f.client,
        &GitHubEventTarget::sidecar(None),
        &PollScope::GlobalReviewListsAndTaskLinks,
    )
    .await;
    assert_eq!(execution.result.outcome, PollOutcome::Failed);
    assert!(execution.task_links_succeeded);
    assert_eq!(f.links().len(), 1);
}

#[tokio::test]
async fn complete_empty_authored_search_succeeds_even_when_review_list_fails() {
    let f = Fixture::new().await;
    f.api.empty_authored_search.store(true, Ordering::SeqCst);
    f.api.fail_review_list.store(true, Ordering::SeqCst);
    let execution = crate::github_poller::poll_execution::poll_github_scope(
        f.db.clone(),
        &f.client,
        &GitHubEventTarget::sidecar(None),
        &PollScope::GlobalReviewListsAndTaskLinks,
    )
    .await;
    assert_eq!(execution.result.outcome, PollOutcome::Failed);
    assert!(execution.task_links_succeeded);
    assert!(f.links().is_empty());
    assert_eq!(f.api.authored_searches.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn recovery_reuses_authored_snapshot_and_notifies_only_new_links() {
    let f = Fixture::new().await;
    let mut events = f.bus.sender().subscribe();
    assert!(f.links().is_empty());
    let result = f.poll(PollScope::GlobalReviewListsAndTaskLinks).await;
    assert_eq!(result.outcome, PollOutcome::Completed);
    assert_eq!(f.links().len(), 1);
    assert_eq!(f.api.authored_searches.load(Ordering::SeqCst), 1);
    let mut links = Vec::<Value>::new();
    while let Ok(event) = events.try_recv() {
        if event.event_name == "task-pull-request-updated" && event.payload["action"] == "linked" {
            links.push(event.payload);
        }
    }
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["task_id"], f.api.task_id);
    assert_eq!(links[0]["action"], "linked");
    assert_eq!(
        f.poll(PollScope::TaskLinkReconciliation).await.outcome,
        PollOutcome::Completed
    );
    assert_eq!(f.links().len(), 1);
    while let Ok(event) = events.try_recv() {
        assert_ne!(event.event_name, "task-pull-request-updated");
    }
}

#[tokio::test]
async fn reconciliation_hydrates_hidden_tasks_even_without_task_polling() {
    let f = Fixture::new().await;
    acquire_db(&f.db)
        .update_task_status(&f.api.task_id, "backlog")
        .unwrap();
    let mut events = f.bus.sender().subscribe();
    f.poll(PollScope::TaskLinkReconciliation).await;
    let rows = f.links();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].ci_status.as_deref(), Some("success"));
    assert!(rows[0].readiness_updated_at.is_some());
    let actions: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
        .filter(|e| e.event_name == "task-pull-request-updated")
        .map(|e| e.payload["action"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(actions, ["linked", "updated"]);
}

#[tokio::test]
async fn same_cycle_reconciliation_and_polling_publish_one_task_detail_update() {
    let f = Fixture::new().await;
    let mut events = f.bus.sender().subscribe();
    f.poll(PollScope::Global).await;
    let updates = std::iter::from_fn(|| events.try_recv().ok())
        .filter(|e| e.event_name == "task-pull-request-updated" && e.payload["action"] == "updated")
        .count();
    assert_eq!(updates, 1);
    assert_eq!(f.links()[0].ci_status.as_deref(), Some("success"));
}
#[tokio::test]
async fn recovery_failed_execution_remains_due_and_manual_sync_bypasses_cadence() {
    let f = Fixture::new().await;
    let mut cadence = PollCadence::default();
    f.api.fail_search.store(true, Ordering::SeqCst);
    let failed = f.poll(PollScope::TaskLinkReconciliation).await;
    assert_eq!(failed.outcome, PollOutcome::Failed);
    cadence.record(&PollScope::TaskLinkReconciliation, failed.outcome, 1_000);
    assert!(f.links().is_empty());
    let plan = cadence.plan(
        &reported_ctx(true, None, false),
        PollSchedulerSnapshot::default(),
        60,
        1_060,
    );
    assert!(plan.scopes.iter().any(PollScope::refreshes_task_links));
    f.api.fail_search.store(false, Ordering::SeqCst);
    let recovered = f.poll(PollScope::TaskLinkReconciliation).await;
    assert_eq!(recovered.outcome, PollOutcome::Completed);
    cadence.record(&PollScope::TaskLinkReconciliation, recovered.outcome, 1_060);
    assert!(!cadence
        .plan(
            &reported_ctx(true, None, false),
            PollSchedulerSnapshot::default(),
            60,
            1_061
        )
        .scopes
        .iter()
        .any(PollScope::refreshes_task_links));
    let before = f.api.authored_searches.load(Ordering::SeqCst);
    f.poll(PollScope::Global).await;
    assert_eq!(f.api.authored_searches.load(Ordering::SeqCst), before + 1);
    assert_eq!(f.links().len(), 1);
}

#[tokio::test]
async fn recovery_retries_when_authored_search_details_are_incomplete() {
    let f = Fixture::new().await;
    f.api.fail_details.store(true, Ordering::SeqCst);
    assert_eq!(
        f.poll(PollScope::TaskLinkReconciliation).await.outcome,
        PollOutcome::Failed
    );
    assert!(f.links().is_empty());
    f.api.fail_details.store(false, Ordering::SeqCst);
    assert_eq!(
        f.poll(PollScope::TaskLinkReconciliation).await.outcome,
        PollOutcome::Completed
    );
    assert_eq!(f.links().len(), 1);
}

#[tokio::test]
async fn linked_pr_status_polling_observes_external_ci_review_comments_and_merge_without_discovery()
{
    let f = Fixture::new().await;
    assert_eq!(
        f.poll(PollScope::TaskLinkReconciliation).await.outcome,
        PollOutcome::Completed
    );
    let searches = f.api.authored_searches.load(Ordering::SeqCst);
    f.api.external_stage.store(1, Ordering::SeqCst);
    let reviews_before = f.api.review_requests.load(Ordering::SeqCst);
    let changed = f.poll(PollScope::InactiveTaskPrs(None)).await;
    assert_eq!(changed.outcome, PollOutcome::Completed);
    assert!(changed.new_comments > 0);
    assert_eq!(changed.ci_changes, 1);
    assert_eq!(changed.review_changes, 1);
    assert_eq!(
        f.api.review_requests.load(Ordering::SeqCst) - reviews_before,
        1,
        "one detail refresh should retrieve PR reviews once"
    );
    let links = f.links();
    assert_eq!(links[0].ci_status.as_deref(), Some("failure"));
    assert_eq!(links[0].review_status.as_deref(), Some("approved"));
    let comments = acquire_db(&f.db)
        .get_comments_for_pr(links[0].id)
        .expect("read persisted comments");
    assert_eq!(
        comments
            .iter()
            .map(|comment| (
                comment.id,
                comment.comment_type.as_str(),
                comment.body.as_str(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (-81, "review_body", "Looks good"),
            (82, "issue_comment", "External comment"),
        ]
    );
    let reviewers: Vec<crate::github_client::PrReviewer> =
        serde_json::from_str(links[0].reviewers.as_deref().expect("persisted reviewers"))
            .expect("parse persisted reviewers");
    assert_eq!(
        reviewers,
        vec![crate::github_client::PrReviewer {
            login: "reviewer".to_string(),
            kind: crate::github_client::PrReviewerKind::User,
            state: crate::github_client::PrReviewerState::Approved,
        }]
    );
    f.api.external_stage.store(2, Ordering::SeqCst);
    let merged = f.poll(PollScope::InactiveTaskPrs(None)).await;
    assert_eq!(merged.outcome, PollOutcome::Completed);
    assert_eq!(merged.pr_changes, 1);
    assert_eq!(f.links()[0].state, "merged");
    assert_eq!(f.api.authored_searches.load(Ordering::SeqCst), searches);
}

#[tokio::test]
async fn recovery_respects_backoff_set_by_activity_discovery() {
    let f = Fixture::new().await;
    let deadline = current_unix_timestamp().unwrap() + 120;
    f.client.set_last_rate_limit_reset(Some(deadline));
    let result = f.poll(PollScope::TaskLinkReconciliation).await;
    assert_eq!(result.outcome, PollOutcome::RateLimited);
    assert_eq!(result.rate_limit_reset_at, Some(deadline));
    assert_eq!(f.api.requests.load(Ordering::SeqCst), 0);
    assert!(f.links().is_empty());
}
