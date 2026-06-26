use crate::user_environment::user_tool_path;
use dashmap::DashMap;
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

// ============================================================================
// Error Type
// ============================================================================

#[derive(Debug)]
pub enum GitWorktreeError {
    WorktreeAddFailed(String),
    WorktreeRemoveFailed(String),
    IoError(io::Error),
}

impl fmt::Display for GitWorktreeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitWorktreeError::WorktreeAddFailed(msg) => {
                write!(f, "Failed to add worktree: {}", msg)
            }
            GitWorktreeError::WorktreeRemoveFailed(msg) => {
                write!(f, "Failed to remove worktree: {}", msg)
            }
            GitWorktreeError::IoError(e) => {
                write!(f, "IO error: {}", e)
            }
        }
    }
}

impl std::error::Error for GitWorktreeError {}

impl From<io::Error> for GitWorktreeError {
    fn from(err: io::Error) -> Self {
        GitWorktreeError::IoError(err)
    }
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

// ============================================================================
// Per-Path Locking
// ============================================================================

static WORKTREE_LOCKS: Lazy<DashMap<String, Arc<Mutex<()>>>> = Lazy::new(DashMap::new);

/// Acquires a lock for the given repository path to prevent concurrent worktree operations
fn acquire_lock(repo_path: &Path) -> Arc<Mutex<()>> {
    let path_key = repo_path.to_string_lossy().to_string();
    WORKTREE_LOCKS
        .entry(path_key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// ============================================================================
// Command Environment
// ============================================================================

fn safe_subprocess_current_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::temp_dir()
    }

    #[cfg(not(windows))]
    {
        PathBuf::from("/")
    }
}

fn git_command() -> Command {
    let mut command = Command::new("git");
    command.env("PATH", user_tool_path());
    command.current_dir(safe_subprocess_current_dir());
    command
}

fn rm_command() -> Command {
    let mut command = Command::new("rm");
    command.env("PATH", user_tool_path());
    command.current_dir(safe_subprocess_current_dir());
    command
}

fn protected_location_guidance() -> &'static str {
    "If this repository is in Documents, Desktop, Downloads, iCloud Drive, or another macOS protected location, reselect it with OpenForge's Browse button when prompted or grant OpenForge Full Disk Access in System Settings."
}

fn repository_access_error(repo_path: &Path, err: &io::Error) -> GitWorktreeError {
    GitWorktreeError::WorktreeAddFailed(format!(
        "Cannot access repository path '{}': {err}. {}",
        repo_path.display(),
        protected_location_guidance()
    ))
}

fn validate_repository_path_access(repo_path: &Path) -> Result<(), GitWorktreeError> {
    let metadata =
        std::fs::metadata(repo_path).map_err(|err| repository_access_error(repo_path, &err))?;
    if !metadata.is_dir() {
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "Repository path '{}' is not a directory",
            repo_path.display()
        )));
    }

    std::fs::read_dir(repo_path)
        .map(|_| ())
        .map_err(|err| repository_access_error(repo_path, &err))
}

async fn git_ref_exists(repo_path: &Path, git_ref: &str) -> Result<bool, GitWorktreeError> {
    let refspec = format!("{}^{{commit}}", git_ref);
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("--quiet")
        .arg(refspec)
        .output()
        .await?;

    Ok(output.status.success())
}

fn normalize_branch_ref(branch_ref: &str) -> Result<&str, GitWorktreeError> {
    let branch_ref = branch_ref.trim();
    if branch_ref.is_empty() {
        return Err(GitWorktreeError::WorktreeAddFailed(
            "branch is required for existing branch worktrees".to_string(),
        ));
    }
    if branch_ref.starts_with('-') {
        return Err(GitWorktreeError::WorktreeAddFailed(
            "branch names starting with '-' are not supported".to_string(),
        ));
    }
    Ok(branch_ref)
}

fn local_branch_from_remote_ref(remote_ref: &str) -> Option<&str> {
    let (_remote, branch_name) = remote_ref.split_once('/')?;
    if branch_name.is_empty() {
        return None;
    }
    Some(branch_name)
}

