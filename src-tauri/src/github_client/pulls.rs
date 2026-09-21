use base64::{engine::general_purpose, Engine as _};
use futures::future::join_all;
use log::warn;
use reqwest::header::{HeaderMap, LINK};

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

fn normalize_base64_content(content: &str) -> String {
    content.replace('\n', "")
}

fn bounded_base64_content(blob: BlobResponse, max_size: Option<usize>) -> Base64FileContent {
    let too_large = max_size.is_some_and(|limit| blob.size > limit);
    Base64FileContent {
        content: if too_large {
            String::new()
        } else {
            normalize_base64_content(&blob.content)
        },
        size: blob.size,
        too_large,
    }
}

fn decode_base64_content(content: &str) -> Result<String, GitHubError> {
    let decoded = general_purpose::STANDARD
        .decode(normalize_base64_content(content))
        .map_err(|e| GitHubError::ParseError(format!("Base64 decode error: {}", e)))?;

    String::from_utf8(decoded)
        .map_err(|e| GitHubError::ParseError(format!("UTF-8 decode error: {}", e)))
}

fn review_requested_pr_search_url(username: &str) -> String {
    format!(
        "https://api.github.com/search/issues?q=review-requested:{}+type:pr+state:open+draft:false&per_page=100",
        username
    )
}

fn exclude_draft_search_pr_results(
    prs: Vec<SearchPrResult>,
    safe_search_ids: Vec<i64>,
) -> (Vec<SearchPrResult>, Vec<i64>) {
    let draft_ids: std::collections::HashSet<i64> =
        prs.iter().filter(|pr| pr.draft).map(|pr| pr.id).collect();
    let filtered_prs = prs.into_iter().filter(|pr| !pr.draft).collect();
    let filtered_safe_search_ids = safe_search_ids
        .into_iter()
        .filter(|id| !draft_ids.contains(id))
        .collect();

    (filtered_prs, filtered_safe_search_ids)
}

fn next_page_url(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(LINK)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .find_map(|link| {
            let mut parts = link.split(';');
            let url = parts.next()?.trim().strip_prefix('<')?.strip_suffix('>')?;
            parts
                .any(|part| part.trim() == "rel=\"next\"")
                .then(|| url.to_string())
        })
}

fn review_body_comment(review: &PrReview) -> Option<PrComment> {
    let body = review
        .body
        .as_ref()
        .filter(|body| !body.is_empty())?
        .clone();

    Some(PrComment {
        id: -review.id,
        body,
        user: review.user.clone(),
        path: None,
        line: None,
        comment_type: "review_body".to_string(),
        outdated: false,
        in_reply_to_id: None,
        created_at: review.submitted_at.clone().unwrap_or_default(),
    })
}

fn append_review_body_comments(
    all_comments: &mut Vec<PrComment>,
    reviews: Result<&[PrReview], &GitHubError>,
    pr_number: i64,
    since: Option<&str>,
) {
    let reviews = reviews.unwrap_or_else(|error| {
        warn!(
            "[GitHub] Failed to fetch reviews for PR #{}: {}",
            pr_number,
            error.sanitized_log_message()
        );
        &[]
    });

    for review in reviews {
        let Some(comment) = review_body_comment(review) else {
            continue;
        };
        if !comment.created_at.is_empty()
            && since.is_some_and(|timestamp| comment.created_at.as_str() < timestamp)
        {
            continue;
        }
        all_comments.push(comment);
    }
}

impl GitHubClient {
    /// Fetch every open PR for a qualified head, including drafts and all authors.
    pub(crate) async fn open_prs_by_head(
        &self,
        owner: &str,
        repo: &str,
        head: &str,
        token: &str,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        let endpoint = format!("https://api.github.com/repos/{owner}/{repo}/pulls");
        let mut prs = Vec::new();
        // Bound pathological responses. Never return a partial, apparently unique result.
        for page in 1..=100 {
            let mut url = reqwest::Url::parse(&endpoint)
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;
            url.query_pairs_mut().extend_pairs([
                ("state", "open"),
                ("head", head),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ]);
            let response = self
                .send_github(self.github_request(reqwest::Method::GET, url.as_str(), token))
                .await?;
            if !response.status().is_success() {
                return Err(Self::api_error_from_response(response).await);
            }
            let more = next_page_url(response.headers()).is_some();
            let batch: Vec<PullRequest> = response
                .json()
                .await
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;
            let full = batch.len() == 100;
            prs.extend(batch);
            if !more && !full {
                return Ok(prs);
            }
        }
        Err(GitHubError::ParseError(
            "head lookup pagination limit exceeded".into(),
        ))
    }

