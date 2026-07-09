//! Clone a GitHub repository and create a project from it.
//!
//! Composes the existing `git`-binary clone pattern, the stored GitHub PAT, and
//! the project registry into a single "add project from GitHub" flow.

use base64::{engine::general_purpose, Engine as _};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::process::Command;

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

/// Builds the `Authorization: Basic <base64>` header value used to authenticate
/// an HTTPS clone. GitHub accepts a PAT as the password with any username; we
/// use `x-access-token` to match the actions/checkout convention.
pub fn auth_header_value(token: &str) -> String {
    let encoded = general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
    format!("Authorization: Basic {encoded}")
}

/// Assembles the `git` args for the clone. For HTTPS clones with a token, the
/// credential is passed via an ephemeral `-c http.extraHeader` so it is used for
/// the fetch but never written into the cloned repo's `.git/config`. SSH clones
/// rely on the user's ambient SSH keys and never receive the token.
pub fn build_clone_args(
    clone_url: &str,
    target: &Path,
    is_ssh: bool,
    token: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if let (false, Some(token)) = (is_ssh, token) {
        args.push("-c".to_string());
        args.push(format!("http.extraHeader={}", auth_header_value(token)));
    }
    args.push("clone".to_string());
    args.push(clone_url.to_string());
    args.push(target.to_string_lossy().to_string());
    args
}

/// Trims and length-caps git's stderr for user display. Truncation is by
/// character (never mid-UTF-8) and appends an ellipsis so the user can see the
/// message was cut off.
pub fn sanitize_clone_error(stderr: &str) -> String {
    const MAX_CHARS: usize = 500;
    let trimmed = stderr.trim();
    if trimmed.chars().count() > MAX_CHARS {
        let truncated: String = trimmed.chars().take(MAX_CHARS).collect();
        format!("{truncated}…")
    } else {
        trimmed.to_string()
    }
}

/// Removes a partial clone directory so a failed attempt doesn't block a retry.
pub fn cleanup_partial_clone(target: &Path) {
    if target.exists() {
        let _ = std::fs::remove_dir_all(target);
    }
}

/// Shared tail for both add-from-git flows: resolve the destination, serialize
/// on it, guard against collisions, clone, register the project, and roll back a
/// partial clone if the DB insert fails.
async fn clone_into_new_project(
    db: &Arc<Mutex<crate::db::Database>>,
    parsed: &ParsedRepo,
    parent_dir: &str,
    token: Option<&str>,
    name: &str,
) -> Result<crate::db::ProjectRow, String> {
    let target = resolve_target_path(Path::new(parent_dir), &parsed.repo)?;

    // Serialize concurrent clones to the same destination.
    let lock = crate::git_worktree::acquire_lock(&target);
    let _guard = lock.lock().await;

    // Collision guard — release the DB lock before any network/subprocess work.
    {
        let db = crate::db::acquire_db(db);
        check_target_available(&target, &db)?;
    }

    clone_repo(parsed, &target, token).await?;

    let project = {
        let db = crate::db::acquire_db(db);
        db.create_project(name, &target.to_string_lossy())
            .map_err(|e| {
                // The row failed to insert after a successful clone — roll back the
                // on-disk clone so the destination is free for a retry.
                cleanup_partial_clone(&target);
                format!("Failed to create project: {e}")
            })?
    };
    Ok(project)
}

/// End-to-end (clone an existing repo): parse the URL, optionally pre-check
/// access with the stored PAT, then clone + register via the shared helper.
pub async fn create_project_from_git(
    db: &Arc<Mutex<crate::db::Database>>,
    github_client: &crate::github_client::GitHubClient,
    url: &str,
    parent_dir: &str,
    name: &str,
) -> Result<crate::db::ProjectRow, String> {
    let parsed = parse_repo_url(url)?;

    // Access pre-check only when a PAT is stored; tolerate inconclusive results.
    let token = crate::github_runtime::github_token().ok();
    if let Some(token) = token.as_deref() {
        match github_client
            .check_repo_access(&parsed.owner, &parsed.repo, token)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return Err(format!(
                    "Repository {}/{} was not found or you don't have access to it.",
                    parsed.owner, parsed.repo
                ));
            }
            Err(err) => {
                log::warn!("GitHub access pre-check failed, proceeding to clone: {err}");
            }
        }
    }

    clone_into_new_project(db, &parsed, parent_dir, token.as_deref(), name).await
}

/// End-to-end (create a new repo): create an empty repository on the user's
/// GitHub account, then clone + register via the shared helper. The project name
/// is the user's typed `name`; the on-disk folder is the repo's real name from
/// the clone URL GitHub returns.
pub async fn create_project_from_new_repo(
    db: &Arc<Mutex<crate::db::Database>>,
    github_client: &crate::github_client::GitHubClient,
    name: &str,
    parent_dir: &str,
    private: bool,
) -> Result<crate::db::ProjectRow, String> {
    let token = crate::github_runtime::github_token().map_err(|_| {
        "Connect a GitHub token with 'repo' scope in Settings to create repositories.".to_string()
    })?;

    let created = github_client
        .create_repo(name, private, &token)
        .await
        .map_err(|e| format!("Failed to create GitHub repository: {e}"))?;

    let parsed = parse_repo_url(&created.clone_url)?;
    clone_into_new_project(db, &parsed, parent_dir, Some(&token), name).await
}