/// Relationship between an existing local branch and a requested remote ref,
/// used to decide whether a stale local branch can be safely reused for a
/// worktree or whether reusing it would silently discard or merge local work.
enum LocalBranchRelation {
    /// Local equals the remote, or is purely behind it (fast-forwardable).
    /// Reusing the local branch is safe.
    EqualOrBehind,
    /// Local is strictly ahead of, or has diverged from, the remote. Reusing
    /// the local branch would require destroying or merging local commits, so
    /// the caller must refuse and leave everything untouched.
    AheadOrDiverged { ahead: usize, behind: usize },
}

/// Returns whether `ancestor` is an ancestor of (or equal to) `descendant`,
/// using `git merge-base --is-ancestor` (exit status 0 => ancestor).
async fn git_ref_is_ancestor(
    repo_path: &Path,
    ancestor: &str,
    descendant: &str,
) -> Result<bool, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("merge-base")
        .arg("--is-ancestor")
        .arg(ancestor)
        .arg(descendant)
        .output()
        .await?;

    Ok(output.status.success())
}

/// Computes how many commits the local branch is ahead/behind the remote ref.
///
/// `git rev-list --left-right --count {local}...{remote}` prints two numbers:
/// the left count is commits reachable only from `local` (ahead) and the right
/// count is commits reachable only from `remote` (behind).
async fn git_ahead_behind(
    repo_path: &Path,
    local_full_ref: &str,
    remote_ref: &str,
) -> Result<(usize, usize), GitWorktreeError> {
    let range = format!("{local_full_ref}...{remote_ref}");
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg(range)
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "failed to compare local branch '{local_full_ref}' with '{remote_ref}': {stderr}"
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut counts = stdout.split_whitespace();
    let ahead = counts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let behind = counts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    Ok((ahead, behind))
}

/// Classifies the existing local branch against the requested remote ref by
/// git ancestry. The local side is resolved to its full `refs/heads/{local}`
/// form; `remote_ref` is the already-validated remote-tracking ref (e.g.
/// `origin/<branch>`), which resolves unambiguously here because this is only
/// reached after confirming `refs/remotes/{remote_ref}` exists and ruling out a
/// local branch of that name. Reuses `git_ref_is_ancestor` / `git_ahead_behind`.
async fn classify_local_branch_against_remote(
    repo_path: &Path,
    local_branch: &str,
    remote_ref: &str,
) -> Result<LocalBranchRelation, GitWorktreeError> {
    let local_full_ref = format!("refs/heads/{local_branch}");

    // Local is equal to or purely behind the remote when it is an ancestor of
    // the remote (equality counts as an ancestor for --is-ancestor).
    if git_ref_is_ancestor(repo_path, &local_full_ref, remote_ref).await? {
        return Ok(LocalBranchRelation::EqualOrBehind);
    }

    let (ahead, behind) = git_ahead_behind(repo_path, &local_full_ref, remote_ref).await?;
    Ok(LocalBranchRelation::AheadOrDiverged { ahead, behind })
}

async fn fetch_origin_best_effort(repo_path: &Path) -> Result<(), GitWorktreeError> {
    let fetch_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .output()
        .await?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        warn!("Warning: git fetch origin failed: {}", stderr);
    }

    Ok(())
}

pub async fn list_git_branches(repo_path: &Path) -> Result<Vec<GitBranchInfo>, GitWorktreeError> {
    validate_repository_path_access(repo_path)?;
    fetch_origin_best_effort(repo_path).await?;

    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("branch")
        .arg("--all")
        .arg("--format=%(HEAD)%09%(refname)%09%(refname:short)")
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    let mut branches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.splitn(3, '\t');
        let head = parts.next().unwrap_or("").trim();
        let full_ref = parts.next().unwrap_or("").trim();
        let short_ref = parts.next().unwrap_or("").trim();
        if short_ref.is_empty() {
            continue;
        }
        if full_ref.starts_with("refs/remotes/") && short_ref.ends_with("/HEAD") {
            continue;
        }
        if branches
            .iter()
            .any(|branch: &GitBranchInfo| branch.name == short_ref)
        {
            continue;
        }
        branches.push(GitBranchInfo {
            name: short_ref.to_string(),
            is_current: head == "*",
            is_remote: full_ref.starts_with("refs/remotes/"),
        });
    }

    Ok(branches)
}

fn remote_name_from_ref(git_ref: &str) -> Option<&str> {
    let (remote_name, branch_name) = git_ref.split_once('/')?;
    if remote_name.is_empty() || branch_name.is_empty() {
        return None;
    }

    Some(remote_name)
}

async fn git_remote_names(repo_path: &Path) -> Result<Vec<String>, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("remote")
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|remote_name| !remote_name.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

