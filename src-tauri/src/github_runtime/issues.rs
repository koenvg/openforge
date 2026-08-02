use std::sync::Mutex;

use super::auth::github_token;
use super::repo_resolution::get_project_repo;
use crate::db;
use crate::github_client::GitHubClient;

/// File a cleanup item as a GitHub issue in the project's repo. Returns the
/// issue's html_url. Errors (no token, unresolved repo, API failure) surface as
/// Strings for the caller to handle (fallback + warning).
pub async fn create_cleanup_issue(
    github_client: &GitHubClient,
    db: &Mutex<db::Database>,
    project_id: &str,
    title: &str,
    body: &str,
) -> Result<String, String> {
    let token = github_token()?;
    let repo = get_project_repo(db, project_id)?.ok_or_else(|| {
        "Could not resolve a GitHub repository from this project's git remote".to_string()
    })?;

    github_client
        .ensure_label(&repo.owner, &repo.name, "cleanup", &token)
        .await;

    let issue = github_client
        .create_issue(
            &repo.owner,
            &repo.name,
            title,
            body,
            vec!["cleanup".to_string()],
            &token,
        )
        .await
        .map_err(|e| format!("Failed to create GitHub issue: {e}"))?;

    Ok(issue.html_url)
}
