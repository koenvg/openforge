//! Fake GitHub boundary shared by link, discovery, and recovery integration tests.
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tokio::sync::{Notify, Semaphore};

pub(crate) struct HydrationApi {
    pub details: Mutex<Value>,
    pub gate: Semaphore,
    pub started: Notify,
    pub comments_started: Notify,
    pub calls: AtomicUsize,
    pub status: Mutex<StatusCode>,
    pub checks_status: Mutex<StatusCode>,
    pub comments_status: Mutex<StatusCode>,
    pub reviews_status: Mutex<StatusCode>,
}
impl HydrationApi {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            details: Mutex::new(
                json!({"id":70,"node_id":"PR_node_70","number":7,"title":"Canonical title","state":"open",
                "html_url":"https://github.com/acme/widgets/pull/7","user":{"login":"author"},
                "head":{"sha":"new-head","ref":"feature"},"base":{"ref":"main"},
                "draft":true,"requested_reviewers":[{"login":"reviewer"}]}),
            ),
            gate: Semaphore::new(0),
            started: Notify::new(),
            comments_started: Notify::new(),
            calls: AtomicUsize::new(0),
            status: Mutex::new(StatusCode::OK),
            comments_status: Mutex::new(StatusCode::OK),
            reviews_status: Mutex::new(StatusCode::OK),
            checks_status: Mutex::new(StatusCode::OK),
        })
    }
    pub fn router(self: &Arc<Self>) -> Router {
        Router::new()
            .route("/repos/acme/widgets/pulls/7", get(details))
            .route(
                "/repos/acme/widgets/commits/new-head/check-runs",
                get(checks),
            )
            .route(
                "/repos/acme/widgets/commits/new-head/status",
                get(|| async { Json(json!({"state":"success","statuses":[]})) }),
            )
            .route("/repos/acme/widgets/issues/7/comments", get(comments))
            .route(
                "/repos/acme/widgets/pulls/7/comments",
                get(|| async { Json(json!([])) }),
            )
            .route(
                "/repos/acme/widgets/pulls/7/reviews",
                get(|State(api): State<Arc<HydrationApi>>| async move {
                    (*api.reviews_status.lock().unwrap(), Json(json!([])))
                }),
            )
            .with_state(self.clone())
    }
    pub async fn client(self: &Arc<Self>) -> (super::GitHubClient, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = super::GitHubClient::with_test_token(Ok(Some("token".into())))
            .with_test_api_base_url(format!("http://{}", listener.local_addr().unwrap()));
        let router = self.router();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (client, server)
    }
}
async fn details(State(api): State<Arc<HydrationApi>>) -> (StatusCode, Json<Value>) {
    api.calls.fetch_add(1, Ordering::SeqCst);
    api.started.notify_one();
    api.gate.acquire().await.unwrap().forget();
    let status = *api.status.lock().unwrap();
    let body = api.details.lock().unwrap().clone();
    (status, Json(body))
}
async fn comments(
    State(api): State<Arc<HydrationApi>>,
) -> (StatusCode, axum::http::HeaderMap, Json<Value>) {
    api.comments_started.notify_one();
    let status = *api.comments_status.lock().unwrap();
    let mut headers = axum::http::HeaderMap::new();
    if status == StatusCode::TOO_MANY_REQUESTS {
        headers.insert("retry-after", "3600".parse().unwrap());
    }
    (
        status,
        headers,
        Json(
            json!([{"id":701,"body":"Useful comment","user":{"login":"reviewer"},"created_at":"2026-09-17T08:00:00Z","updated_at":"2026-09-17T08:00:00Z"}]),
        ),
    )
}
async fn checks(State(api): State<Arc<HydrationApi>>) -> (StatusCode, Json<Value>) {
    (
        *api.checks_status.lock().unwrap(),
        Json(json!({"total_count":0,"check_runs":[]})),
    )
}