async fn current_worktree_branch(worktree_path: &Path) -> Result<String, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(worktree_path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "worktree path '{}' already exists but its current branch could not be read: {}",
            worktree_path.display(),
            stderr.trim()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn worktree_has_local_changes(worktree_path: &Path) -> Result<bool, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(worktree_path)
        .arg("status")
        .arg("--porcelain")
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "worktree path '{}' already exists but its status could not be read: {}",
            worktree_path.display(),
            stderr.trim()
        )));
    }

    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

async fn existing_worktree_path_matches_branch(
    repo_path: &Path,
    worktree_path: &Path,
    expected_branch: &str,
) -> Result<bool, GitWorktreeError> {
    if !worktree_path.exists() {
        return Ok(false);
    }

    let current_branch = current_worktree_branch(worktree_path).await?;
    if current_branch == expected_branch {
        return Ok(true);
    }

    if worktree_has_local_changes(worktree_path).await? {
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "worktree path '{}' already exists on branch '{}' instead of '{}' and has local changes; clean or remove it before starting this task",
            worktree_path.display(),
            current_branch,
            expected_branch
        )));
    }

    let remove_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg(worktree_path)
        .output()
        .await?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "worktree path '{}' already exists on branch '{}' instead of '{}' and could not be removed: {}",
            worktree_path.display(),
            current_branch,
            expected_branch,
            stderr.trim()
        )));
    }

    let _ = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await;

    Ok(false)
}

async fn resolve_remote_head_ref(
    repo_path: &Path,
    remote_name: &str,
) -> Result<Option<String>, GitWorktreeError> {
    let remote_head_ref = format!("{}/HEAD", remote_name);
    if git_ref_exists(repo_path, &remote_head_ref).await? {
        return Ok(Some(remote_head_ref));
    }

    Ok(None)
}

async fn resolve_worktree_base_ref(
    repo_path: &Path,
    preferred_base_ref: &str,
) -> Result<String, GitWorktreeError> {
    if git_ref_exists(repo_path, preferred_base_ref).await? {
        return Ok(preferred_base_ref.to_string());
    }

    let remote_names = git_remote_names(repo_path).await?;
    if let Some(remote_name) = remote_name_from_ref(preferred_base_ref) {
        if remote_names.iter().any(|name| name == remote_name) {
            if let Some(remote_head_ref) = resolve_remote_head_ref(repo_path, remote_name).await? {
                warn!(
                    "Preferred worktree base ref '{}' is unavailable; falling back to {}",
                    preferred_base_ref, remote_head_ref
                );
                return Ok(remote_head_ref);
            }

            return Err(GitWorktreeError::WorktreeAddFailed(format!(
                "base ref '{}' is unavailable and remote '{}' exists, but {}/HEAD is not set; refusing to fall back to local HEAD",
                preferred_base_ref, remote_name, remote_name
            )));
        }
    }

    if remote_names.len() == 1 {
        let remote_name = &remote_names[0];
        if let Some(remote_head_ref) = resolve_remote_head_ref(repo_path, remote_name).await? {
            warn!(
                "Preferred worktree base ref '{}' is unavailable and remote '{}' is missing; falling back to {}",
                preferred_base_ref,
                remote_name_from_ref(preferred_base_ref).unwrap_or("<none>"),
                remote_head_ref
            );
            return Ok(remote_head_ref);
        }

        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "base ref '{}' is unavailable and remote '{}' is missing, but remote '{}' has no HEAD; refusing to fall back to local HEAD",
            preferred_base_ref,
            remote_name_from_ref(preferred_base_ref).unwrap_or("<none>"),
            remote_name
        )));
    }

    if remote_names.len() > 1 {
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "base ref '{}' is unavailable and multiple remotes exist ({}); refusing to fall back to local HEAD",
            preferred_base_ref,
            remote_names.join(", ")
        )));
    }

    if git_ref_exists(repo_path, "HEAD").await? {
        warn!(
            "Preferred worktree base ref '{}' is unavailable and the repository has no remotes; falling back to HEAD",
            preferred_base_ref
        );
        return Ok("HEAD".to_string());
    }

    Err(GitWorktreeError::WorktreeAddFailed(format!(
        "base ref '{}' is unavailable and HEAD is not a valid commit",
        preferred_base_ref
    )))
}

// ============================================================================
// Worktree Operations
// ============================================================================

