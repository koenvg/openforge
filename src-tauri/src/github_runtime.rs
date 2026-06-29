use crate::{db, github_client::GitHubClient};
use futures::future::join_all;
use log::error;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::github_client::{
    dedupe_pr_refs, extract_authored_pr_refs_from_user_events, PrComment, PrRef, PrReviewComment,
    ReviewSubmitComment, SearchPrResult,
};

const AUTHORED_PRS_RECONCILE_INTERVAL_SECS: i64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitHubPrLink {
    owner: String,
    repo: String,
    number: i64,
    normalized_url: String,
}

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

pub fn github_token() -> Result<String, String> {
    crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {e}"))?
        .ok_or_else(|| "github_token not configured".to_string())
}

pub async fn github_username(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<String, String> {
    let cached_username = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_config("github_username")
            .map_err(|e| format!("Failed to get config: {e}"))?
    };

    if let Some(username) = cached_username {
        return Ok(username);
    }

    let token = github_token()?;
    let username = github_client
        .get_authenticated_user(&token)
        .await
        .map_err(|e| format!("Failed to get authenticated user: {e}"))?;

    let db_lock = crate::db::acquire_db(db);
    db_lock
        .set_config("github_username", &username)
        .map_err(|e| format!("Failed to cache username: {e}"))?;

    Ok(username)
}

pub fn get_pull_requests(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {e}"))
}

pub fn get_pr_comments(
    db: &Arc<Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {e}"))
}

fn parse_github_pr_url(pr_url: &str) -> Result<GitHubPrLink, String> {
    let trimmed = pr_url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| "Invalid pull request URL: expected a GitHub PR URL".to_string())?;
    let without_host = without_scheme
        .strip_prefix("github.com/")
        .ok_or_else(|| "Invalid pull request URL: expected github.com".to_string())?;
    let path = without_host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/');
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() < 4 || segments[2] != "pull" {
        return Err("Invalid pull request URL: expected /owner/repo/pull/number".to_string());
    }

    let owner = segments[0].to_string();
    let repo = segments[1].to_string();
    let number = segments[3]
        .parse::<i64>()
        .map_err(|_| "Invalid pull request URL: pull request number must be numeric".to_string())?;

    if owner.is_empty() || repo.is_empty() || number <= 0 {
        return Err(
            "Invalid pull request URL: expected a positive pull request number".to_string(),
        );
    }

    Ok(GitHubPrLink {
        normalized_url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
        owner,
        repo,
        number,
    })
}

/// Parse a git `origin` remote URL into `(owner, repo)`, supporting the common
/// GitHub forms (https, ssh `git@`, `ssh://`, `git://`, and `user@host` variants).
/// Returns `None` for non-GitHub or unparseable remotes.
pub fn parse_git_remote_repo(remote_url: &str) -> Option<(String, String)> {
    let trimmed = remote_url.trim();

    let after_host = if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        rest.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("git://github.com/") {
        rest.to_string()
    } else {
        let no_scheme = trimmed
            .strip_prefix("https://")
            .or_else(|| trimmed.strip_prefix("http://"))
            .or_else(|| trimmed.strip_prefix("ssh://"))?;
        // Drop any "user@" credential prefix before the host.
        let no_user = no_scheme.rsplit('@').next().unwrap_or(no_scheme);
        no_user
            .strip_prefix("github.com/")
            .or_else(|| no_user.strip_prefix("github.com:"))?
            .to_string()
    };

    let path = after_host.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?.to_string();
    let repo = segments.next()?.to_string();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner, repo))
}