/// Clones `parsed` into `target` via the `git` binary, cleaning up on failure.
pub async fn clone_repo(
    parsed: &ParsedRepo,
    target: &Path,
    token: Option<&str>,
) -> Result<(), String> {
    let args = build_clone_args(&parsed.clone_url, target, parsed.is_ssh, token);
    let output = Command::new("git")
        .env("PATH", crate::user_environment::user_tool_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run git clone: {e}"))?;

    if !output.status.success() {
        cleanup_partial_clone(target);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "git clone failed: {}",
            sanitize_clone_error(&stderr)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose;
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

    #[test]
    fn auth_header_uses_basic_scheme_with_token_as_password() {
        let header = auth_header_value("secret-token");
        let encoded = header
            .strip_prefix("Authorization: Basic ")
            .expect("basic scheme prefix");
        let decoded = String::from_utf8(
            general_purpose::STANDARD
                .decode(encoded)
                .expect("valid base64"),
        )
        .unwrap();
        assert_eq!(decoded, "x-access-token:secret-token");
    }

    #[test]
    fn https_clone_with_token_injects_ephemeral_auth_header() {
        let args = build_clone_args(
            "https://github.com/acme/widgets.git",
            Path::new("/tmp/widgets"),
            false,
            Some("tok"),
        );
        assert_eq!(args[0], "-c");
        assert!(args[1].starts_with("http.extraHeader=Authorization: Basic "));
        assert!(args.contains(&"clone".to_string()));
        assert!(args.contains(&"https://github.com/acme/widgets.git".to_string()));
        assert!(args.contains(&"/tmp/widgets".to_string()));
    }

    #[test]
    fn ssh_clone_never_injects_token() {
        let args = build_clone_args(
            "git@github.com:acme/widgets.git",
            Path::new("/tmp/widgets"),
            true,
            Some("tok"),
        );
        assert!(!args.iter().any(|a| a == "-c"));
        assert!(!args.iter().any(|a| a.contains("extraHeader")));
        assert!(
            !args.iter().any(|a| a.contains("tok")),
            "the token string must never appear in SSH clone args"
        );
    }

    #[test]
    fn https_clone_without_token_has_no_auth_header() {
        let args = build_clone_args(
            "https://github.com/acme/widgets.git",
            Path::new("/tmp/widgets"),
            false,
            None,
        );
        assert!(!args.iter().any(|a| a == "-c"));
        assert_eq!(args[0], "clone");
    }

    #[test]
    fn sanitize_clone_error_trims_and_caps_length() {
        let noisy = format!("  {}  ", "x".repeat(5000));
        let cleaned = sanitize_clone_error(&noisy);
        assert!(!cleaned.starts_with(' '));
        assert!(
            cleaned.ends_with('…'),
            "truncated output should end with an ellipsis"
        );
        // 500 content chars + 1 ellipsis char
        assert_eq!(cleaned.chars().count(), 501);
    }

    #[test]
    fn sanitize_clone_error_handles_multibyte_without_panic() {
        // A long non-ASCII message must not panic on a byte-boundary slice.
        let noisy = "é".repeat(600);
        let cleaned = sanitize_clone_error(&noisy);
        assert!(cleaned.ends_with('…'));
        assert_eq!(cleaned.chars().count(), 501);
    }

    #[test]
    fn cleanup_partial_clone_removes_directory() {
        let parent = tempdir().unwrap();
        let target = parent.path().join("half-clone");
        std::fs::create_dir_all(target.join("nested")).unwrap();
        std::fs::write(target.join("nested/file.txt"), b"x").unwrap();
        cleanup_partial_clone(&target);
        assert!(!target.exists());
    }

    #[tokio::test]
    async fn clone_into_new_project_rejects_existing_target() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_into_existing_target");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));
        let parent = tempdir().unwrap();
        std::fs::create_dir(parent.path().join("widgets")).unwrap();

        let parsed = ParsedRepo {
            owner: "acme".to_string(),
            repo: "widgets".to_string(),
            clone_url: "https://github.com/acme/widgets.git".to_string(),
            is_ssh: false,
        };
        let result = clone_into_new_project(
            &db,
            &parsed,
            &parent.path().to_string_lossy(),
            None,
            "Widgets",
        )
        .await;

        assert!(result.is_err(), "existing target dir must be rejected");
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[tokio::test]
    async fn create_project_from_git_rejects_existing_target_before_cloning() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_orch_collision");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));
        let client = crate::github_client::GitHubClient::new();

        let parent = tempdir().unwrap();
        // Pre-create the destination so the collision guard trips.
        std::fs::create_dir(parent.path().join("widgets")).unwrap();

        // Use a shorthand-style owner/repo so parsing yields repo "widgets".
        let result = create_project_from_git(
            &db,
            &client,
            "acme/widgets",
            &parent.path().to_string_lossy(),
            "Widgets",
        )
        .await;

        assert!(result.is_err(), "existing target dir must be rejected");
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }
}