    pub async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        merge_method: PullRequestMergeMethod,
        expected_head_sha: Option<&str>,
    ) -> Result<MergePrResponse, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/merge",
            owner, repo, pr_number
        );

        let request_body = MergePrRequest {
            commit_title: None,
            commit_message: None,
            merge_method,
            sha: expected_head_sha.map(ToOwned::to_owned),
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::PUT, &url, token)
                    .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }

    /// Get pull request details
    pub async fn get_pr_details(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<PullRequest, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        self.get_with_etag::<PullRequest>(&url, token).await
    }

    /// Get all PR comments (both review comments and general comments)
    ///
    /// Fetches both inline review comments (from /pulls/{number}/comments)
    /// and general issue comments (from /issues/{number}/comments), merging
    /// them into a single vector with a `comment_type` field to distinguish.
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        since: Option<&str>,
    ) -> Result<Vec<PrComment>, GitHubError> {
        self.collect_pr_comments(owner, repo, pr_number, token, since, None)
            .await
    }

    pub(crate) async fn get_pr_comments_with_collected_reviews(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        since: Option<&str>,
        reviews: &Result<Vec<PrReview>, GitHubError>,
    ) -> Result<Vec<PrComment>, GitHubError> {
        self.collect_pr_comments(owner, repo, pr_number, token, since, Some(reviews))
            .await
    }

    async fn collect_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        since: Option<&str>,
        collected_reviews: Option<&Result<Vec<PrReview>, GitHubError>>,
    ) -> Result<Vec<PrComment>, GitHubError> {
        let mut review_comments_url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments?per_page=100",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            review_comments_url.push_str(&format!("&since={}", ts));
        }

        let mut review_comments: Vec<ReviewComment> = self
            .get_with_etag::<Vec<ReviewComment>>(&review_comments_url, token)
            .await?;

        let mut issue_comments_url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments?per_page=100",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            issue_comments_url.push_str(&format!("&since={}", ts));
        }

        let mut issue_comments: Vec<IssueComment> = self
            .get_with_etag::<Vec<IssueComment>>(&issue_comments_url, token)
            .await?;

        let mut all_comments = Vec::new();

        for comment in review_comments.drain(..) {
            all_comments.push(comment.into_pr_comment());
        }

        for comment in issue_comments.drain(..) {
            all_comments.push(comment.into_pr_comment());
        }

        // Review bodies are top-level summary comments exposed only by the reviews endpoint.
        if let Some(reviews) = collected_reviews {
            append_review_body_comments(&mut all_comments, reviews.as_deref(), pr_number, since);
        } else {
            let reviews = self.get_pr_reviews(owner, repo, pr_number, token).await;
            append_review_body_comments(&mut all_comments, reviews.as_deref(), pr_number, since);
        }

        Ok(all_comments)
    }
    /// Return only complete, enriched search snapshots. Any search-page or detail
    /// failure returns an error so callers must not reconcile stale rows.
    /// GitHub limits Search to 1,000 matches; larger searches fail closed.
    async fn search_prs_with_details(
        &self,
        url: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        // Cache each raw page independently. A 304 on page one says nothing about
        // later pages or PR details, which must still be refreshed.
        let mut items = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        let mut expected_count = None;
        let mut complete = false;
        // GitHub Search exposes at most 1,000 matches, in pages of 100.
        for page in 1..=10 {
            let page_url = if page == 1 {
                url.to_string()
            } else {
                format!("{url}&page={page}")
            };
            let response = self
                .get_with_etag::<SearchResponse>(&page_url, token)
                .await?;
            if response.incomplete_results || response.total_count > 1_000 {
                return Err(GitHubError::IncompleteSearch(
                    "GitHub returned incomplete results or exceeded its 1,000-result limit".into(),
                ));
            }
            if expected_count.is_some_and(|count| count != response.total_count) {
                return Err(GitHubError::IncompleteSearch(
                    "result count changed between pages".into(),
                ));
            }
            expected_count = Some(response.total_count);
            let empty_page = response.items.is_empty();
            for item in response.items {
                if !seen_ids.insert(item.id) {
                    return Err(GitHubError::IncompleteSearch(
                        "duplicate PR across search results".into(),
                    ));
                }
                items.push(item);
            }
            if items.len() == response.total_count {
                complete = true;
                break;
            }
            if empty_page || items.len() > response.total_count {
                break;
            }
        }
        if !complete {
            return Err(GitHubError::IncompleteSearch(
                "search pages did not cover the reported result count".into(),
            ));
        }
        let all_search_ids: Vec<i64> = items.iter().map(|item| item.id).collect();
        let items_with_coords: Vec<(SearchItem, String, String)> = items
            .into_iter()
            .map(|item| {
                let repository = reqwest::Url::parse(&item.repository_url)
                    .map_err(|_| GitHubError::IncompleteSearch("invalid repository URL".into()))?;
                let parts: Vec<_> = repository.path().split('/').collect();
                if parts.len() != 4
                    || parts[1] != "repos"
                    || parts[2].is_empty()
                    || parts[3].is_empty()
                {
                    return Err(GitHubError::IncompleteSearch(
                        "invalid repository coordinates".into(),
                    ));
                }
                let owner = parts[2].to_string();
                let repo = parts[3].to_string();
                Ok((item, owner, repo))
            })
            .collect::<Result<_, GitHubError>>()?;

        let mut detail_results = Vec::with_capacity(items_with_coords.len());
        // Keep pagination from multiplying the previous 100-request fan-out.
        for batch in items_with_coords.chunks(100) {
            detail_results.extend(
                join_all(batch.iter().map(|(item, owner, repo)| {
                    self.get_pr_details(owner, repo, item.number, token)
                }))
                .await
                .into_iter()
                .collect::<Result<Vec<_>, GitHubError>>()?,
            );
        }

        let mut results = Vec::new();
        for ((item, owner, repo), pr_details) in items_with_coords.into_iter().zip(detail_results) {
            results.push(SearchPrResult {
                id: item.id,
                number: item.number,
                title: item.title,
                body: item.body,
                state: item.state,
                draft: item.draft.unwrap_or(false),
                html_url: item.html_url,
                user_login: item.user.login,
                user_avatar_url: item.user.avatar_url,
                repo_owner: owner,
                repo_name: repo,
                head_ref: pr_details.head.ref_name,
                base_ref: pr_details
                    .extra
                    .get("base")
                    .and_then(|b| b.get("ref"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("main")
                    .to_string(),
                head_sha: pr_details.head.sha,
                additions: pr_details
                    .extra
                    .get("additions")
                    .and_then(|a| a.as_i64())
                    .unwrap_or(0),
                deletions: pr_details
                    .extra
                    .get("deletions")
                    .and_then(|d| d.as_i64())
                    .unwrap_or(0),
                changed_files: pr_details
                    .extra
                    .get("changed_files")
                    .and_then(|c| c.as_i64())
                    .unwrap_or(0),
                mergeable: pr_details.mergeable,
                mergeable_state: pr_details.mergeable_state,
                created_at: item.created_at,
                updated_at: item.updated_at,
                labels: item.labels,
            });
        }

        Ok((results, all_search_ids))
    }

    /// Fetch all non-draft review requests, up to GitHub's 1,000-match search cap.
    /// Only a complete search with every detail fetched returns `Ok`, including
    /// a genuinely empty search. Errors must preserve previously stored rows.
    pub async fn search_review_requested_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        let url = review_requested_pr_search_url(username);
        let (prs, safe_search_ids) = self.search_prs_with_details(&url, token).await?;

        Ok(exclude_draft_search_pr_results(prs, safe_search_ids))
    }

    /// Fetch all open authored PRs, up to GitHub's 1,000-match search cap.
    /// Only a complete search with every detail fetched returns `Ok`, including
    /// a genuinely empty search. Errors must preserve previously stored rows.
    pub async fn search_authored_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        let url = format!(
            "https://api.github.com/search/issues?q=author:{}+type:pr+state:open&per_page=100",
            username
        );

        self.search_prs_with_details(&url, token).await
    }

    /// Get file diffs for a pull request
    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrFileDiff>, GitHubError> {
        let mut next_url = Some(format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/files?per_page=100",
            owner, repo, pr_number
        ));
        let mut files = Vec::new();

        while let Some(url) = next_url {
            let response = self.send_github(self.github_get(&url, token)).await?;
            if !response.status().is_success() {
                return Err(Self::api_error_from_response(response).await);
            }

            next_url = next_page_url(response.headers());
            let page = response
                .json::<Vec<PrFileDiff>>()
                .await
                .map_err(|error| GitHubError::ParseError(error.to_string()))?;
            files.extend(page);
        }

        Ok(files)
    }

    /// Get blob content by SHA
    pub async fn get_blob_content_base64(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
        token: &str,
        max_size: Option<usize>,
    ) -> Result<Base64FileContent, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/git/blobs/{}",
            owner, repo, sha
        );

        let response = self.send_github(self.github_get(&url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let blob: BlobResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;
        Ok(bounded_base64_content(blob, max_size))
    }

    pub async fn get_blob_content(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
        token: &str,
    ) -> Result<String, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/git/blobs/{}",
            owner, repo, sha
        );

        let response = self.send_github(self.github_get(&url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let blob: BlobResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        decode_base64_content(&blob.content)
    }

    pub async fn get_file_at_ref(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        ref_sha: &str,
        token: &str,
    ) -> Result<String, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
            owner, repo, path, ref_sha
        );

        let response = self.send_github(self.github_get(&url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let blob: BlobResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        decode_base64_content(&blob.content)
    }

    pub async fn get_file_at_ref_base64(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        ref_sha: &str,
        token: &str,
        max_size: Option<usize>,
    ) -> Result<Base64FileContent, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
            owner, repo, path, ref_sha
        );

        let response = self.send_github(self.github_get(&url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let blob: BlobResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;
        Ok(bounded_base64_content(blob, max_size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Query, State},
        http::{header::IF_NONE_MATCH, HeaderMap, HeaderValue, StatusCode},
        response::{IntoResponse, Response},
        routing::get,
        Json, Router,
    };
    use std::collections::HashMap;
    use std::sync::{atomic::AtomicUsize, Arc};

    fn pr_file_json(index: usize) -> serde_json::Value {
        serde_json::json!({
            "sha": format!("sha-{index}"),
            "filename": format!("src/file-{index}.rs"),
            "status": "modified",
            "additions": 1,
            "deletions": 0,
            "changes": 1,
            "patch": "@@ -1 +1 @@",
            "previous_filename": null
        })
    }

    async fn paginated_pr_files_response(
        Query(query): Query<HashMap<String, String>>,
    ) -> (HeaderMap, Json<serde_json::Value>) {
        if query.get("page").map(String::as_str) == Some("2") {
            return (
                HeaderMap::new(),
                Json(serde_json::json!([pr_file_json(100)])),
            );
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            "link",
            HeaderValue::from_static(
                "<https://api.github.com/repos/acme/widgets/pulls/7/files?per_page=100&page=2>; rel=\"next\"",
            ),
        );
        let files = (0..100).map(pr_file_json).collect::<Vec<_>>();
        (headers, Json(serde_json::Value::Array(files)))
    }

    #[derive(Default)]
    struct ChangingSecondPage {
        page_two_requests: AtomicUsize,
    }

    async fn changing_paginated_pr_files_response(
        State(state): State<Arc<ChangingSecondPage>>,
        Query(query): Query<HashMap<String, String>>,
        request_headers: HeaderMap,
    ) -> Response {
        if query.get("page").map(String::as_str) == Some("2") {
            let request_index = state
                .page_two_requests
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            return Json(serde_json::json!([pr_file_json(100 + request_index)])).into_response();
        }

        if request_headers.contains_key(IF_NONE_MATCH) {
            return StatusCode::NOT_MODIFIED.into_response();
        }

        let mut headers = HeaderMap::new();
        headers.insert("etag", HeaderValue::from_static("first-page-etag"));
        headers.insert(
            "link",
            HeaderValue::from_static(
                "<https://api.github.com/repos/acme/widgets/pulls/7/files?per_page=100&page=2>; rel=\"next\"",
            ),
        );
        let files = (0..100).map(pr_file_json).collect::<Vec<_>>();
        (headers, Json(serde_json::Value::Array(files))).into_response()
    }

    #[tokio::test]
    async fn get_pr_files_returns_every_paginated_file() {
        let router = Router::new().route(
            "/repos/acme/widgets/pulls/7/files",
            get(paginated_pr_files_response),
        );
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind fake GitHub API");
        let address = listener.local_addr().expect("read fake GitHub address");
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("serve fake GitHub API");
        });
        let client = GitHubClient::new().with_test_api_base_url(format!("http://{address}"));

        let files = client
            .get_pr_files("acme", "widgets", 7, "token")
            .await
            .expect("fetch all pull request files");

        assert_eq!(files.len(), 101);
        assert_eq!(
            files.first().map(|file| file.filename.as_str()),
            Some("src/file-0.rs")
        );
        assert_eq!(
            files.last().map(|file| file.filename.as_str()),
            Some("src/file-100.rs")
        );
    }

    #[tokio::test]
    async fn get_pr_files_refreshes_later_pages_on_each_fetch() {
        let state = Arc::new(ChangingSecondPage::default());
        let router = Router::new()
            .route(
                "/repos/acme/widgets/pulls/7/files",
                get(changing_paginated_pr_files_response),
            )
            .with_state(state);
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind fake GitHub API");
        let address = listener.local_addr().expect("read fake GitHub address");
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("serve fake GitHub API");
        });
        let client = GitHubClient::new().with_test_api_base_url(format!("http://{address}"));

        let first = client
            .get_pr_files("acme", "widgets", 7, "token")
            .await
            .expect("fetch initial pull request files");
        let refreshed = client
            .get_pr_files("acme", "widgets", 7, "token")
            .await
            .expect("refresh pull request files");

        assert_eq!(
            first.last().map(|file| file.filename.as_str()),
            Some("src/file-100.rs")
        );
        assert_eq!(
            refreshed.last().map(|file| file.filename.as_str()),
            Some("src/file-101.rs")
        );
    }

    #[test]
    fn review_summary_is_a_thread_root() {
        let review = PrReview {
            id: 42,
            user: GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            state: "COMMENTED".to_string(),
            body: Some("Overall review".to_string()),
            submitted_at: Some("2024-01-01T00:00:00Z".to_string()),
            extra: serde_json::json!({}),
        };

        let comment = review_body_comment(&review).expect("review summary comment");

        assert_eq!(comment.comment_type, "review_body");
        assert_eq!(comment.in_reply_to_id, None);
    }

    #[test]
    fn bounded_base64_content_omits_content_over_the_limit() {
        let content = bounded_base64_content(
            BlobResponse {
                content: "YWJj\n".to_string(),
                size: 26_214_401,
            },
            Some(25 * 1024 * 1024),
        );

        assert_eq!(
            content,
            Base64FileContent {
                content: String::new(),
                size: 26_214_401,
                too_large: true,
            }
        );
    }

    #[test]
    fn bounded_base64_content_normalizes_content_within_the_limit() {
        let content = bounded_base64_content(
            BlobResponse {
                content: "YWJj\n".to_string(),
                size: 3,
            },
            Some(25 * 1024 * 1024),
        );

        assert_eq!(
            content,
            Base64FileContent {
                content: "YWJj".to_string(),
                size: 3,
                too_large: false,
            }
        );
    }
    fn make_search_pr_result(id: i64, draft: bool) -> SearchPrResult {
        SearchPrResult {
            id,
            number: id,
            title: format!("PR {id}"),
            body: Some("body".to_string()),
            state: "open".to_string(),
            draft,
            html_url: format!("https://github.com/acme/repo/pull/{id}"),
            user_login: "alice".to_string(),
            user_avatar_url: None,
            repo_owner: "acme".to_string(),
            repo_name: "repo".to_string(),
            head_ref: format!("feature/T-{id}"),
            base_ref: "main".to_string(),
            head_sha: format!("sha-{id}"),
            additions: 10,
            deletions: 2,
            changed_files: 1,
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-02T00:00:00Z".to_string(),
            labels: vec![],
        }
    }
    #[test]
    fn normalize_base64_content_removes_newlines_without_decoding() {
        assert_eq!(normalize_base64_content("SGVs\nbG8="), "SGVsbG8=");
    }

    #[test]
    fn decode_base64_content_decodes_multiline_base64() {
        let decoded = decode_base64_content("SGVsbG8gV29y\nbGQ=").unwrap();

        assert_eq!(decoded, "Hello World");
    }

    #[test]
    fn review_requested_pr_search_url_excludes_drafts_at_query_time() {
        let url = review_requested_pr_search_url("octocat");

        assert!(url.contains("review-requested:octocat"));
        assert!(url.contains("type:pr"));
        assert!(url.contains("state:open"));
        assert!(url.contains("draft:false"));
    }

    #[test]
    fn exclude_draft_search_pr_results_removes_drafts_and_keeps_non_drafts() {
        let (prs, safe_ids) = exclude_draft_search_pr_results(
            vec![
                make_search_pr_result(1, false),
                make_search_pr_result(2, true),
            ],
            vec![1, 2],
        );

        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].id, 1);
        assert!(!prs[0].draft);
        assert_eq!(safe_ids, vec![1]);
    }

    #[test]
    fn decode_base64_content_rejects_invalid_utf8() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([0xff, 0xfe, 0xfd]);

        let err = decode_base64_content(&encoded).unwrap_err();
        assert!(
            matches!(err, GitHubError::ParseError(message) if message.contains("UTF-8 decode error"))
        );
    }
}