/// Resolve the GitHub `owner/repo` for a project from the `origin` remote of the
/// git repository at `project_path`. Returns `None` if there is no git repo, no
/// origin remote, or the remote is not a parseable GitHub URL.
pub fn resolve_project_repo_from_path(project_path: &str) -> Option<(String, String)> {
    let repo = git2::Repository::open(project_path).ok()?;
    let config = repo.config().ok()?;
    let url = config.get_string("remote.origin.url").ok()?;
    parse_git_remote_repo(&url)
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectRepo {
    pub owner: String,
    pub name: String,
}

/// Resolve and cache a project's GitHub repo (owner/name) from its git `origin`
/// remote. The result is cached to project config `resolved_repo` ("owner/name")
/// so the renderer and plugins can read it through the existing project-config
/// capability for repo-scoped PR filtering.
pub fn get_project_repo(
    db: &Mutex<db::Database>,
    project_id: &str,
) -> Result<Option<ProjectRepo>, String> {
    let project = {
        let guard = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        guard.get_project(project_id).map_err(|e| e.to_string())?
    };
    let Some(project) = project else {
        return Ok(None);
    };

    let resolved = resolve_project_repo_from_path(&project.path)
        .map(|(owner, name)| ProjectRepo { owner, name });

    if let Some(repo) = &resolved {
        let guard = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let _ = guard.set_project_config(
            project_id,
            "resolved_repo",
            &format!("{}/{}", repo.owner, repo.name),
        );
    }

    Ok(resolved)
}

fn synthetic_pr_id(link: &GitHubPrLink) -> i64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let key = format!("{}/{}/{}", link.owner, link.repo, link.number);
    let hash = key.as_bytes().iter().fold(FNV_OFFSET, |acc, byte| {
        (acc ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    let positive = (hash & 0x3fff_ffff_ffff_ffff).max(1);
    -(positive as i64)
}

pub fn link_pull_request(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
    pr_url: &str,
) -> Result<db::PrRow, String> {
    let link = parse_github_pr_url(pr_url)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read current time: {e}"))?
        .as_secs() as i64;

    let db_lock = crate::db::acquire_db(db);
    if db_lock
        .get_task(task_id)
        .map_err(|e| format!("Failed to find task: {e}"))?
        .is_none()
    {
        return Err(format!("Task not found: {task_id}"));
    }

    let existing_pr = db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read existing pull requests: {e}"))?
        .into_iter()
        .find(|pr| {
            pr.repo_owner == link.owner && pr.repo_name == link.repo && pr.pr_number == link.number
        });

    let row_id = existing_pr
        .as_ref()
        .map(|pr| pr.id)
        .unwrap_or_else(|| synthetic_pr_id(&link));
    let title = existing_pr
        .as_ref()
        .map(|pr| pr.title.clone())
        .unwrap_or_else(|| format!("{}/{}#{}", link.owner, link.repo, link.number));
    let url = existing_pr
        .as_ref()
        .map(|pr| pr.url.clone())
        .unwrap_or_else(|| link.normalized_url.clone());
    let state = existing_pr
        .as_ref()
        .map(|pr| pr.state.clone())
        .unwrap_or_else(|| "open".to_string());
    let created_at = existing_pr.as_ref().map(|pr| pr.created_at).unwrap_or(now);
    let draft = existing_pr.as_ref().map(|pr| pr.draft).unwrap_or(false);

    db_lock
        .insert_pull_request_with_number(
            row_id,
            link.number,
            task_id,
            &link.owner,
            &link.repo,
            &title,
            &url,
            &state,
            created_at,
            now,
            draft,
        )
        .map_err(|e| format!("Failed to link pull request: {e}"))?;

    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read linked pull request: {e}"))?
        .into_iter()
        .find(|pr| pr.id == row_id)
        .ok_or_else(|| "Failed to read linked pull request after insert".to_string())
}

pub fn mark_comment_addressed(
    db: &Arc<Mutex<db::Database>>,
    comment_id: i64,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {e}"))
}

pub fn get_review_prs(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::ReviewPrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {e}"))
}

pub fn mark_review_pr_viewed(
    db: &Arc<Mutex<db::Database>>,
    pr_id: i64,
    head_sha: &str,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .mark_review_pr_viewed(pr_id, head_sha)
        .map_err(|e| format!("Failed to mark review PR viewed: {e}"))
}

pub fn get_authored_prs(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::AuthoredPrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_authored_prs()
        .map_err(|e| format!("Failed to get authored PRs: {e}"))
}

pub async fn merge_pull_request(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<(), String> {
    let token = github_token()?;
    let response = github_client
        .merge_pr(owner, repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to merge pull request: {e}"))?;

    if !response.merged {
        return Err(format!(
            "Failed to merge pull request: {}",
            response.message
        ));
    }

    Ok(())
}

pub async fn fetch_review_prs(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let username = github_username(db, github_client).await?;
    let token = github_token()?;

    let (prs, all_search_ids) = github_client
        .search_review_requested_prs(&username, &token)
        .await
        .map_err(|e| format!("Failed to search review PRs: {e}"))?;

    {
        let db_lock = crate::db::acquire_db(db);
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            db_lock
                .upsert_review_pr(
                    pr.id,
                    pr.number,
                    &pr.title,
                    pr.body.as_deref(),
                    &pr.state,
                    pr.draft,
                    &pr.html_url,
                    &pr.user_login,
                    pr.user_avatar_url.as_deref(),
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_ref,
                    &pr.base_ref,
                    &pr.head_sha,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    created_at,
                    updated_at,
                )
                .map_err(|e| format!("Failed to upsert review PR: {e}"))?;
            db_lock
                .update_review_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                .map_err(|e| format!("Failed to update review PR mergeability: {e}"))?;
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            db_lock
                .delete_stale_review_prs(&all_search_ids)
                .map_err(|e| format!("Failed to delete stale review PRs: {e}"))?;
        }
    }

    get_review_prs(db)
}

pub async fn get_pr_file_diffs(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<Vec<crate::github_client::PrFileDiff>, String> {
    let token = github_token()?;
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
    let token = github_token()?;
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
    let token = github_token()?;
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
    let token = github_token()?;
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
    let token = github_token()?;
    github_client
        .get_file_at_ref_base64(owner, repo, path, ref_sha, &token)
        .await
        .map_err(|e| format!("Failed to get file at ref: {e}"))
}

pub fn map_pr_review_comments_for_frontend(
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
    let token = github_token()?;
    let comments = github_client
        .get_pr_review_comments(owner, repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get review comments: {e}"))?;

    Ok(map_pr_review_comments_for_frontend(
        owner, repo, pr_number, comments,
    ))
}

pub fn map_pr_overview_comments_for_frontend(
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
    let token = github_token()?;
    let comments = github_client
        .get_pr_comments(owner, repo, pr_number, &token, None)
        .await
        .map_err(|e| format!("Failed to get PR overview comments: {e}"))?;

    Ok(map_pr_overview_comments_for_frontend(comments))
}

pub async fn submit_pr_review(
    github_client: &GitHubClient,
    owner: &str,
    repo: &str,
    pr_number: i64,
    event: &str,
    body: &str,
    comments: Vec<ReviewSubmitComment>,
    commit_id: &str,
) -> Result<(), String> {
    let token = github_token()?;
    github_client
        .submit_review(
            owner, repo, pr_number, event, body, comments, commit_id, &token,
        )
        .await
        .map_err(|e| format!("Failed to submit review: {e}"))
}

fn should_fallback_to_search(
    existing_rows: usize,
    event_refs: usize,
    uncovered_event_refs: usize,
    last_reconciled_at: Option<i64>,
    now: i64,
) -> bool {
    existing_rows == 0
        || event_refs == 0
        || uncovered_event_refs > 0
        || last_reconciled_at
            .map(|ts| now.saturating_sub(ts) >= AUTHORED_PRS_RECONCILE_INTERVAL_SECS)
            .unwrap_or(true)
}

fn key_for_pr_ref(pr_ref: &PrRef) -> String {
    format!(
        "{}/{}/{}",
        pr_ref.repo_owner, pr_ref.repo_name, pr_ref.number
    )
}

fn key_for_row(row: &db::AuthoredPrRow) -> String {
    format!("{}/{}/{}", row.repo_owner, row.repo_name, row.number)
}

async fn fetch_event_signal_prs(
    github_client: &GitHubClient,
    token: &str,
    event_refs: &[PrRef],
    existing_id_by_ref: &HashMap<String, i64>,
) -> Vec<SearchPrResult> {
    let detail_futures: Vec<_> = event_refs
        .iter()
        .filter_map(|pr_ref| {
            let id = existing_id_by_ref.get(&key_for_pr_ref(pr_ref)).copied()?;
            Some(async move { (pr_ref, id) })
        })
        .collect();

    let signal_refs = join_all(detail_futures).await;

    let fetch_futures: Vec<_> = signal_refs
        .iter()
        .map(|(pr_ref, _)| {
            github_client.get_pr_details(
                &pr_ref.repo_owner,
                &pr_ref.repo_name,
                pr_ref.number,
                token,
            )
        })
        .collect();

    let fetch_results = join_all(fetch_futures).await;

    let mut results = Vec::new();
    for ((pr_ref, existing_id), detail_result) in signal_refs.into_iter().zip(fetch_results) {
        match detail_result {
            Ok(pr_details) => {
                results.push(SearchPrResult {
                    id: existing_id,
                    number: pr_details.number,
                    title: pr_details.title,
                    body: pr_details
                        .extra
                        .get("body")
                        .and_then(|body| body.as_str())
                        .map(ToOwned::to_owned),
                    state: pr_details.state,
                    draft: pr_details.draft.unwrap_or(false),
                    html_url: pr_details.html_url,
                    user_login: pr_details.user.login,
                    user_avatar_url: pr_details
                        .user
                        .extra
                        .get("avatar_url")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    repo_owner: pr_ref.repo_owner.clone(),
                    repo_name: pr_ref.repo_name.clone(),
                    head_ref: pr_details.head.ref_name,
                    base_ref: pr_details
                        .extra
                        .get("base")
                        .and_then(|base| base.get("ref"))
                        .and_then(|ref_name| ref_name.as_str())
                        .unwrap_or("main")
                        .to_string(),
                    head_sha: pr_details.head.sha,
                    additions: pr_details
                        .extra
                        .get("additions")
                        .and_then(|additions| additions.as_i64())
                        .unwrap_or(0),
                    deletions: pr_details
                        .extra
                        .get("deletions")
                        .and_then(|deletions| deletions.as_i64())
                        .unwrap_or(0),
                    changed_files: pr_details
                        .extra
                        .get("changed_files")
                        .and_then(|changed_files| changed_files.as_i64())
                        .unwrap_or(0),
                    mergeable: pr_details.mergeable,
                    mergeable_state: pr_details.mergeable_state,
                    created_at: pr_details
                        .extra
                        .get("created_at")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    updated_at: pr_details
                        .extra
                        .get("updated_at")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                });
            }
            Err(e) => {
                error!(
                    "[authored_prs] Failed to fetch PR details for {}/{} #{}: {}",
                    pr_ref.repo_owner, pr_ref.repo_name, pr_ref.number, e
                );
            }
        }
    }

    results
}

pub async fn fetch_authored_prs(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    let username = github_username(db, github_client).await?;
    let token = github_token()?;

    let existing_rows = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_all_authored_prs()
            .map_err(|e| format!("Failed to read authored PR cache: {e}"))?
    };

    let last_reconciled_at = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_config("authored_prs_last_reconciled_at")
            .map_err(|e| format!("Failed to read authored PR reconcile timestamp: {e}"))?
            .and_then(|value| value.parse::<i64>().ok())
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read current time: {e}"))?
        .as_secs() as i64;

    let existing_id_by_ref: HashMap<String, i64> = existing_rows
        .iter()
        .map(|row| (key_for_row(row), row.id))
        .collect();

    let user_events = github_client
        .list_user_events(&username, &token)
        .await
        .unwrap_or_else(|e| {
            error!(
                "[authored_prs] Failed to fetch user events for {}: {}",
                username, e
            );
            Vec::new()
        });

    let event_refs = dedupe_pr_refs(extract_authored_pr_refs_from_user_events(
        &user_events,
        &username,
    ));

    let uncovered_event_refs = event_refs
        .iter()
        .filter(|pr_ref| !existing_id_by_ref.contains_key(&key_for_pr_ref(pr_ref)))
        .count();

    let should_run_search = should_fallback_to_search(
        existing_rows.len(),
        event_refs.len(),
        uncovered_event_refs,
        last_reconciled_at,
        now,
    );

    let (prs, all_search_ids, can_delete_stale) = if should_run_search {
        let (search_prs, search_ids) =
            github_client
                .search_authored_prs(&username, &token)
                .await
                .map_err(|e| format!("Failed to search authored PRs: {e}"))?;
        (search_prs, search_ids, true)
    } else {
        let event_signal_prs =
            fetch_event_signal_prs(github_client, &token, &event_refs, &existing_id_by_ref).await;
        (event_signal_prs, Vec::new(), false)
    };

    type EnrichedPrData = (i64, Option<String>, Option<String>, Option<String>, bool);
    let mut enriched: HashMap<i64, EnrichedPrData> = HashMap::with_capacity(prs.len());

    for pr in &prs {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let (check_runs_result, combined_status_result, reviews_result, pr_details_result) = tokio::join!(
            github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &token),
            github_client.get_combined_status(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &token),
            github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, &token),
            github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, &token)
        );

        let (ci_status, ci_check_runs) = match (check_runs_result, combined_status_result) {
            (Ok(check_runs), Ok(combined_status)) => {
                let status =
                    crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
                let check_runs_json = serde_json::to_string(&check_runs.check_runs)
                    .unwrap_or_else(|_| "[]".to_string());
                (Some(status), Some(check_runs_json))
            }
            _ => (None, None),
        };

        let review_status = reviews_result
            .ok()
            .map(|reviews| crate::github_client::aggregate_review_status(&reviews, false, None));

        let is_queued = pr_details_result
            .ok()
            .and_then(|details| {
                details
                    .extra
                    .get("merge_queue_entry")
                    .map(|value| !value.is_null())
            })
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                is_queued,
            ),
        );
    }

    {
        let db_lock = crate::db::acquire_db(db);
        for pr in &prs {
            let (created_at, ci_status, ci_check_runs, review_status, is_queued) = enriched
                .get(&pr.id)
                .ok_or_else(|| format!("Missing enriched data for PR {}", pr.id))?;

            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let task_id = db_lock
                .get_task_id_for_pr(pr.id)
                .map_err(|e| format!("Failed to get task link for PR {}: {e}", pr.id))?;

            db_lock
                .upsert_authored_pr(
                    pr.id,
                    pr.number,
                    &pr.title,
                    pr.body.as_deref(),
                    &pr.state,
                    pr.draft,
                    &pr.html_url,
                    &pr.user_login,
                    pr.user_avatar_url.as_deref(),
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_ref,
                    &pr.base_ref,
                    &pr.head_sha,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    ci_status.as_deref(),
                    ci_check_runs.as_deref(),
                    review_status.as_deref(),
                    None,
                    *is_queued,
                    task_id.as_deref(),
                    *created_at,
                    updated_at,
                )
                .map_err(|e| format!("Failed to upsert authored PR: {e}"))?;
            db_lock
                .update_authored_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                .map_err(|e| format!("Failed to update authored PR mergeability: {e}"))?;
        }

        if can_delete_stale && (!all_search_ids.is_empty() || prs.is_empty()) {
            db_lock
                .delete_stale_authored_prs(&all_search_ids)
                .map_err(|e| format!("Failed to delete stale authored PRs: {e}"))?;

            db_lock
                .set_config("authored_prs_last_reconciled_at", &now.to_string())
                .map_err(|e| format!("Failed to persist authored PR reconcile timestamp: {e}"))?;
        }
    }

    get_authored_prs(db)
}

