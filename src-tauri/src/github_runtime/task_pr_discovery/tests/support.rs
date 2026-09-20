use super::*;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use std::collections::VecDeque;
use tokio::sync::{Notify, Semaphore};

pub(in crate::github_runtime::task_pr_discovery) struct Api {
    pub calls: Mutex<Vec<i64>>,
    pub started: Notify,
    pub branches: Mutex<Vec<(String, String, String, usize)>>,
    pub branch_prs: Mutex<Option<Vec<serde_json::Value>>>,
    pub gate: Semaphore,
    pub statuses: Mutex<VecDeque<u16>>,
    pub body: Mutex<serde_json::Value>,
    pub retry_after: Mutex<Option<String>>,
}
async fn response(
    State(api): State<Arc<Api>>,
    Path(number): Path<i64>,
    headers: HeaderMap,
) -> impl IntoResponse {
    assert_eq!(headers["authorization"], "token test-token");
    api.calls.lock().unwrap().push(number);
    api.started.notify_one();
    api.gate.acquire().await.unwrap().forget();
    let status = api.statuses.lock().unwrap().pop_front().unwrap_or(200);
    let mut body = api.body.lock().unwrap().clone();
    body["number"] = number.into();
    body["id"] = (500 + number).into();
    let mut headers = HeaderMap::new();
    if let Some(retry) = api.retry_after.lock().unwrap().as_ref() {
        headers.insert("retry-after", retry.parse().unwrap());
    }
    (StatusCode::from_u16(status).unwrap(), headers, Json(body))
}
async fn branch_response(
    State(api): State<Arc<Api>>,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    assert_eq!(headers["authorization"], "token test-token");
    assert_eq!(query["state"], "open");
    assert_eq!(query["per_page"], "100");
    let head = query["head"].clone();
    let page: usize = query["page"].parse().unwrap();
    api.branches
        .lock()
        .unwrap()
        .push((owner.clone(), repo.clone(), head.clone(), page));
    api.calls.lock().unwrap().push(0);
    api.started.notify_one();
    api.gate.acquire().await.unwrap().forget();
    let status = api.statuses.lock().unwrap().pop_front().unwrap_or(200);
    let body = api
        .branch_prs
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| vec![api.body.lock().unwrap().clone()]);
    let body: Vec<_> = body
        .into_iter()
        .filter(|pr| {
            pr["base"]["repo"]["full_name"] == format!("{owner}/{repo}")
                && format!(
                    "{}:{}",
                    pr["head"]["repo"]["full_name"]
                        .as_str()
                        .unwrap()
                        .split('/')
                        .next()
                        .unwrap(),
                    pr["head"]["ref"].as_str().unwrap()
                ) == head
        })
        .skip((page - 1) * 100)
        .take(100)
        .collect();
    let mut headers = HeaderMap::new();
    if let Some(retry) = api.retry_after.lock().unwrap().as_ref() {
        headers.insert("retry-after", retry.parse().unwrap());
    }
    (StatusCode::from_u16(status).unwrap(), headers, Json(body))
}
pub(crate) struct Fixture {
    pub dir: tempfile::TempDir,
    _db_dir: tempfile::TempDir,
    pub db: Arc<Mutex<Database>>,
    pub task_id: String,
    pub project_id: String,
    pub local: LocalDiscovery,
    pub discovery: Discovery,
    pub bus: AppEventBus,
    pub(in crate::github_runtime::task_pr_discovery) api: Arc<Api>,
    pub client: GitHubClient,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Fixture {
    pub async fn new(blocked: bool, token: Option<&str>) -> Self {
        Self::with_clock(blocked, token, Arc::new(super::super::clock::SystemClock)).await
    }
    pub(in crate::github_runtime::task_pr_discovery) async fn with_clock(
        blocked: bool,
        token: Option<&str>,
        clock: Arc<dyn super::super::clock::Clock>,
    ) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let signature = git2::Signature::now("test", "test@example.com").unwrap();
        repo.commit(
            Some("refs/heads/task-branch"),
            &signature,
            &signature,
            "initial",
            &repo.find_tree(tree_id).unwrap(),
            &[],
        )
        .unwrap();
        repo.set_head("refs/heads/task-branch").unwrap();
        repo.remote("origin", "git@github.com:acme/widgets.git")
            .unwrap();
        let (db, db_dir) = make_test_db("local_pr_discovery");
        let path = dir.path().to_str().unwrap();
        let project = db.create_project("test", path).unwrap();
        let task = db
            .create_task("new PR", "doing", Some(&project.id), None, None)
            .unwrap();
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            path,
            path,
            "worktree",
            Some("task-branch"),
            "pi",
        )
        .unwrap();
        let api = Arc::new(Api {
            calls: Mutex::new(vec![]),
            branches: Mutex::new(vec![]),
            branch_prs: Mutex::new(None),
            started: Notify::new(),
            gate: Semaphore::new(if blocked { 0 } else { 1024 }),
            statuses: Mutex::new(VecDeque::new()),
            retry_after: Mutex::new(None),
            body: Mutex::new(serde_json::json!({
                "id":542, "number":42, "title":"verified", "state":"open", "draft":true,
                "html_url":"https://github.com/acme/widgets/pull/42", "user":{"login":"other"},
                "head":{"ref":"task-branch", "sha":"abc", "repo":{"full_name":"acme/widgets"}},
                "base":{"ref":"main", "repo":{"full_name":"acme/widgets"}}
            })),
        });
        let router = Router::new()
            .route("/repos/acme/widgets/pulls/:number", get(response))
            .route("/repos/:owner/:repo/pulls", get(branch_response))
            .with_state(api.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let client = GitHubClient::with_test_token(Ok(token.map(str::to_owned)))
            .with_test_api_base_url(format!("http://{address}"));
        let db = Arc::new(Mutex::new(db));
        let bus = AppEventBus::new(512, 16);
        let local = LocalDiscovery::default();
        let discovery = Discovery::with_clock(
            db.clone(),
            client.clone(),
            RuntimeEventPublisher::new(None, Some(bus.sender())),
            clock,
        );
        local.configure(discovery.clone());
        local.register("registered-shell", &task.id, dir.path().to_path_buf(), 1);
        Self {
            dir,
            _db_dir: db_dir,
            db,
            task_id: task.id,
            project_id: project.id,
            local,
            discovery,
            bus,
            api,
            client,
            server,
        }
    }
    pub(crate) fn release_requests(&self, count: usize) {
        self.api.gate.add_permits(count);
    }
    pub fn output(&self, number: i64) {
        self.local
            .observer("registered-shell", 1)
            .unwrap()
            .output(&format!("https://github.com/acme/widgets/pull/{number}\n"));
    }
    pub async fn calls(&self, count: usize) {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let notified = self.api.started.notified();
                if self.api.calls.lock().unwrap().len() >= count {
                    break;
                }
                notified.await;
            }
        })
        .await
        .expect("expected GitHub requests");
    }
}
