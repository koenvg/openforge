use super::GitHubClient;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::{collections::HashMap, sync::Arc};

fn search_item(number: i64) -> serde_json::Value {
    serde_json::json!({
        "id": number, "number": number, "title": "A pull request", "state": "open",
        "draft": false, "html_url": format!("https://github.com/acme/widgets/pull/{number}"),
        "user": {"login": "alice"}, "repository_url": "https://api.github.com/repos/acme/widgets",
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
    })
}

async fn search_page(
    State(pages): State<Arc<Vec<serde_json::Value>>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let page = query
        .get("page")
        .map(|s| s.parse::<usize>().unwrap())
        .unwrap_or(1);
    match pages.get(page - 1) {
        Some(body) => Json(body.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn detail(Path(number): Path<i64>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "number": number, "title": "A pull request", "state": "open",
        "html_url": format!("https://github.com/acme/widgets/pull/{number}"),
        "user": {"login": "alice"}, "head": {"ref": "feature", "sha": "abc"},
        "base": {"ref": "main"}, "draft": false
    }))
}

async fn client_for(router: Router) -> GitHubClient {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    GitHubClient::new().with_test_api_base_url(format!("http://{address}"))
}

fn search_router(pages: Vec<serde_json::Value>) -> Router {
    Router::new()
        .route("/search/issues", get(search_page))
        .with_state(Arc::new(pages))
        .route("/repos/acme/widgets/pulls/:number", get(detail))
}

#[tokio::test]
async fn authored_and_review_searches_return_more_than_100_prs() {
    let client = client_for(search_router(vec![
        serde_json::json!({"total_count": 101, "incomplete_results": false,
            "items": (1..=100).map(search_item).collect::<Vec<_>>()}),
        serde_json::json!({"total_count": 101, "incomplete_results": false,
            "items": [search_item(101)]}),
    ]))
    .await;

    for review in [false, true] {
        let super::CompletePrSearchSnapshot { prs, ids } = if review {
            client.search_review_requested_prs("alice", "token").await
        } else {
            client.search_authored_prs("alice", "token").await
        }
        .unwrap();
        assert_eq!(prs.len(), 101);
        assert_eq!(ids, (1..=101).collect::<Vec<_>>());
        assert_eq!(prs.last().unwrap().number, 101);
    }
}

#[tokio::test]
async fn partial_detail_failure_is_an_error_and_retried_after_search_304() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let attempts = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route("/repos/acme/widgets/pulls/:number", get(detail))
        .route(
            "/search/issues",
            get(|headers: HeaderMap| async move {
                if headers.contains_key("if-none-match") {
                    StatusCode::NOT_MODIFIED.into_response()
                } else {
                    (
                        [("etag", "search-v1")],
                        Json(serde_json::json!({
                            "total_count": 2, "incomplete_results": false,
                            "items": [search_item(1), search_item(2)]
                        })),
                    )
                        .into_response()
                }
            }),
        )
        .route(
            "/repos/acme/widgets/pulls/2",
            get(move || {
                let attempts = Arc::clone(&attempts);
                async move {
                    if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                        StatusCode::BAD_GATEWAY.into_response()
                    } else {
                        detail(Path(2)).await.into_response()
                    }
                }
            }),
        );
    let client = client_for(router).await;
    assert!(client.search_authored_prs("alice", "token").await.is_err());
    let super::CompletePrSearchSnapshot { prs, ids } =
        client.search_authored_prs("alice", "token").await.unwrap();
    assert_eq!(prs.len(), 2);
    assert_eq!(ids, vec![1, 2]);
}

#[tokio::test]
async fn incomplete_searches_never_return_a_successful_snapshot() {
    for pages in [
        vec![serde_json::json!({"total_count": 0, "incomplete_results": true, "items": []})],
        vec![serde_json::json!({"total_count": 1001, "items": []})],
        vec![serde_json::json!({"total_count": 1, "items": []})],
        vec![serde_json::json!({"total_count": 2, "items": [search_item(1), search_item(1)]})],
        vec![
            serde_json::json!({"total_count": 2, "items": [search_item(1)]}),
            serde_json::json!({"total_count": 1, "items": [search_item(2)]}),
        ],
    ] {
        let client = client_for(search_router(pages)).await;
        for review in [false, true] {
            let result = if review {
                client.search_review_requested_prs("alice", "token").await
            } else {
                client.search_authored_prs("alice", "token").await
            };
            let error = result.expect_err("incomplete search must fail closed");
            assert!(error.to_string().contains("Incomplete search"), "{error}");
        }
    }
}