#[cfg(test)]
mod tests {
    use super::parse_git_remote_repo;
    use super::should_fallback_to_search;
    use crate::db::test_helpers::make_test_db;
    use crate::github_client::{GitHubUser, PrComment, PrReviewComment};

    #[test]
    fn parses_https_remote_with_git_suffix() {
        assert_eq!(
            parse_git_remote_repo("https://github.com/acme/widgets.git"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
    }

    #[test]
    fn parses_https_remote_without_git_suffix() {
        assert_eq!(
            parse_git_remote_repo("https://github.com/acme/widgets"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
    }

    #[test]
    fn parses_ssh_scp_style_remote() {
        assert_eq!(
            parse_git_remote_repo("git@github.com:acme/widgets.git"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
    }

    #[test]
    fn parses_ssh_url_style_remote() {
        assert_eq!(
            parse_git_remote_repo("ssh://git@github.com/acme/widgets.git"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
    }

    #[test]
    fn parses_https_remote_with_user_credential() {
        assert_eq!(
            parse_git_remote_repo("https://user@github.com/acme/widgets.git"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
    }

    #[test]
    fn rejects_non_github_remote() {
        assert_eq!(
            parse_git_remote_repo("https://gitlab.com/acme/widgets.git"),
            None
        );
        assert_eq!(
            parse_git_remote_repo("git@bitbucket.org:acme/widgets.git"),
            None
        );
    }

    #[test]
    fn rejects_incomplete_remote() {
        assert_eq!(parse_git_remote_repo("https://github.com/acme"), None);
        assert_eq!(parse_git_remote_repo(""), None);
    }

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

    #[test]
    fn parses_github_pull_request_url() {
        let parsed = super::parse_github_pr_url(
            " https://github.com/openforge/app/pull/1431?notification_referrer_id=1 ",
        )
        .expect("valid GitHub PR URL should parse");

        assert_eq!(parsed.owner, "openforge");
        assert_eq!(parsed.repo, "app");
        assert_eq!(parsed.number, 1431);
        assert_eq!(
            parsed.normalized_url,
            "https://github.com/openforge/app/pull/1431"
        );
    }

    #[test]
    fn link_pull_request_persists_synthetic_pr_for_task() {
        let (db, path) = make_test_db("link_pull_request_persists");
        let task = db
            .create_task("Link a PR", "doing", None, None, None)
            .expect("create task");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr = super::link_pull_request(&db, &task.id, "https://github.com/owner/repo/pull/77")
            .expect("link PR");

        assert_eq!(pr.ticket_id, task.id);
        assert_eq!(pr.repo_owner, "owner");
        assert_eq!(pr.repo_name, "repo");
        assert_eq!(pr.pr_number, 77);
        assert!(pr.id < 0, "manual links use a synthetic negative row id");
        assert_eq!(pr.title, "owner/repo#77");
        assert_eq!(pr.state, "open");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn link_pull_request_reuses_existing_pr_row_for_same_repository_number() {
        let (db, path) = make_test_db("link_pull_request_reuses_existing");
        let old_task = db
            .create_task("Old link", "doing", None, None, None)
            .expect("create old task");
        let new_task = db
            .create_task("New link", "doing", None, None, None)
            .expect("create new task");
        db.insert_pull_request_with_number(
            123456,
            77,
            &old_task.id,
            "owner",
            "repo",
            "Fetched GitHub title",
            "https://github.com/owner/repo/pull/77",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert existing PR");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr =
            super::link_pull_request(&db, &new_task.id, "https://github.com/owner/repo/pull/77")
                .expect("link PR");

        assert_eq!(pr.id, 123456);
        assert_eq!(pr.ticket_id, new_task.id);
        assert_eq!(pr.title, "Fetched GitHub title");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn falls_back_to_authored_search_when_db_is_empty() {
        assert!(should_fallback_to_search(0, 2, 0, Some(100), 120));
    }

    #[test]
    fn skips_authored_search_when_recent_events_cover_existing_cache() {
        assert!(!should_fallback_to_search(4, 2, 0, Some(100), 120));
    }

    #[test]
    fn falls_back_to_authored_search_when_reconciliation_is_stale() {
        assert!(should_fallback_to_search(4, 2, 0, Some(100), 401));
    }
}