/// Creates a new git worktree with a new branch based on a given reference.
/// If the worktree path already exists, it's considered a successful reuse.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path where the worktree should be created
/// * `branch_name` - Name of the new branch to create
/// * `base_ref` - Base reference (branch/commit) to branch from
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    validate_repository_path_access(repo_path)?;

    let prune_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        warn!("Warning: worktree prune failed: {}", stderr);
    }

    // Fetch latest from origin so the base ref (e.g. origin/main) is up to date
    fetch_origin_best_effort(repo_path).await?;

    if worktree_path.exists() {
        return Ok(());
    }

    let resolved_base_ref = resolve_worktree_base_ref(repo_path, base_ref).await?;
    let result =
        try_create_worktree_inner(repo_path, worktree_path, branch_name, &resolved_base_ref).await;

    if result.is_err() {
        info!("Worktree creation failed, attempting cleanup and retry...");

        let _ = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(worktree_path)
            .output()
            .await;

        let _ = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("prune")
            .output()
            .await;

        return try_create_worktree_inner(
            repo_path,
            worktree_path,
            branch_name,
            &resolved_base_ref,
        )
        .await;
    }

    result
}

pub async fn create_worktree_from_existing_branch(
    repo_path: &Path,
    worktree_path: &Path,
    branch_ref: &str,
) -> Result<String, GitWorktreeError> {
    let branch_ref = normalize_branch_ref(branch_ref)?;
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    validate_repository_path_access(repo_path)?;

    let prune_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        warn!("Warning: worktree prune failed: {}", stderr);
    }

    fetch_origin_best_effort(repo_path).await?;

    if git_ref_exists(repo_path, &format!("refs/heads/{branch_ref}")).await? {
        if existing_worktree_path_matches_branch(repo_path, worktree_path, branch_ref).await? {
            return Ok(branch_ref.to_string());
        }

        let output = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("add")
            .arg(worktree_path)
            .arg(branch_ref)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
        }

        return Ok(branch_ref.to_string());
    }

    if git_ref_exists(repo_path, &format!("refs/remotes/{branch_ref}")).await? {
        let local_branch = local_branch_from_remote_ref(branch_ref).ok_or_else(|| {
            GitWorktreeError::WorktreeAddFailed(format!(
                "remote branch '{}' cannot be converted to a local branch name",
                branch_ref
            ))
        })?;
        if existing_worktree_path_matches_branch(repo_path, worktree_path, local_branch).await? {
            return Ok(local_branch.to_string());
        }

        if git_ref_exists(repo_path, &format!("refs/heads/{local_branch}")).await? {
            // A stale local branch of the same name already exists. Decide
            // whether it can be safely reused for the worktree based on how it
            // relates to the requested remote ref.
            match classify_local_branch_against_remote(repo_path, local_branch, branch_ref).await? {
                LocalBranchRelation::EqualOrBehind => {
                    // Reuse the existing local branch (no -b) and fast-forward it
                    // to the remote tip. --ff-only is a no-op when already equal
                    // and can never create a merge commit.
                    let output = git_command()
                        .arg("-C")
                        .arg(repo_path)
                        .arg("worktree")
                        .arg("add")
                        .arg(worktree_path)
                        .arg(local_branch)
                        .output()
                        .await?;

                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
                    }

                    let merge_output = git_command()
                        .arg("-C")
                        .arg(worktree_path)
                        .arg("merge")
                        .arg("--ff-only")
                        .arg(branch_ref)
                        .output()
                        .await?;

                    if !merge_output.status.success() {
                        let stderr = String::from_utf8_lossy(&merge_output.stderr);
                        return Err(GitWorktreeError::WorktreeAddFailed(format!(
                            "failed to fast-forward local branch '{local_branch}' to '{branch_ref}': {stderr}"
                        )));
                    }

                    let _ = git_command()
                        .arg("-C")
                        .arg(worktree_path)
                        .arg("branch")
                        .arg("--set-upstream-to")
                        .arg(branch_ref)
                        .arg(local_branch)
                        .output()
                        .await;

                    return Ok(local_branch.to_string());
                }
                LocalBranchRelation::AheadOrDiverged { ahead, behind } => {
                    // Reusing this branch would discard or merge local work, so
                    // mutate nothing and ask the user to resolve it explicitly.
                    return Err(GitWorktreeError::WorktreeAddFailed(format!(
                        "local branch '{local_branch}' has diverged from '{branch_ref}' \
                         (local is {ahead} commit(s) ahead, {behind} behind); delete or rename \
                         the local branch to use the remote version, or start the task from the \
                         local branch '{local_branch}' to keep your local work"
                    )));
                }
            }
        }

        let output = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg(local_branch)
            .arg(worktree_path)
            .arg(branch_ref)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
        }

        let _ = git_command()
            .arg("-C")
            .arg(worktree_path)
            .arg("branch")
            .arg("--set-upstream-to")
            .arg(branch_ref)
            .arg(local_branch)
            .output()
            .await;

        return Ok(local_branch.to_string());
    }

    Err(GitWorktreeError::WorktreeAddFailed(format!(
        "branch '{}' does not exist",
        branch_ref
    )))
}

