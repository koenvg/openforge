use base64::{engine::general_purpose, Engine as _};
use futures::future::join_all;
use log::warn;
use serde::{Deserialize, Serialize};

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

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CachedSearchPrResults {
    results: Vec<SearchPrResult>,
    safe_search_ids: Vec<i64>,
}

fn should_cache_enriched_search_results(detail_error_count: usize) -> bool {
    detail_error_count == 0
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

impl GitHubClient {
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

        // Fetch review bodies (top-level summary comments from PR reviews).
        // These are only accessible via /pulls/{number}/reviews and are NOT
        // included in the review comments or issue comments endpoints.
        let reviews = self
            .get_pr_reviews(owner, repo, pr_number, token)
            .await
            .unwrap_or_else(|e| {
                warn!(
                    "[GitHub] Failed to fetch reviews for PR #{}: {}",
                    pr_number,
                    e.sanitized_log_message()
                );
                vec![]
            });

        for review in reviews {
            let body = match &review.body {
                Some(b) if !b.is_empty() => b.clone(),
                _ => continue,
            };
            let submitted_at = review.submitted_at.unwrap_or_default();
            if !submitted_at.is_empty() {
                if let Some(ts) = since {
                    if submitted_at.as_str() < ts {
                        continue;
                    }
                }
            }
            all_comments.push(PrComment {
                id: -review.id,
                body,
                user: review.user,
                path: None,
                line: None,
                comment_type: "review_body".to_string(),
                outdated: false,
                created_at: submitted_at,
            });
        }

        Ok(all_comments)
    }

    async fn search_prs_with_details(
        &self,
        url: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        match self.conditional_get(url, token).await? {
            super::ConditionalResponse::NotModified(Some(cached_body)) => {
                let cached: CachedSearchPrResults = serde_json::from_str(&cached_body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                Ok((cached.results, cached.safe_search_ids))
            }
            super::ConditionalResponse::NotModified(None) => Err(GitHubError::ParseError(
                "Received 304 but no cached search response found".to_string(),
            )),
            super::ConditionalResponse::Fresh(response) => {
                if !response.status().is_success() {
                    return Err(Self::api_error_from_response(response).await);
                }

                let etag = response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                let body = response
                    .text()
                    .await
                    .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
                let search_response: SearchResponse = serde_json::from_str(&body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;

                let all_search_ids: Vec<i64> =
                    search_response.items.iter().map(|item| item.id).collect();
                let is_complete = search_response.total_count <= search_response.items.len();
                let items_with_coords: Vec<(SearchItem, String, String)> = search_response
                    .items
                    .into_iter()
                    .filter_map(|item| {
                        let parts: Vec<&str> = item.repository_url.split('/').collect();
                        if parts.len() < 2 {
                            return None;
                        }
                        let owner = parts[parts.len() - 2].to_string();
                        let repo = parts[parts.len() - 1].to_string();
                        Some((item, owner, repo))
                    })
                    .collect();

                let detail_futures: Vec<_> = items_with_coords
                    .iter()
                    .map(|(item, owner, repo)| self.get_pr_details(owner, repo, item.number, token))
                    .collect();
                let detail_results = join_all(detail_futures).await;

                let mut results = Vec::new();
                let mut detail_error_count = 0usize;
                for ((item, owner, repo), pr_result) in
                    items_with_coords.into_iter().zip(detail_results)
                {
                    match pr_result {
                        Ok(pr_details) => {
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
                        Err(e) => {
                            detail_error_count += 1;
                            warn!(
                                "[GitHub] Failed to fetch PR details for PR #{}: {}",
                                item.number,
                                e.sanitized_log_message()
                            );
                        }
                    }
                }

                let cached = CachedSearchPrResults {
                    results,
                    safe_search_ids: if is_complete { all_search_ids } else { vec![] },
                };
                if should_cache_enriched_search_results(detail_error_count) {
                    let cached_body = serde_json::to_string(&cached)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                    self.cache_response_body(url, etag, &cached_body);
                }

                Ok((cached.results, cached.safe_search_ids))
            }
        }
    }

    pub async fn search_review_requested_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        let url = review_requested_pr_search_url(username);
        let (prs, safe_search_ids) = self.search_prs_with_details(&url, token).await?;

        Ok(exclude_draft_search_pr_results(prs, safe_search_ids))
    }

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
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/files?per_page=100",
            owner, repo, pr_number
        );

        self.get_with_etag::<Vec<PrFileDiff>>(&url, token).await
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
    fn search_pr_results_cache_round_trips_enriched_results_and_safe_ids() {
        let cached = CachedSearchPrResults {
            results: vec![SearchPrResult {
                id: 42,
                number: 7,
                title: "T-42 Ready".to_string(),
                body: Some("body".to_string()),
                state: "open".to_string(),
                draft: false,
                html_url: "https://github.com/acme/repo/pull/7".to_string(),
                user_login: "alice".to_string(),
                user_avatar_url: None,
                repo_owner: "acme".to_string(),
                repo_name: "repo".to_string(),
                head_ref: "T-42-ready".to_string(),
                base_ref: "main".to_string(),
                head_sha: "abc123".to_string(),
                additions: 10,
                deletions: 2,
                changed_files: 1,
                mergeable: Some(true),
                mergeable_state: Some("clean".to_string()),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-02T00:00:00Z".to_string(),
                labels: vec![],
            }],
            safe_search_ids: vec![42],
        };

        let body = serde_json::to_string(&cached).expect("cache payload should serialize");
        let parsed: CachedSearchPrResults =
            serde_json::from_str(&body).expect("cache payload should deserialize");

        assert_eq!(parsed.safe_search_ids, vec![42]);
        assert_eq!(parsed.results.len(), 1);
        assert_eq!(parsed.results[0].head_ref, "T-42-ready");
        assert_eq!(parsed.results[0].mergeable_state.as_deref(), Some("clean"));
    }
    #[test]
    fn search_pr_results_cache_is_skipped_when_any_detail_fetch_failed() {
        assert!(should_cache_enriched_search_results(0));
        assert!(!should_cache_enriched_search_results(1));
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
