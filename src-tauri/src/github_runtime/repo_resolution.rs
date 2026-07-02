use crate::db;
use serde::Serialize;
use std::sync::Mutex;

/// Parse a git `origin` remote URL into `(owner, repo)`, supporting the common
/// GitHub forms (https, ssh `git@`, `ssh://`, `git://`, and `user@host` variants).
/// Returns `None` for non-GitHub or unparseable remotes.
fn parse_git_remote_repo(remote_url: &str) -> Option<(String, String)> {
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
fn resolve_project_repo_from_path(project_path: &str) -> Option<(String, String)> {
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

#[cfg(test)]
mod tests {
    use super::parse_git_remote_repo;

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
}
