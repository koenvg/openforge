use std::sync::Mutex;

use serde::Serialize;

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
    let token = github_token().await?;
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssuesReadiness {
    pub ready: bool,
    pub reason: Option<String>,
}

/// Pure readiness decision — no I/O.
/// - `token_present`: is a github_token configured?
/// - `project_scope`: true for a project-level choice, false for the global default.
/// - `repo`: resolved (owner, name) for a project, else None.
/// - `access`: Some(result) from check_repo_access, or None when not checked / inconclusive.
pub fn evaluate_issues_readiness(
    token_present: bool,
    project_scope: bool,
    repo: Option<(String, String)>,
    access: Option<bool>,
) -> IssuesReadiness {
    if !token_present {
        return IssuesReadiness {
            ready: false,
            reason: Some("No GitHub token configured. Add one in Credentials.".to_string()),
        };
    }
    if !project_scope {
        return IssuesReadiness {
            ready: true,
            reason: None,
        };
    }
    let Some((owner, name)) = repo else {
        return IssuesReadiness {
            ready: false,
            reason: Some(
                "Couldn't resolve a GitHub repository from this project's git remote.".to_string(),
            ),
        };
    };
    match access {
        Some(true) => IssuesReadiness {
            ready: true,
            reason: None,
        },
        Some(false) => IssuesReadiness {
            ready: false,
            reason: Some(format!(
                "The configured GitHub token can't access {owner}/{name}."
            )),
        },
        None => IssuesReadiness {
            ready: false,
            reason: Some(format!("Couldn't verify access to {owner}/{name}.")),
        },
    }
}

/// Gather inputs (token, repo, access) and evaluate readiness for filing issues.
pub async fn check_github_issues_ready(
    github_client: &GitHubClient,
    db: &Mutex<db::Database>,
    project_id: Option<String>,
) -> Result<IssuesReadiness, String> {
    let token = match github_token().await {
        Ok(t) => t,
        Err(_) => {
            return Ok(evaluate_issues_readiness(
                false,
                project_id.is_some(),
                None,
                None,
            ));
        }
    };

    let Some(pid) = project_id else {
        return Ok(evaluate_issues_readiness(true, false, None, None));
    };

    let repo_tuple = get_project_repo(db, &pid)?.map(|r| (r.owner, r.name));

    let access = match &repo_tuple {
        Some((owner, name)) => match github_client.check_repo_access(owner, name, &token).await {
            Ok(v) => Some(v),
            Err(_) => None,
        },
        None => None,
    };

    Ok(evaluate_issues_readiness(true, true, repo_tuple, access))
}

#[cfg(test)]
mod readiness_tests {
    use super::*;

    #[test]
    fn missing_token_is_not_ready() {
        let r = evaluate_issues_readiness(false, true, Some(("o".into(), "r".into())), Some(true));
        assert!(!r.ready);
        assert!(r.reason.unwrap().to_lowercase().contains("token"));
    }

    #[test]
    fn global_scope_ready_with_token() {
        let r = evaluate_issues_readiness(true, false, None, None);
        assert!(r.ready);
        assert!(r.reason.is_none());
    }

    #[test]
    fn project_scope_unresolved_repo_is_not_ready() {
        let r = evaluate_issues_readiness(true, true, None, None);
        assert!(!r.ready);
        assert!(r.reason.unwrap().to_lowercase().contains("resolve"));
    }

    #[test]
    fn project_scope_denied_access_is_not_ready() {
        let r = evaluate_issues_readiness(true, true, Some(("o".into(), "r".into())), Some(false));
        assert!(!r.ready);
    }

    #[test]
    fn project_scope_access_ok_is_ready() {
        let r = evaluate_issues_readiness(true, true, Some(("o".into(), "r".into())), Some(true));
        assert!(r.ready);
        assert!(r.reason.is_none());
    }
}