async fn try_create_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let add_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(branch_name)
        .arg(worktree_path)
        .arg(base_ref)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    let _ = git_command()
        .arg("-C")
        .arg(worktree_path)
        .arg("branch")
        .arg("--unset-upstream")
        .output()
        .await;

    Ok(())
}

/// Removes a git worktree and cleans up all associated metadata.
/// Performs a 4-step cleanup process to ensure complete removal.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path to the worktree to remove
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn remove_worktree(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<(), GitWorktreeError> {
    remove_worktree_with_branch(repo_path, worktree_path, None).await
}

pub async fn remove_worktree_with_branch(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: Option<&str>,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    // Step 1: Force remove the worktree via git
    let remove_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .await?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        warn!("Warning: git worktree remove failed: {}", stderr);
    }

    // Step 2: Remove .git/worktrees metadata
    let worktree_name = worktree_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let git_dir = repo_path.join(".git").join("worktrees").join(worktree_name);
    if git_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&git_dir) {
            warn!("Warning: failed to remove worktree metadata: {}", e);
        }
    }

    // Step 3: Force remove the filesystem directory
    if worktree_path.exists() {
        let rm_output = rm_command().arg("-rf").arg(worktree_path).output().await?;

        if !rm_output.status.success() {
            let stderr = String::from_utf8_lossy(&rm_output.stderr);
            return Err(GitWorktreeError::WorktreeRemoveFailed(stderr.to_string()));
        }
    }

    // Step 4: Prune stale worktree references
    let prune_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        warn!("Warning: worktree prune failed: {}", stderr);
    }

    if let Some(branch) = branch_name {
        let branch_output = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("-D")
            .arg(branch)
            .output()
            .await?;

        if !branch_output.status.success() {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            warn!("Warning: branch delete failed for {}: {}", branch, stderr);
        }
    }

    Ok(())
}

// ============================================================================
// Branch Name Generation
// ============================================================================