#[tokio::test]
async fn malformed_repository_does_not_turn_a_nonempty_search_into_empty_success() {
    let mut item = search_item(1);
    item["repository_url"] = "invalid".into();
    let client = client_for(search_router(vec![
        serde_json::json!({"total_count": 1, "items": [item]}),
    ]))
    .await;
    assert!(client
        .search_review_requested_prs("alice", "token")
        .await
        .is_err());
}

#[tokio::test]
async fn first_page_304_does_not_hide_changed_later_pages_or_details() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let later_page = Arc::new(AtomicUsize::new(101));
    let router = Router::new()
        .route("/search/issues", get(move |Query(query): Query<HashMap<String, String>>, headers: HeaderMap| {
            let later_page = Arc::clone(&later_page);
            async move {
                if query.get("page").map(String::as_str) == Some("2") {
                    let number = later_page.fetch_add(1, Ordering::SeqCst) as i64;
                    return Json(serde_json::json!({"total_count": 101, "items": [search_item(number)]})).into_response();
                }
                if headers.contains_key("if-none-match") {
                    return StatusCode::NOT_MODIFIED.into_response();
                }
                ([("etag", "page-one")], Json(serde_json::json!({
                    "total_count": 101, "items": (1..=100).map(search_item).collect::<Vec<_>>()
                }))).into_response()
            }
        }))
        .route("/repos/acme/widgets/pulls/:number", get(|Path(number): Path<i64>, headers: HeaderMap| async move {
            // PR 1 changes after its first fetch. Other details are unchanged.
            if headers.contains_key("if-none-match") && number != 1 {
                return StatusCode::NOT_MODIFIED.into_response();
            }
            let mut body = detail(Path(number)).await.0;
            if headers.contains_key("if-none-match") {
                body["head"]["sha"] = "changed".into();
            }
            ([("etag", "detail-v1")], Json(body)).into_response()
        }));
    let client = client_for(router).await;
    let super::CompletePrSearchSnapshot {
        prs: first,
        ids: first_ids,
    } = client.search_authored_prs("alice", "token").await.unwrap();
    assert_eq!(first.len(), 101);
    assert_eq!(first_ids.last(), Some(&101));
    let super::CompletePrSearchSnapshot {
        prs: next,
        ids: next_ids,
    } = client.search_authored_prs("alice", "token").await.unwrap();
    assert_eq!(next.len(), 101);
    assert_eq!(next_ids.last(), Some(&102));
    assert!(!next_ids.contains(&101));
    assert_eq!(next[0].head_sha, "changed");
    assert_eq!(next[1].head_sha, "abc");
}

#[tokio::test]
async fn complete_empty_search_stays_successful_on_304() {
    let client = client_for(Router::new().route(
        "/search/issues",
        get(|headers: HeaderMap| async move {
            if headers.contains_key("if-none-match") {
                StatusCode::NOT_MODIFIED.into_response()
            } else {
                (
                    [("etag", "empty")],
                    Json(serde_json::json!({
                        "total_count": 0, "incomplete_results": false, "items": []
                    })),
                )
                    .into_response()
            }
        }),
    ))
    .await;
    for _ in 0..2 {
        let snapshot = client
            .search_review_requested_prs("alice", "token")
            .await
            .unwrap();
        assert!(snapshot.prs.is_empty());
        assert!(snapshot.ids.is_empty());
    }
}

#[tokio::test]
async fn search_304_without_a_cached_body_is_an_error() {
    let client = client_for(
        Router::new().route("/search/issues", get(|| async { StatusCode::NOT_MODIFIED })),
    )
    .await;
    assert!(client.search_authored_prs("alice", "token").await.is_err());
}

#[tokio::test]
async fn failure_on_later_search_page_is_not_a_partial_success() {
    let client = client_for(search_router(vec![serde_json::json!({
        "total_count": 101, "items": (1..=100).map(search_item).collect::<Vec<_>>()
    })]))
    .await;
    assert!(client.search_authored_prs("alice", "token").await.is_err());
}
