//! Clone a GitHub repository and create a project from it.
//!
//! Composes the existing `git`-binary clone pattern, the stored GitHub PAT, and
//! the project registry into a single "add project from GitHub" flow.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRepo {
    pub owner: String,
    pub repo: String,
    pub clone_url: String,
    pub is_ssh: bool,
}

/// Parses a GitHub repository reference in HTTPS, SSH, or `owner/repo`
/// shorthand form into its owner, repo, canonical clone URL, and transport.
pub fn parse_repo_url(input: &str) -> Result<ParsedRepo, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository URL cannot be empty".to_string());
    }

    // SSH: git@github.com:owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let (owner, repo) = split_owner_repo(rest)?;
        return Ok(ParsedRepo {
            clone_url: format!("git@github.com:{owner}/{repo}.git"),
            owner,
            repo,
            is_ssh: true,
        });
    }

    // HTTPS/HTTP: https://github.com/owner/repo(.git)(/...)
    for prefix in ["https://github.com/", "http://github.com/"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let (owner, repo) = split_owner_repo(rest)?;
            return Ok(ParsedRepo {
                clone_url: format!("https://github.com/{owner}/{repo}.git"),
                owner,
                repo,
                is_ssh: false,
            });
        }
    }

    // Any other explicit scheme or SSH host is unsupported.
    if trimmed.contains("://") || trimmed.starts_with("git@") {
        return Err(format!("Only GitHub repositories are supported: {trimmed}"));
    }

    // Shorthand: owner/repo
    let (owner, repo) = split_owner_repo(trimmed)?;
    Ok(ParsedRepo {
        clone_url: format!("https://github.com/{owner}/{repo}.git"),
        owner,
        repo,
        is_ssh: false,
    })
}

/// Extracts the first two path segments (`owner`, `repo`) from the remainder of
/// a GitHub reference, stripping a trailing `.git`, query, and fragment.
fn split_owner_repo(rest: &str) -> Result<(String, String), String> {
    let cleaned = rest.trim_end_matches('/');
    let mut segments = cleaned.split('/');
    let owner = segments.next().unwrap_or("").trim().to_string();
    let repo_seg = segments.next().unwrap_or("").trim();
    if owner.is_empty() || repo_seg.is_empty() {
        return Err(format!("Could not parse owner/repo from: {rest}"));
    }
    let repo = repo_seg
        .split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or(repo_seg);
    let repo = repo.strip_suffix(".git").unwrap_or(repo).to_string();
    if repo.is_empty() {
        return Err(format!("Could not parse repository name from: {rest}"));
    }
    Ok((owner, repo))
}

/// Resolves the clone destination as `<canonical parent>/<repo_name>`, rejecting
/// a parent that isn't an accessible directory and any repo name that could
/// escape the parent (path separators, `.`/`..`).
pub fn resolve_target_path(parent_dir: &Path, repo_name: &str) -> Result<PathBuf, String> {
    if repo_name.is_empty()
        || repo_name.contains('/')
        || repo_name.contains('\\')
        || repo_name == "."
        || repo_name == ".."
    {
        return Err(format!("Invalid repository folder name: {repo_name}"));
    }
    let metadata = std::fs::metadata(parent_dir)
        .map_err(|e| format!("Parent folder is not accessible: {e}"))?;
    if !metadata.is_dir() {
        return Err(format!(
            "Parent path is not a directory: {}",
            parent_dir.display()
        ));
    }
    let canonical_parent = std::fs::canonicalize(parent_dir)
        .map_err(|e| format!("Failed to resolve parent folder: {e}"))?;
    Ok(canonical_parent.join(repo_name))
}

/// Errors if the clone destination already exists on disk or is already
/// registered as a project. This is the "ensure it doesn't already exist" guard.
pub fn check_target_available(target: &Path, db: &crate::db::Database) -> Result<(), String> {
    if target.exists() {
        return Err(format!(
            "A folder already exists at {}. Choose a different parent folder or remove it first.",
            target.display()
        ));
    }
    let target_str = target.to_string_lossy().to_string();
    if db
        .project_with_path_exists(&target_str)
        .map_err(|e| format!("Failed to check existing projects: {e}"))?
    {
        return Err(format!(
            "A project is already registered at {}.",
            target.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn resolve_target_joins_repo_name_onto_parent() {
        let parent = tempdir().unwrap();
        let target = resolve_target_path(parent.path(), "widgets").unwrap();
        assert_eq!(target.file_name().unwrap(), "widgets");
        assert!(target.starts_with(std::fs::canonicalize(parent.path()).unwrap()));
    }

    #[test]
    fn resolve_target_rejects_traversal_repo_name() {
        let parent = tempdir().unwrap();
        assert!(resolve_target_path(parent.path(), "..").is_err());
        assert!(resolve_target_path(parent.path(), "a/b").is_err());
    }

    #[test]
    fn resolve_target_rejects_missing_parent() {
        assert!(resolve_target_path(Path::new("/no/such/parent/xyz"), "widgets").is_err());
    }

    #[test]
    fn check_target_available_ok_for_free_path() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_free");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        assert!(check_target_available(&target, &db).is_ok());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[test]
    fn check_target_available_errors_when_dir_exists() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_dir_exists");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        std::fs::create_dir(&target).unwrap();
        assert!(check_target_available(&target, &db).is_err());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[test]
    fn check_target_available_errors_when_project_registered() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_registered");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        db.create_project("Widgets", &target.to_string_lossy())
            .expect("create project failed");
        assert!(check_target_available(&target, &db).is_err());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[test]
    fn parses_full_https_url() {
        let parsed = parse_repo_url("https://github.com/acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn parses_https_url_with_dot_git_and_trailing_path() {
        let parsed = parse_repo_url("https://github.com/acme/widgets.git/tree/main").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
    }

    #[test]
    fn parses_ssh_url() {
        let parsed = parse_repo_url("git@github.com:acme/widgets.git").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "git@github.com:acme/widgets.git");
        assert!(parsed.is_ssh);
    }

    #[test]
    fn parses_shorthand() {
        let parsed = parse_repo_url("acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse_repo_url("   ").is_err());
    }

    #[test]
    fn rejects_non_github_url() {
        assert!(parse_repo_url("https://gitlab.com/acme/widgets").is_err());
    }

    #[test]
    fn rejects_missing_repo_segment() {
        assert!(parse_repo_url("acme").is_err());
    }
}