/// Generates the branch name for an OpenForge task worktree.
///
/// Branch names are visible in pull requests, so OpenForge uses a short,
/// stable task identifier instead of deriving text from the task prompt.
///
/// # Arguments
/// * `task_id` - The task identifier (e.g., "T-5", "PROJ-123")
///
/// # Returns
/// A branch name in the format "openforge/{task_id}" (e.g., "openforge/T-5")
///
/// # Example
/// ```
/// let branch = task_branch_name("T-5");
/// assert_eq!(branch, "openforge/T-5");
/// ```
pub fn task_branch_name(task_id: &str) -> String {
    format!("openforge/{task_id}")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::process::{Command as StdCommand, Output};

    fn git(repo_path: &Path, args: &[&str]) -> Output {
        StdCommand::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .expect("git command should run")
    }

    fn assert_git_success(repo_path: &Path, args: &[&str]) {
        let output = git(repo_path, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(repo_path: &Path, args: &[&str]) -> String {
        let output = git(repo_path, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn init_committed_repo(repo_path: &Path) {
        std::fs::create_dir_all(repo_path).expect("repo directory should be created");
        assert_git_success(repo_path, &["init", "-b", "main"]);
        assert_git_success(repo_path, &["config", "user.email", "test@example.com"]);
        assert_git_success(repo_path, &["config", "user.name", "Test User"]);
        std::fs::write(repo_path.join("README.md"), "local repo\n")
            .expect("fixture file should be written");
        assert_git_success(repo_path, &["add", "README.md"]);
        assert_git_success(repo_path, &["commit", "-m", "initial"]);
    }

    #[test]
    fn git_command_starts_from_safe_current_dir() {
        let command = git_command();

        assert_eq!(
            command.as_std().get_current_dir(),
            Some(safe_subprocess_current_dir().as_path()),
            "git subprocesses must not inherit the sidecar cwd, which may be inaccessible"
        );
    }

    #[test]
    fn git_command_preserves_space_bearing_repo_path_as_single_arg() {
        let repo_path = Path::new("/Users/koen/Documents/openforge test project");
        let mut command = git_command();
        command.arg("-C").arg(repo_path).arg("status");
        let args: Vec<&OsStr> = command.as_std().get_args().collect();

        assert_eq!(args[0], OsStr::new("-C"));
        assert_eq!(args[1], repo_path.as_os_str());
        assert_eq!(args[2], OsStr::new("status"));
    }

    #[test]
    fn rm_command_starts_from_safe_current_dir_and_preserves_space_bearing_path() {
        let worktree_path =
            Path::new("/Users/koen/.openforge/worktrees/openforge test project/T-1");
        let mut command = rm_command();
        command.arg("-rf").arg(worktree_path);
        let args: Vec<&OsStr> = command.as_std().get_args().collect();

        assert_eq!(
            command.as_std().get_current_dir(),
            Some(safe_subprocess_current_dir().as_path()),
            "cleanup rm subprocesses must not inherit the sidecar cwd either"
        );
        assert_eq!(args[0], OsStr::new("-rf"));
        assert_eq!(args[1], worktree_path.as_os_str());
    }

    #[cfg(unix)]
    #[test]
    fn validate_repository_path_access_reports_permission_denied_with_recovery_guidance() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("Documents repo");
        std::fs::create_dir(&repo_path).expect("repo directory should be created");
        let original_permissions = std::fs::metadata(&repo_path)
            .expect("repo metadata should be readable")
            .permissions();
        std::fs::set_permissions(&repo_path, std::fs::Permissions::from_mode(0o000))
            .expect("permissions should be restricted for fixture");

        let result = validate_repository_path_access(&repo_path);

        std::fs::set_permissions(&repo_path, original_permissions)
            .expect("permissions should be restored so tempdir can clean up");
        let message = result
            .expect_err("permission denied repo should be rejected")
            .to_string();
        assert!(message.contains("Cannot access repository path"));
        assert!(message.contains("Documents"));
        assert!(message.contains("Browse"));
        assert!(message.contains("Full Disk Access"));
    }

    #[tokio::test]
    async fn create_worktree_falls_back_to_head_when_origin_main_is_missing() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("worktree");

        let result = create_worktree(
            &repo_path,
            &worktree_path,
            "T-1269/local-repo",
            "origin/main",
        )
        .await;

        assert!(
            result.is_ok(),
            "local repositories without origin/main should create worktrees: {:?}",
            result.err()
        );
        assert!(worktree_path.join("README.md").exists());

        let branch_output = git(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert!(branch_output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch_output.stdout).trim(),
            "T-1269/local-repo"
        );

        let upstream_output = git(
            &worktree_path,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        );
        assert!(
            !upstream_output.status.success(),
            "created task worktree branches should not require an upstream"
        );
    }

    #[tokio::test]
    async fn create_worktree_handles_space_bearing_paths() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("openforge test project");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("worktree target with spaces");

        create_worktree(
            &repo_path,
            &worktree_path,
            "T-1272/space-bearing-paths",
            "origin/main",
        )
        .await
        .expect("worktree creation should preserve space-bearing repo and worktree paths");

        assert!(worktree_path.join("README.md").exists());
        let branch_output = git(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert!(branch_output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch_output.stdout).trim(),
            "T-1272/space-bearing-paths"
        );
    }

    #[tokio::test]
    async fn list_git_branches_returns_local_and_remote_branches() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(&repo_path, &["checkout", "-b", "feature/open-pr"]);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/review-branch", "HEAD"],
        );

        let branches = list_git_branches(&repo_path)
            .await
            .expect("branches should list");

        assert!(branches.iter().any(|branch| {
            branch.name == "feature/open-pr" && branch.is_current && !branch.is_remote
        }));
        assert!(branches.iter().any(|branch| {
            branch.name == "origin/review-branch" && !branch.is_current && branch.is_remote
        }));
        assert!(
            !branches.iter().any(|branch| branch.name == "origin/HEAD"),
            "remote HEAD aliases should not be shown as selectable branches"
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_checks_out_branch_without_deleting_it() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(&repo_path, &["checkout", "-b", "feature/open-pr"]);
        std::fs::write(repo_path.join("README.md"), "feature branch\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "feature change"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        let worktree_path = temp.path().join("worktree");

        let branch_name =
            create_worktree_from_existing_branch(&repo_path, &worktree_path, "feature/open-pr")
                .await
                .expect("existing branch should create worktree");

        assert_eq!(branch_name, "feature/open-pr");
        let branch_output = git(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert!(branch_output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch_output.stdout).trim(),
            "feature/open-pr"
        );
        assert!(git(
            &repo_path,
            &["show-ref", "--verify", "refs/heads/feature/open-pr"]
        )
        .status
        .success());
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_reuses_local_branch_equal_to_remote() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Local branch and the simulated remote ref point at the same commit.
        assert_git_success(&repo_path, &["branch", "feature/equal"]);
        let local_sha = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/equal"]);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/feature/equal", &local_sha],
        );
        let worktree_path = temp.path().join("worktree");

        let branch_name =
            create_worktree_from_existing_branch(&repo_path, &worktree_path, "origin/feature/equal")
                .await
                .expect("equal local branch should reuse the local branch");

        assert_eq!(branch_name, "feature/equal");
        // Worktree was created on the local branch, not a remote-tracking checkout.
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "feature/equal"
        );
        // Local branch still exists and is unchanged.
        assert!(git(
            &repo_path,
            &["show-ref", "--verify", "refs/heads/feature/equal"]
        )
        .status
        .success());
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "HEAD"]),
            local_sha
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_fast_forwards_local_branch_behind_remote() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Create the local branch at the base commit (behind), then advance the
        // simulated remote ref with an extra commit on top of it.
        assert_git_success(&repo_path, &["branch", "feature/behind"]);
        let base_sha = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/behind"]);

        assert_git_success(&repo_path, &["checkout", "-b", "tmp-remote", "feature/behind"]);
        std::fs::write(repo_path.join("README.md"), "remote ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "remote advance"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/feature/behind", &remote_sha],
        );
        // Sanity: local branch is still behind the remote ref.
        assert_ne!(base_sha, remote_sha);
        let worktree_path = temp.path().join("worktree");

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/behind",
        )
        .await
        .expect("local branch behind remote should be reused and fast-forwarded");

        assert_eq!(branch_name, "feature/behind");
        // Worktree HEAD was fast-forwarded to the remote tip.
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "HEAD"]),
            remote_sha
        );
        // Local branch ref now equals the remote tip too.
        assert_eq!(
            git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/behind"]),
            remote_sha
        );
        // Still on the local branch name (reused, not a detached/remote checkout).
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "feature/behind"
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_errors_when_local_branch_ahead_of_remote() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Remote ref at the base commit; local branch one commit ahead.
        let base_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/feature/ahead", &base_sha],
        );
        assert_git_success(&repo_path, &["checkout", "-b", "feature/ahead"]);
        std::fs::write(repo_path.join("README.md"), "local ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "local advance"]);
        let local_ahead_sha = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/ahead"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        let worktree_path = temp.path().join("worktree");

        let error = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/ahead",
        )
        .await
        .expect_err("local branch ahead of remote should not be silently mutated");

        let message = error.to_string();
        assert!(
            message.contains("diverged")
                && message.contains("ahead")
                && message.contains("feature/ahead"),
            "error should explain divergence with ahead/behind context, got: {message}"
        );
        // Local branch ref is unchanged (still pointing at the ahead commit).
        assert_eq!(
            git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/ahead"]),
            local_ahead_sha
        );
        // No worktree directory was created.
        assert!(
            !worktree_path.exists(),
            "no worktree should be created when the local branch is ahead"
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_errors_when_local_branch_diverged_from_remote() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Build a remote ref with a unique commit on top of the shared base.
        assert_git_success(&repo_path, &["checkout", "-b", "tmp-remote"]);
        std::fs::write(repo_path.join("remote.txt"), "remote only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "remote.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "remote-only commit"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/feature/diverged", &remote_sha],
        );

        // Build the local branch with its own unique commit on top of the shared base.
        assert_git_success(&repo_path, &["checkout", "-b", "feature/diverged"]);
        std::fs::write(repo_path.join("local.txt"), "local only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "local.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "local-only commit"]);
        let local_sha = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/diverged"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_ne!(local_sha, remote_sha);
        let worktree_path = temp.path().join("worktree");

        let error = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/diverged",
        )
        .await
        .expect_err("diverged local branch should not be silently mutated");

        let message = error.to_string();
        assert!(
            message.contains("diverged")
                && message.contains("ahead")
                && message.contains("behind"),
            "error should mention divergence with ahead/behind counts, got: {message}"
        );
        // Nothing mutated: local branch ref unchanged and no worktree directory.
        assert_eq!(
            git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/diverged"]),
            local_sha
        );
        assert!(
            !worktree_path.exists(),
            "no worktree should be created when the local branch has diverged"
        );
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_prefers_origin_main_when_available() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("origin/main should resolve when present");

        assert_eq!(base_ref, "origin/main");
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_falls_back_to_head_without_origin_remote() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("HEAD fallback should resolve for local repositories");

        assert_eq!(base_ref, "HEAD");
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_prefers_origin_head_before_local_head() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let main_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "-b", "feature"]);
        std::fs::write(repo_path.join("README.md"), "feature branch\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "feature change"]);
        assert_git_success(
            &repo_path,
            &[
                "remote",
                "add",
                "origin",
                "git@example.com:example/repo.git",
            ],
        );
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/master", &main_sha],
        );
        assert_git_success(
            &repo_path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/master",
            ],
        );

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("origin/HEAD should resolve when origin/main is missing");

        assert_eq!(base_ref, "origin/HEAD");
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_uses_single_remote_head_when_origin_is_missing() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let main_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "-b", "feature"]);
        std::fs::write(repo_path.join("README.md"), "feature branch\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "feature change"]);
        assert_git_success(
            &repo_path,
            &[
                "remote",
                "add",
                "upstream",
                "git@example.com:example/repo.git",
            ],
        );
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/upstream/trunk", &main_sha],
        );
        assert_git_success(
            &repo_path,
            &[
                "symbolic-ref",
                "refs/remotes/upstream/HEAD",
                "refs/remotes/upstream/trunk",
            ],
        );

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("the single remote HEAD should resolve when origin is absent");

        assert_eq!(base_ref, "upstream/HEAD");
    }

    #[tokio::test]
    async fn create_worktree_uses_origin_head_before_local_feature_head() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let main_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "-b", "feature"]);
        std::fs::write(repo_path.join("README.md"), "feature branch\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "feature change"]);
        assert_git_success(
            &repo_path,
            &[
                "remote",
                "add",
                "origin",
                "git@example.com:example/repo.git",
            ],
        );
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/master", &main_sha],
        );
        assert_git_success(
            &repo_path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/master",
            ],
        );
        let worktree_path = temp.path().join("worktree");

        create_worktree(
            &repo_path,
            &worktree_path,
            "T-1269/remote-default",
            "origin/main",
        )
        .await
        .expect("worktree should be based on origin/HEAD when origin/main is missing");

        let readme = std::fs::read_to_string(worktree_path.join("README.md"))
            .expect("worktree README should exist");
        assert_eq!(readme, "local repo\n");
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_rejects_head_fallback_when_origin_default_is_missing() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(
            &repo_path,
            &[
                "remote",
                "add",
                "origin",
                "git@example.com:example/repo.git",
            ],
        );

        let err = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect_err("origin repos without a remote default should not fall back to HEAD");

        assert!(
            err.to_string().contains("remote 'origin' exists"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn task_branch_name_uses_openforge_namespace_and_task_id() {
        let result = task_branch_name("KVG-1307");
        assert_eq!(result, "openforge/KVG-1307");
    }

    #[test]
    fn task_branch_name_does_not_include_special_chars_from_prompt() {
        let result = task_branch_name("PROJ-123");
        assert_eq!(result, "openforge/PROJ-123");
    }

    #[test]
    fn task_branch_name_does_not_include_spacing_from_prompt() {
        let result = task_branch_name("T-1");
        assert_eq!(result, "openforge/T-1");
    }

    #[test]
    fn task_branch_name_does_not_include_long_prompt_text() {
        let result = task_branch_name("T-999");
        assert_eq!(result, "openforge/T-999");
    }

    #[test]
    fn task_branch_name_does_not_include_unicode_prompt_text() {
        let result = task_branch_name("T-7");
        assert_eq!(result, "openforge/T-7");
    }
}
