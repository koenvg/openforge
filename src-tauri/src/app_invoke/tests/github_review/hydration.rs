use super::*;
use crate::github_client::hydration_test_api::HydrationApi;
use crate::http_server::AppState;
use tokio::sync::broadcast::Receiver;

struct Fixture {
    state: AppState,
    _dir: tempfile::TempDir,
    task: String,
    api: Arc<HydrationApi>,
    events: Receiver<crate::app_events::AppEventEnvelope>,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let (mut state, dir) = test_state("manual_link_hydration");
        let task = state
            .db
            .lock()
            .unwrap()
            .create_task("Hidden task", "backlog", None, None, None)
            .unwrap()
            .id;
        let api = HydrationApi::new();
        let (client, server) = api.client().await;
        state.github_client = client;
        let (tx, events) = tokio::sync::broadcast::channel(64);
        state.app_event_tx = Some(tx);
        Self {
            state,
            _dir: dir,
            task,
            api,
            events,
            server,
        }
    }
    async fn link(&self) -> serde_json::Value {
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            invoke_ok(
                &self.state,
                "link_pull_request",
                json!({"taskId":self.task,"prUrl":"https://github.com/acme/widgets/pull/7"}),
            ),
        )
        .await
        .expect("link must not wait for details")
    }
    async fn rows(&self) -> serde_json::Value {
        invoke_ok(
            &self.state,
            "get_pull_requests",
            json!({"taskId":self.task}),
        )
        .await
    }
    async fn updated(&mut self) {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let event = self.events.recv().await.unwrap();
                if event.event_name == "task-pull-request-updated"
                    && event.payload["action"] == "updated"
                {
                    break;
                }
            }
        })
        .await
        .expect("details must publish a persisted-data update without a poll tick");
    }
    async fn started(&self) {
        tokio::time::timeout(
            std::time::Duration::from_secs(3),
            self.api.started.notified(),
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn manual_link_is_visible_before_details_and_populates_without_refresh() {
    let mut f = Fixture::new().await;
    {
        let mut details = f.api.details.lock().unwrap();
        details["state"] = json!("closed");
        details["merged"] = json!(true);
        details["merged_at"] = json!("2026-09-17T08:00:00Z");
    }
    let linked = f.link().await;
    assert_eq!(linked["title"], "acme/widgets#7");
    assert_eq!(f.events.try_recv().unwrap().payload["action"], "linked");
    f.api.gate.add_permits(1);
    f.updated().await;
    let rows = f.rows().await;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["title"], "Canonical title");
    assert_eq!(rows[0]["github_node_id"], "PR_node_70");
    assert_eq!(rows[0]["head_sha"], "new-head");
    assert_eq!(rows[0]["state"], "merged");
    assert_eq!(rows[0]["draft"], true);
    let reviewers: serde_json::Value =
        serde_json::from_str(rows[0]["reviewers"].as_str().unwrap()).unwrap();
    assert_eq!(reviewers[0]["login"], "reviewer");
    assert_ne!(rows[0]["merge_readiness_status"], "ready_to_merge");
    let comments = invoke_ok(&f.state, "get_pr_comments", json!({"prId":rows[0]["id"]})).await;
    assert_eq!(comments[0]["body"], "Useful comment");
}

#[tokio::test]
async fn duplicate_link_and_overlapping_manual_refresh_share_detail_requests() {
    let mut f = Fixture::new().await;
    f.link().await;
    f.started().await;
    f.link().await;
    let refresh = invoke_ok(
        &f.state,
        "refresh_task_github_status",
        json!({"taskId":f.task}),
    );
    let release = async {
        tokio::task::yield_now().await;
        f.api.gate.add_permits(10);
    };
    tokio::join!(refresh, release);
    f.updated().await;
    // Taking the shared permit waits for all earlier queued work.
    let _permit = f.state.github_client.acquire_refresh_permit().await;
    assert_eq!(f.api.calls.load(Ordering::SeqCst), 1);
    assert_eq!(f.rows().await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn late_hydration_cannot_write_reassigned_deleted_or_newer_head_associations() {
    for race in ["reassigned", "deleted", "head"] {
        let f = Fixture::new().await;
        let linked = f.link().await;
        f.started().await;
        let id = linked["id"].as_i64().unwrap();
        match race {
            "reassigned" => {
                let other = f
                    .state
                    .db
                    .lock()
                    .unwrap()
                    .create_task("Other", "backlog", None, None, None)
                    .unwrap();
                crate::github_runtime::link_pull_request(
                    &f.state.db,
                    &other.id,
                    "https://github.com/acme/widgets/pull/7",
                )
                .unwrap();
            }
            "deleted" => f
                .state
                .db
                .lock()
                .unwrap()
                .hard_delete_task(&f.task)
                .unwrap(),
            _ => f
                .state
                .db
                .lock()
                .unwrap()
                .update_pr_ci_status(id, "newer-head", "failure", "[]")
                .unwrap(),
        }
        f.api.gate.add_permits(1);
        let _permit = f.state.github_client.acquire_refresh_permit().await;
        let rows = invoke_ok(&f.state, "get_pull_requests", serde_json::Value::Null).await;
        if race == "deleted" {
            assert!(rows.as_array().unwrap().is_empty());
        } else {
            assert_eq!(rows[0]["title"], "acme/widgets#7", "{race}");
            if race == "head" {
                assert_eq!(rows[0]["head_sha"], "newer-head");
                assert_eq!(rows[0]["ci_status"], "failure");
            }
            let comments = invoke_ok(&f.state, "get_pr_comments", json!({"prId":id})).await;
            assert!(comments.as_array().unwrap().is_empty(), "{race}");
        }
    }
}

#[tokio::test]
async fn partial_fetch_preserves_comments_and_still_updates_available_details() {
    let mut f = Fixture::new().await;
    f.link().await;
    f.api.gate.add_permits(1);
    f.updated().await;
    *f.api.comments_status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    f.api.details.lock().unwrap()["title"] = json!("Updated despite comment outage");
    f.api.gate.add_permits(1);
    invoke_ok(
        &f.state,
        "refresh_task_github_status",
        json!({"taskId":f.task}),
    )
    .await;
    let rows = f.rows().await;
    assert_eq!(rows[0]["title"], "Updated despite comment outage");
    let comments = invoke_ok(&f.state, "get_pr_comments", json!({"prId":rows[0]["id"]})).await;
    assert_eq!(comments[0]["body"], "Useful comment");
    assert_ne!(rows[0]["merge_readiness_status"], "ready_to_merge");
}

#[tokio::test]
async fn failed_initial_fetch_preserves_link_and_manual_refresh_recovers_without_relink_retries() {
    let mut f = Fixture::new().await;
    *f.api.status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    let linked = f.link().await;
    f.started().await;
    f.api.gate.add_permits(1);
    {
        let _permit = f.state.github_client.acquire_refresh_permit().await;
    }
    assert_eq!(f.rows().await[0]["id"], linked["id"]);
    assert_eq!(f.rows().await[0]["title"], "acme/widgets#7");
    f.link().await;
    tokio::task::yield_now().await;
    f.api.gate.add_permits(10);
    {
        let _permit = f.state.github_client.acquire_refresh_permit().await;
    }
    assert_eq!(
        f.api.calls.load(Ordering::SeqCst),
        1,
        "a repeated association signal is not a retry"
    );
    *f.api.status.lock().unwrap() = StatusCode::OK;
    invoke_ok(
        &f.state,
        "refresh_task_github_status",
        json!({"taskId":f.task}),
    )
    .await;
    f.updated().await;
    assert_eq!(f.rows().await[0]["title"], "Canonical title");
}

#[tokio::test]
async fn automatic_hydration_respects_rate_limit_set_while_waiting_for_capacity() {
    let f = Fixture::new().await;
    let permit = f.state.github_client.acquire_refresh_permit().await;
    let linked = f.link().await;
    tokio::task::yield_now().await;
    let reset = crate::unix_timestamp::seconds(std::time::SystemTime::now()).unwrap() + 3600;
    f.state.github_client.set_last_rate_limit_reset(Some(reset));
    drop(permit);
    let _permit = f.state.github_client.acquire_refresh_permit().await;
    assert_eq!(f.api.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.state.github_client.get_last_rate_limit_reset(),
        Some(reset)
    );
    assert_eq!(f.rows().await[0]["id"], linked["id"]);
}

#[tokio::test]
async fn a_new_head_never_inherits_successful_ci_when_its_checks_fail_to_load() {
    let mut f = Fixture::new().await;
    let linked = f.link().await;
    f.api.gate.add_permits(1);
    f.updated().await;
    f.state
        .db
        .lock()
        .unwrap()
        .update_pr_ci_status(linked["id"].as_i64().unwrap(), "old-head", "success", "[]")
        .unwrap();
    *f.api.checks_status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    f.api.gate.add_permits(1);
    invoke_ok(
        &f.state,
        "refresh_task_github_status",
        json!({"taskId":f.task}),
    )
    .await;
    let rows = f.rows().await;
    assert_eq!(rows[0]["head_sha"], "new-head");
    assert_ne!(rows[0]["ci_status"], "success");
    assert_ne!(rows[0]["merge_readiness_status"], "ready_to_merge");
}

#[tokio::test]
async fn manual_links_to_existing_closed_or_merged_prs_still_load_details() {
    for terminal in ["closed", "merged"] {
        let mut f = Fixture::new().await;
        let other = f
            .state
            .db
            .lock()
            .unwrap()
            .create_task("Previous owner", "backlog", None, None, None)
            .unwrap();
        f.state
            .db
            .lock()
            .unwrap()
            .insert_pull_request_with_number(
                70,
                7,
                &other.id,
                "acme",
                "widgets",
                "Old title",
                "https://github.com/acme/widgets/pull/7",
                terminal,
                1,
                1,
                false,
            )
            .unwrap();
        f.api.details.lock().unwrap()["state"] = json!("closed");
        let linked = f.link().await;
        assert_eq!(linked["state"], terminal);
        f.api.gate.add_permits(1);
        f.updated().await;
        let rows = f.rows().await;
        assert_eq!(rows[0]["title"], "Canonical title");
        assert_eq!(rows[0]["state"], terminal);
        assert_eq!(rows[0]["head_sha"], "new-head");
    }
}

#[tokio::test]
async fn a_canonical_replacement_never_gets_overwritten_by_a_late_synthetic_result() {
    let f = Fixture::new().await;
    f.link().await;
    f.started().await;
    {
        let db = f.state.db.lock().unwrap();
        db.associate_pull_request_automatically(crate::db::AutomaticPr {
            id: 70,
            number: 7,
            task_id: &f.task,
            owner: "acme",
            repo: "widgets",
            title: "Newer canonical title",
            url: "https://github.com/acme/widgets/pull/7",
            state: "open",
            now: 2,
            draft: false,
        })
        .unwrap();
        db.update_pr_ci_status(70, "newer-head", "failure", "[]")
            .unwrap();
    }
    f.api.gate.add_permits(1);
    let _permit = f.state.github_client.acquire_refresh_permit().await;
    let rows = f.rows().await;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["id"], 70);
    assert_eq!(rows[0]["title"], "Newer canonical title");
    assert_eq!(rows[0]["head_sha"], "newer-head");
}

#[tokio::test]
async fn hydration_stops_new_requests_after_github_reports_a_rate_limit() {
    let f = Fixture::new().await;
    *f.api.comments_status.lock().unwrap() = StatusCode::TOO_MANY_REQUESTS;
    f.api.gate.add_permits(10);
    f.link().await;
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        f.api.comments_started.notified(),
    )
    .await
    .unwrap();
    let _permit = f.state.github_client.acquire_refresh_permit().await;
    assert_eq!(
        f.api.calls.load(Ordering::SeqCst),
        0,
        "no detail request after rate-limit response"
    );
    assert!(f.state.github_client.get_last_rate_limit_reset().is_some());
    assert_eq!(f.rows().await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn available_comments_survive_when_all_other_detail_sources_fail() {
    let f = Fixture::new().await;
    *f.api.status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    *f.api.reviews_status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    let linked = f.link().await;
    f.started().await;
    f.api.gate.add_permits(1);
    let _permit = f.state.github_client.acquire_refresh_permit().await;
    let comments = invoke_ok(&f.state, "get_pr_comments", json!({"prId":linked["id"]})).await;
    assert_eq!(comments[0]["body"], "Useful comment");
    assert_eq!(f.rows().await[0]["title"], "acme/widgets#7");
}
