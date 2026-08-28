use crate::{
    db,
    github_client::{
        GitHubClient, PrComment, PrReviewComment, ResolvedGithubAsset, ReviewSubmitComment,
    },
};
use serde::Serialize;
use std::sync::{Arc, Mutex};

use super::auth::github_token;

#[derive(Debug, Clone, Serialize)]
pub struct FrontendReviewComment {
    pub id: i64,
    pub pr_number: i64,
    pub repo_owner: String,
    pub repo_name: String,
    pub path: String,
    pub line: Option<i32>,
    pub side: Option<String>,
    pub body: String,
    pub author: String,
    pub created_at: String,
    pub in_reply_to_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrontendPrOverviewComment {
    pub id: i64,
    pub body: String,
    pub author: String,
    pub avatar_url: Option<String>,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub created_at: String,
}

pub fn mark_comment_addressed(
    db: &Arc<Mutex<db::Database>>,
    comment_id: i64,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(db);
    let updated = db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {e}"))?;
    if updated {
        Ok(())
    } else {
        Err(format!("Comment not found: {comment_id}"))
    }
}

pub async fn get_pr_file_diffs(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<Vec<crate::github_client::PrFileDiff>, String> {
    let token = github_token().await?;
    github_client
        .get_pr_files(owner, repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get PR files: {e}"))
}

pub async fn get_file_content(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    sha: &str,
) -> Result<String, String> {
    let token = github_token().await?;
    github_client
        .get_blob_content(owner, repo, sha, &token)
        .await
        .map_err(|e| format!("Failed to get blob content: {e}"))
}

pub async fn get_file_content_base64(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    sha: &str,
) -> Result<String, String> {
    let token = github_token().await?;
    github_client
        .get_blob_content_base64(owner, repo, sha, &token)
        .await
        .map_err(|e| format!("Failed to get blob content: {e}"))
}

pub async fn get_file_at_ref(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    path: &str,
    ref_sha: &str,
) -> Result<String, String> {
    let token = github_token().await?;
    github_client
        .get_file_at_ref(owner, repo, path, ref_sha, &token)
        .await
        .map_err(|e| format!("Failed to get file at ref: {e}"))
}

pub async fn get_file_at_ref_base64(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    path: &str,
    ref_sha: &str,
) -> Result<String, String> {
    let token = github_token().await?;
    github_client
        .get_file_at_ref_base64(owner, repo, path, ref_sha, &token)
        .await
        .map_err(|e| format!("Failed to get file at ref: {e}"))
}

/// Exchange a GitHub upload URL from PR Markdown for one the renderer can load,
/// along with how GitHub renders it (picture vs. video player).
/// Returns `None` when the URL is not an attachment GitHub will resolve for us.
pub async fn resolve_github_asset(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    url: &str,
) -> Result<Option<ResolvedGithubAsset>, String> {
    let token = github_token().await?;
    github_client
        .resolve_attachment(owner, repo, url, &token)
        .await
        .map_err(|e| format!("Failed to resolve GitHub attachment: {e}"))
}

fn map_pr_review_comments_for_frontend(
    owner: &str,
    repo: &str,
    pr_number: i64,
    comments: Vec<PrReviewComment>,
) -> Vec<FrontendReviewComment> {
    comments
        .into_iter()
        .map(|comment| FrontendReviewComment {
            id: comment.id,
            pr_number,
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            path: comment.path,
            line: comment.line.or_else(|| {
                comment
                    .extra
                    .get("original_line")
                    .and_then(|value| value.as_i64())
                    .and_then(|value| i32::try_from(value).ok())
            }),
            side: comment.side,
            body: comment.body,
            author: comment.user.login,
            created_at: comment.created_at,
            in_reply_to_id: comment.in_reply_to_id,
        })
        .collect()
}

pub async fn get_review_comments(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<Vec<FrontendReviewComment>, String> {
    let token = github_token().await?;
    let comments = github_client
        .get_pr_review_comments(owner, repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get review comments: {e}"))?;

    Ok(map_pr_review_comments_for_frontend(
        owner, repo, pr_number, comments,
    ))
}

fn map_pr_overview_comments_for_frontend(
    comments: Vec<PrComment>,
) -> Vec<FrontendPrOverviewComment> {
    comments
        .into_iter()
        .map(|comment| FrontendPrOverviewComment {
            id: comment.id,
            body: comment.body,
            author: comment.user.login,
            avatar_url: comment
                .user
                .extra
                .get("avatar_url")
                .and_then(|value| value.as_str())
                .map(String::from),
            comment_type: comment.comment_type,
            file_path: comment.path,
            line_number: comment.line,
            created_at: comment.created_at,
        })
        .collect()
}

pub async fn get_pr_overview_comments(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<Vec<FrontendPrOverviewComment>, String> {
    let token = github_token().await?;
    let comments = github_client
        .get_pr_comments(owner, repo, pr_number, &token, None)
        .await
        .map_err(|e| format!("Failed to get PR overview comments: {e}"))?;

    Ok(map_pr_overview_comments_for_frontend(comments))
}

pub struct SubmitPrReviewRequest<'a> {
    pub owner: &'a str,
    pub repo: &'a str,
    pub pr_number: i64,
    pub event: &'a str,
    pub body: &'a str,
    pub comments: Vec<ReviewSubmitComment>,
    pub commit_id: &'a str,
}

pub async fn submit_pr_review(
    github_client: &GitHubClient,
    request: SubmitPrReviewRequest<'_>,
) -> Result<(), String> {
    let token = github_token().await?;
    github_client
        .submit_review(
            request.owner,
            request.repo,
            request.pr_number,
            request.event,
            request.body,
            request.comments,
            request.commit_id,
            &token,
        )
        .await
        .map_err(|e| format!("Failed to submit review: {e}"))
}

/// Post a single review comment immediately (not batched into a pending review).
#[allow(clippy::too_many_arguments)]
pub async fn create_review_comment(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
    commit_id: &str,
    path: &str,
    line: i32,
    side: &str,
    body: &str,
) -> Result<(), String> {
    let token = github_token().await?;
    github_client
        .create_review_comment(
            owner, repo, pr_number, commit_id, path, line, side, body, &token,
        )
        .await
        .map_err(|e| format!("Failed to create review comment: {e}"))
}

/// Post a threaded reply to an existing PR review comment.
pub async fn create_review_comment_reply(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
    comment_id: i64,
    body: &str,
) -> Result<(), String> {
    let token = github_token().await?;
    github_client
        .create_review_comment_reply(owner, repo, pr_number, comment_id, body, &token)
        .await
        .map_err(|e| format!("Failed to reply to review comment: {e}"))
}

#[cfg(test)]
mod tests {
    use crate::github_client::{GitHubUser, PrComment, PrReviewComment};

    #[test]
    fn maps_review_comments_for_frontend_with_original_line_fallback() {
        let comments = vec![PrReviewComment {
            id: 101,
            path: "src/lib.rs".to_string(),
            line: None,
            side: Some("RIGHT".to_string()),
            body: "Please adjust this".to_string(),
            user: GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            created_at: "2026-05-04T12:00:00Z".to_string(),
            in_reply_to_id: Some(99),
            extra: serde_json::json!({ "original_line": 42 }),
        }];

        let mapped = super::map_pr_review_comments_for_frontend("acme", "forge", 7, comments);

        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].repo_owner, "acme");
        assert_eq!(mapped[0].repo_name, "forge");
        assert_eq!(mapped[0].pr_number, 7);
        assert_eq!(mapped[0].path, "src/lib.rs");
        assert_eq!(mapped[0].line, Some(42));
        assert_eq!(mapped[0].side.as_deref(), Some("RIGHT"));
        assert_eq!(mapped[0].author, "reviewer");
        assert_eq!(mapped[0].in_reply_to_id, Some(99));
    }

    #[test]
    fn maps_overview_comments_for_frontend_with_avatar_and_optional_location() {
        let comments = vec![PrComment {
            id: 201,
            body: "Looks good overall".to_string(),
            user: GitHubUser {
                login: "maintainer".to_string(),
                extra: serde_json::json!({ "avatar_url": "https://avatars.example/u/1" }),
            },
            path: Some("README.md".to_string()),
            line: Some(3),
            comment_type: "issue_comment".to_string(),
            outdated: false,
            created_at: "2026-05-04T12:01:00Z".to_string(),
        }];

        let mapped = super::map_pr_overview_comments_for_frontend(comments);

        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].body, "Looks good overall");
        assert_eq!(mapped[0].author, "maintainer");
        assert_eq!(
            mapped[0].avatar_url.as_deref(),
            Some("https://avatars.example/u/1")
        );
        assert_eq!(mapped[0].file_path.as_deref(), Some("README.md"));
        assert_eq!(mapped[0].line_number, Some(3));
    }
}
