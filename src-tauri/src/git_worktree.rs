use crate::git_origin_fetch::{
    fetch_origin, spawn_background_origin_refresh, ORIGIN_FETCH_TIMEOUT,
};
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
    FetchFailed(String),
    /// The caller's `head_sha` is no longer reachable from the PR's pull ref —
    /// the PR picked up new commits (or was force-pushed) after the caller
    /// cached that commit. Kept distinct from `WorktreeAddFailed` so callers
    /// get an actionable message instead of a raw git error.
    StaleHeadSha(String),
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
            GitWorktreeError::FetchFailed(msg) => {
                write!(f, "git fetch failed: {}", msg)
            }
            GitWorktreeError::StaleHeadSha(msg) => {
                write!(f, "{}", msg)
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

/// Maximum number of ahead/behind commit summaries returned by
/// `inspect_existing_branch`. Longer lists are truncated to this cap and the
/// corresponding `*_truncated` flag is set so the UI can surface "+N more"
/// explicitly instead of silently dropping commits.
const COMMIT_SUMMARY_CAP: usize = 50;

/// How the local branch relates to its `origin/<branch>` remote-tracking ref, as
/// reported by the read-only pre-flight `inspect_existing_branch`. This is the
/// serialized decision surface the frontend uses to decide whether starting can
/// proceed silently or must prompt the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExistingBranchRelation {
    /// Only `refs/heads/<short>` exists; no matching origin remote ref.
    LocalOnly,
    /// Only `refs/remotes/origin/<short>` exists; no matching local branch.
    RemoteOnly,
    /// Both exist and the local branch is equal to or purely behind the remote,
    /// so it can be fast-forwarded automatically with no data loss.
    AutoFastForward,
    /// Both exist and the local branch is ahead of or has diverged from the
    /// remote, so reusing it requires an explicit user decision.
    Diverged,
}

/// A compact, display-oriented description of a single commit for the divergence
/// prompt. Serialized to camelCase for the JSON IPC boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub short_sha: String,
    pub subject: String,
    pub author: String,
    pub relative_date: String,
}

/// Read-only plan describing how an existing branch relates to its origin remote
/// at Start time, without creating a worktree or mutating any branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingBranchPlan {
    pub relation: ExistingBranchRelation,
    /// Local-only commits (`origin/<branch>..<branch>`), capped at
    /// `COMMIT_SUMMARY_CAP`. These are the commits lost by a reset-to-remote.
    pub ahead: Vec<CommitSummary>,
    /// Remote-only commits (`<branch>..origin/<branch>`), capped at
    /// `COMMIT_SUMMARY_CAP`. These are on the remote but not local.
    pub behind: Vec<CommitSummary>,
    /// True when the ahead list was truncated to the cap (more commits exist).
    pub ahead_truncated: bool,
    /// True when the behind list was truncated to the cap (more commits exist).
    pub behind_truncated: bool,
    /// False when the origin fetch failed, so the comparison is against the
    /// cached tracking ref and may be stale.
    pub remote_reachable: bool,
}

/// How to resolve a diverged existing branch when creating its worktree.
///
/// Only the `AheadOrDiverged` arm of `create_worktree_from_existing_branch`
/// consults this; every other path is unaffected. Deserialized from the
/// camelCase IPC payload emitted by the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DivergenceResolution {
    /// Preserve today's defensive behavior: a diverged branch still returns a
    /// structured error. Never silently mutates a diverged branch.
    Auto,
    /// Check out the diverged local branch as-is; ahead commits are preserved
    /// and no fast-forward or reset is performed.
    KeepLocal,
    /// Check out the local branch, then hard-reset it to `origin/<branch>` inside
    /// the freshly created worktree, discarding the ahead commits.
    ResetToRemote,
}

// ============================================================================
// Per-Path Locking
// ============================================================================

static WORKTREE_LOCKS: Lazy<DashMap<String, Arc<Mutex<()>>>> = Lazy::new(DashMap::new);

/// Acquires a lock for the given repository path to prevent concurrent worktree operations.
/// `pub(crate)` so tests can hold the lock to observe in-flight cleanup deterministically.
pub(crate) fn acquire_lock(repo_path: &Path) -> Arc<Mutex<()>> {
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

pub(crate) fn git_command() -> Command {
    let mut command = Command::new("git");
    command.env("PATH", user_tool_path());
    command.current_dir(safe_subprocess_current_dir());
    // The sidecar has no terminal to answer a credential prompt on, so a git
    // command that decides to ask would block until something kills it.
    command.env("GIT_TERMINAL_PROMPT", "0");
    // Own process group: git's network work happens in a child (ssh, or a remote
    // helper), and that child is what hangs. Signalling the group takes the whole
    // tree down instead of leaving descendants behind.
    #[cfg(unix)]
    command.process_group(0);
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

/// Collects commit summaries for the revision range `range` (e.g.
/// `origin/foo..foo`), newest first, capped at `COMMIT_SUMMARY_CAP`. Returns the
/// (capped) summaries and whether more commits existed beyond the cap so the
/// caller can surface an explicit "+N more" indicator rather than silently
/// dropping commits.
///
/// Uses a NUL-record / `%x1f`-field pretty format so subjects containing spaces
/// or tabs are parsed unambiguously. `--max-count` is set one past the cap to
/// cheaply detect truncation without walking the whole range.
async fn collect_commit_summaries(
    repo_path: &Path,
    range: &str,
) -> Result<(Vec<CommitSummary>, bool), GitWorktreeError> {
    let format = "%h%x1f%s%x1f%an%x1f%cr";
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("log")
        .arg(format!("--max-count={}", COMMIT_SUMMARY_CAP + 1))
        .arg(format!("--pretty=format:{format}%x1e"))
        .arg(range)
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(format!(
            "failed to list commits for range '{range}': {stderr}"
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut summaries: Vec<CommitSummary> = stdout
        .split('\u{1e}')
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let mut fields = record.split('\u{1f}');
            let short_sha = fields.next()?.trim().to_string();
            let subject = fields.next().unwrap_or("").to_string();
            let author = fields.next().unwrap_or("").to_string();
            let relative_date = fields.next().unwrap_or("").to_string();
            if short_sha.is_empty() {
                return None;
            }
            Some(CommitSummary {
                short_sha,
                subject,
                author,
                relative_date,
            })
        })
        .collect();

    let truncated = summaries.len() > COMMIT_SUMMARY_CAP;
    if truncated {
        summaries.truncate(COMMIT_SUMMARY_CAP);
    }

    Ok((summaries, truncated))
}

/// Desktop preflight for an existing-branch Task. Refreshes origin best-effort,
/// then classifies the saved branch against its remote-tracking ref.
pub async fn inspect_existing_branch(
    repo_path: &Path,
    branch_ref: &str,
) -> Result<ExistingBranchPlan, GitWorktreeError> {
    inspect_existing_branch_inner(repo_path, branch_ref, true).await
}

/// Side-effect-free existing-branch preflight for unattended Task Start.
///
/// Uses only the repository's current local and remote-tracking refs. It does not
/// fetch or create a worktree, so callers may safely return a desktop-action-required
/// outcome without changing repository state.
pub async fn inspect_existing_branch_cached(
    repo_path: &Path,
    branch_ref: &str,
) -> Result<ExistingBranchPlan, GitWorktreeError> {
    inspect_existing_branch_inner(repo_path, branch_ref, false).await
}

async fn inspect_existing_branch_inner(
    repo_path: &Path,
    branch_ref: &str,
    refresh_origin: bool,
) -> Result<ExistingBranchPlan, GitWorktreeError> {
    let branch_ref = normalize_branch_ref(branch_ref)?;
    validate_repository_path_access(repo_path)?;

    let remote_reachable = if refresh_origin {
        fetch_origin(repo_path, ORIGIN_FETCH_TIMEOUT).await
    } else {
        false
    };

    // Resolve to the short local branch name. Only strip the `origin/` prefix —
    // a bare `feature/foo` local name (or a non-origin remote) is left intact so
    // slashes in local branch names are never misread as a remote boundary.
    let short_name = branch_ref.strip_prefix("origin/").unwrap_or(branch_ref);
    let local_full_ref = format!("refs/heads/{short_name}");
    let remote_ref = format!("origin/{short_name}");

    let local_exists = git_ref_exists(repo_path, &local_full_ref).await?;
    let remote_exists = git_ref_exists(repo_path, &format!("refs/remotes/{remote_ref}")).await?;

    let empty_plan = |relation: ExistingBranchRelation| ExistingBranchPlan {
        relation,
        ahead: Vec::new(),
        behind: Vec::new(),
        ahead_truncated: false,
        behind_truncated: false,
        remote_reachable,
    };

    match (local_exists, remote_exists) {
        (true, false) => Ok(empty_plan(ExistingBranchRelation::LocalOnly)),
        (false, true) => Ok(empty_plan(ExistingBranchRelation::RemoteOnly)),
        (false, false) => Err(GitWorktreeError::WorktreeAddFailed(format!(
            "branch '{branch_ref}' does not exist"
        ))),
        (true, true) => {
            match classify_local_branch_against_remote(repo_path, short_name, &remote_ref).await? {
                LocalBranchRelation::EqualOrBehind => {
                    Ok(empty_plan(ExistingBranchRelation::AutoFastForward))
                }
                LocalBranchRelation::AheadOrDiverged { .. } => {
                    let (ahead, ahead_truncated) = collect_commit_summaries(
                        repo_path,
                        &format!("{remote_ref}..{local_full_ref}"),
                    )
                    .await?;
                    let (behind, behind_truncated) = collect_commit_summaries(
                        repo_path,
                        &format!("{local_full_ref}..{remote_ref}"),
                    )
                    .await?;
                    Ok(ExistingBranchPlan {
                        relation: ExistingBranchRelation::Diverged,
                        ahead,
                        behind,
                        ahead_truncated,
                        behind_truncated,
                        remote_reachable,
                    })
                }
            }
        }
    }
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

pub async fn list_git_branches(repo_path: &Path) -> Result<Vec<GitBranchInfo>, GitWorktreeError> {
    validate_repository_path_access(repo_path)?;
    // Local refs first: a stale branch list beats a dialog that never loads.
    spawn_background_origin_refresh(repo_path);

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

/// Returns true if the repository has at least one commit reachable from HEAD.
///
/// A freshly `git init`ed repository has an "unborn" HEAD — the branch exists
/// but points at no commit. Git worktrees cannot be created from such a repo
/// because there is no base commit to branch from, so callers use this to steer
/// the user toward a project-directory (no-worktree) start instead of failing
/// later in `create_worktree` with "base ref '...' is unavailable and HEAD is
/// not a valid commit".
pub async fn repo_has_commits(repo_path: &Path) -> Result<bool, GitWorktreeError> {
    validate_repository_path_access(repo_path)?;
    git_ref_exists(repo_path, "HEAD").await
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
        warn!(
            "Warning: worktree prune failed status={} stderr_bytes={}",
            prune_output.status,
            prune_output.stderr.len()
        );
    }

    // Refresh origin so the base ref (e.g. origin/main) is up to date. Best
    // effort: an unreachable remote means an older base, not a failed worktree.
    let _ = fetch_origin(repo_path, ORIGIN_FETCH_TIMEOUT).await;

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
    resolution: DivergenceResolution,
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
        warn!(
            "Warning: worktree prune failed status={} stderr_bytes={}",
            prune_output.status,
            prune_output.stderr.len()
        );
    }

    let _ = fetch_origin(repo_path, ORIGIN_FETCH_TIMEOUT).await;

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
                    // Reusing this branch would discard or merge local work. How
                    // to proceed is the caller's explicit, pre-flighted choice;
                    // only this arm consults `resolution`.
                    return resolve_diverged_worktree(
                        repo_path,
                        worktree_path,
                        local_branch,
                        branch_ref,
                        ahead,
                        behind,
                        resolution,
                    )
                    .await;
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

/// Applies the caller's `resolution` to a local branch that is ahead of or
/// diverged from `remote_ref`. Called only from the diverged arm of
/// `create_worktree_from_existing_branch`; the per-repo worktree lock is already
/// held by that caller.
async fn resolve_diverged_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    local_branch: &str,
    remote_ref: &str,
    ahead: usize,
    behind: usize,
    resolution: DivergenceResolution,
) -> Result<String, GitWorktreeError> {
    match resolution {
        DivergenceResolution::Auto => {
            // Defensive guard: the frontend pre-flighted, so Auto reaching a
            // diverged branch is unexpected. Mutate nothing and surface the same
            // structured error as before, never silently altering local work.
            Err(GitWorktreeError::WorktreeAddFailed(format!(
                "local branch '{local_branch}' has diverged from '{remote_ref}' \
                 (local is {ahead} commit(s) ahead, {behind} behind); delete or rename \
                 the local branch to use the remote version, or start the task from the \
                 local branch '{local_branch}' to keep your local work"
            )))
        }
        DivergenceResolution::KeepLocal => {
            // Check out the diverged local branch as-is: no fast-forward, no
            // reset, ahead commits preserved.
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

            Ok(local_branch.to_string())
        }
        DivergenceResolution::ResetToRemote => {
            // Check out the local branch, then hard-reset it to the remote tip
            // inside the freshly created worktree. A new worktree has no
            // uncommitted changes, so the reset cannot destroy live work.
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

            let reset_output = git_command()
                .arg("-C")
                .arg(worktree_path)
                .arg("reset")
                .arg("--hard")
                .arg(remote_ref)
                .output()
                .await?;

            if !reset_output.status.success() {
                let stderr = String::from_utf8_lossy(&reset_output.stderr);
                return Err(GitWorktreeError::WorktreeAddFailed(format!(
                    "failed to reset local branch '{local_branch}' to '{remote_ref}': {stderr}"
                )));
            }

            let _ = git_command()
                .arg("-C")
                .arg(worktree_path)
                .arg("branch")
                .arg("--set-upstream-to")
                .arg(remote_ref)
                .arg(local_branch)
                .output()
                .await;

            Ok(local_branch.to_string())
        }
    }
}

/// Fetch a PR's head commit from origin and check it out into a throwaway
/// **detached** worktree at `head_sha`. GitHub publishes the PR head under the
/// base repo as `refs/pull/{N}/head`, so this works for fork PRs too, as long as
/// `repo_path`'s origin is the base repo.
pub async fn checkout_pr_head(
    repo_path: &Path,
    worktree_path: &Path,
    pr_number: i64,
    head_sha: &str,
) -> Result<(), GitWorktreeError> {
    let pull_ref = format!("refs/pull/{pr_number}/head");
    let fetch_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .arg(&pull_ref)
        .output()
        .await?;
    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        return Err(GitWorktreeError::FetchFailed(format!(
            "could not fetch {pull_ref}: {stderr}"
        )));
    }

    // The fetch above only ever brings in `pull_ref`'s *current* tip. If the PR
    // picked up new commits (or was force-pushed) after the caller's `head_sha`
    // was cached, that commit was never fetched and `git worktree add` would
    // fail with an opaque "invalid reference" — check for that case up front so
    // we can tell the caller what actually happened.
    if !commit_exists(repo_path, head_sha).await? {
        return Err(GitWorktreeError::StaleHeadSha(format!(
            "commit {head_sha} is no longer part of {pull_ref} — the PR likely has new \
             commits since this was last checked. Refresh the PR list and try again."
        )));
    }

    try_create_detached_worktree_inner(repo_path, worktree_path, head_sha).await
}

/// Whether `commit` resolves to an existing commit object in `repo_path`'s
/// object database, without requiring it be reachable from any ref.
async fn commit_exists(repo_path: &Path, commit: &str) -> Result<bool, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("cat-file")
        .arg("-e")
        .arg(format!("{commit}^{{commit}}"))
        .output()
        .await?;
    Ok(output.status.success())
}

async fn try_create_detached_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    commit: &str,
) -> Result<(), GitWorktreeError> {
    let add_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("--detach")
        .arg(worktree_path)
        .arg(commit)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    Ok(())
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

// ============================================================================
// Safe Branch Deletion on Teardown
// ============================================================================

/// Why an OpenForge-owned branch was preserved instead of deleted during a
/// worktree teardown. Used for logging so the reason a branch survived cleanup
/// is always observable.
#[derive(Debug, PartialEq, Eq)]
enum BranchPreservedReason {
    /// The branch is checked out in another worktree (including the main repo).
    CheckedOutElsewhere(String),
    /// The branch's own worktree has uncommitted changes.
    UncommittedChanges,
    /// The branch has commits not present on its upstream (unpushed/diverged).
    UnpushedOrDiverged { ahead: usize, behind: usize },
    /// The safety evaluation itself failed; preserve out of caution.
    SafetyCheckFailed,
}

impl fmt::Display for BranchPreservedReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BranchPreservedReason::CheckedOutElsewhere(_) => {
                write!(f, "it is checked out in another worktree")
            }
            BranchPreservedReason::UncommittedChanges => {
                write!(f, "its worktree has uncommitted changes")
            }
            BranchPreservedReason::UnpushedOrDiverged { ahead, behind } => write!(
                f,
                "it has commits not on its upstream ({ahead} ahead, {behind} behind)"
            ),
            BranchPreservedReason::SafetyCheckFailed => {
                write!(f, "its deletion-safety could not be verified")
            }
        }
    }
}

/// Decision about whether an OpenForge-owned branch can be safely deleted when
/// its worktree is torn down.
enum BranchDeletionPlan {
    /// No local-only work is at risk; the branch may be deleted (still via the
    /// non-force `git branch -d`, which refuses unmerged branches as a backstop).
    Delete,
    /// Deleting the branch would (or might) destroy live work; keep it.
    Preserve(BranchPreservedReason),
}

/// Returns true when both paths refer to the same location, canonicalizing when
/// possible (worktree paths reported by git are canonical, while OpenForge
/// stores the path it created — on macOS these differ via the /private symlink).
fn paths_equivalent(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(canonical_a), Ok(canonical_b)) => canonical_a == canonical_b,
        _ => a == b,
    }
}

/// Returns the worktree path that currently has `branch` checked out, if any, by
/// parsing `git worktree list --porcelain`. Only one worktree can hold a given
/// branch at a time, so the first match is authoritative.
async fn worktree_path_with_branch(
    repo_path: &Path,
    branch: &str,
) -> Result<Option<String>, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitWorktreeError::WorktreeRemoveFailed(format!(
            "failed to list worktrees for '{}': {}",
            repo_path.display(),
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let target_ref = format!("refs/heads/{branch}");
    let mut current_path: Option<&str> = None;
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = Some(path.trim());
        } else if let Some(branch_ref) = line.strip_prefix("branch ") {
            if branch_ref.trim() == target_ref {
                return Ok(current_path.map(|path| path.to_string()));
            }
        }
    }

    Ok(None)
}

/// Returns the worktree path where `branch` is checked out if it is anywhere
/// other than `worktree_path` (the worktree being torn down).
async fn branch_checked_out_elsewhere(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<Option<String>, GitWorktreeError> {
    match worktree_path_with_branch(repo_path, branch).await? {
        Some(path) if !paths_equivalent(Path::new(&path), worktree_path) => Ok(Some(path)),
        _ => Ok(None),
    }
}

/// Resolves the upstream tracking ref of `branch` (e.g. `origin/<branch>`), or
/// `None` when the branch has no configured upstream.
async fn branch_upstream_ref(
    repo_path: &Path,
    branch: &str,
) -> Result<Option<String>, GitWorktreeError> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("--symbolic-full-name")
        .arg(format!("{branch}@{{upstream}}"))
        .output()
        .await?;

    if !output.status.success() {
        return Ok(None);
    }

    let upstream = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if upstream.is_empty() {
        Ok(None)
    } else {
        Ok(Some(upstream))
    }
}

/// Decides whether `branch` can be safely deleted when `worktree_path` is torn
/// down. Must be called BEFORE the worktree is removed so uncommitted changes
/// and the worktree's own checkout are still observable.
async fn evaluate_branch_deletion(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<BranchDeletionPlan, GitWorktreeError> {
    // 1. Never delete a branch that is checked out somewhere else (e.g. the user
    //    adopted it as their active branch in the main repo).
    if let Some(path) = branch_checked_out_elsewhere(repo_path, worktree_path, branch).await? {
        return Ok(BranchDeletionPlan::Preserve(
            BranchPreservedReason::CheckedOutElsewhere(path),
        ));
    }

    // 2. Never delete a branch whose worktree still holds uncommitted work.
    if worktree_path.exists() {
        if let Ok(current_branch) = current_worktree_branch(worktree_path).await {
            if current_branch == branch && worktree_has_local_changes(worktree_path).await? {
                return Ok(BranchDeletionPlan::Preserve(
                    BranchPreservedReason::UncommittedChanges,
                ));
            }
        }
    }

    // 3. Never delete a branch carrying commits its upstream does not have
    //    (unpushed or diverged). A branch purely behind its upstream is fully
    //    contained remotely and remains safe to delete.
    if let Some(upstream) = branch_upstream_ref(repo_path, branch).await? {
        let local_full_ref = format!("refs/heads/{branch}");
        let (ahead, behind) = git_ahead_behind(repo_path, &local_full_ref, &upstream).await?;
        if ahead > 0 {
            return Ok(BranchDeletionPlan::Preserve(
                BranchPreservedReason::UnpushedOrDiverged { ahead, behind },
            ));
        }
    }

    Ok(BranchDeletionPlan::Delete)
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

    // Decide the branch's fate BEFORE anything is destroyed: uncommitted changes
    // and the worktree's own checkout are only observable while the worktree
    // still exists. A failed evaluation conservatively preserves the branch.
    let branch_decision = match branch_name {
        Some(branch) => {
            let plan = match evaluate_branch_deletion(repo_path, worktree_path, branch).await {
                Ok(plan) => plan,
                Err(e) => {
                    let error_message = e.to_string();
                    warn!(
                        "Could not evaluate deletion safety for branch '{}'; preserving it error_bytes={}",
                        branch,
                        error_message.len()
                    );
                    BranchDeletionPlan::Preserve(BranchPreservedReason::SafetyCheckFailed)
                }
            };
            Some((branch, plan))
        }
        None => None,
    };

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
        warn!(
            "Warning: git worktree remove failed status={} stderr_bytes={}",
            remove_output.status,
            remove_output.stderr.len()
        );
    }

    // Step 2: Remove .git/worktrees metadata
    let worktree_name = worktree_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let git_dir = repo_path.join(".git").join("worktrees").join(worktree_name);
    if git_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&git_dir) {
            warn!(
                "Warning: failed to remove worktree metadata: kind={:?}",
                e.kind()
            );
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
        warn!(
            "Warning: worktree prune failed status={} stderr_bytes={}",
            prune_output.status,
            prune_output.stderr.len()
        );
    }

    if let Some((branch, plan)) = branch_decision {
        match plan {
            BranchDeletionPlan::Delete => {
                // Use the non-force `-d`: it refuses to delete a branch that is
                // not merged into its upstream/HEAD, giving a final backstop even
                // if the explicit checks above missed something.
                let branch_output = git_command()
                    .arg("-C")
                    .arg(repo_path)
                    .arg("branch")
                    .arg("-d")
                    .arg(branch)
                    .output()
                    .await?;

                if branch_output.status.success() {
                    info!("Deleted OpenForge branch '{}' during teardown", branch);
                } else {
                    warn!(
                        "Preserving branch '{}': safe delete was refused by git status={} stderr_bytes={}",
                        branch,
                        branch_output.status,
                        branch_output.stderr.len()
                    );
                }
            }
            BranchDeletionPlan::Preserve(reason) => {
                warn!(
                    "Preserving OpenForge branch '{}' during teardown because {}",
                    branch, reason
                );
            }
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
    use std::time::Duration;

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
        // Never sign fixture commits: a developer's global commit.gpgsign=true
        // would otherwise make these temp-repo commits fail when gpg is
        // unavailable or resource-starved under parallel test load.
        assert_git_success(repo_path, &["config", "commit.gpgsign", "false"]);
        assert_git_success(repo_path, &["config", "tag.gpgsign", "false"]);
        std::fs::write(repo_path.join("README.md"), "local repo\n")
            .expect("fixture file should be written");
        assert_git_success(repo_path, &["add", "README.md"]);
        assert_git_success(repo_path, &["commit", "-m", "initial"]);
    }

    #[tokio::test]
    async fn checkout_pr_head_fetches_ref_and_creates_detached_worktree() {
        let temp = tempfile::tempdir().expect("tempdir should be created");

        // "origin" plays the role of the GitHub base repo.
        let origin_path = temp.path().join("origin");
        init_committed_repo(&origin_path);
        std::fs::write(origin_path.join("pr_file.txt"), "from the PR\n")
            .expect("pr file should be written");
        assert_git_success(&origin_path, &["add", "pr_file.txt"]);
        assert_git_success(&origin_path, &["commit", "-m", "pr head commit"]);
        let head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        // GitHub exposes the PR head under the base repo as refs/pull/N/head.
        assert_git_success(&origin_path, &["update-ref", "refs/pull/7/head", &head_sha]);
        // Move origin's main back so the PR commit is only reachable via the pull ref.
        assert_git_success(&origin_path, &["reset", "--hard", "HEAD~1"]);

        // Local clone = OpenForge's local project repo.
        let repo_path = temp.path().join("repo");
        assert_git_success(
            temp.path(),
            &[
                "clone",
                origin_path.to_str().unwrap(),
                repo_path.to_str().unwrap(),
            ],
        );

        let worktree_path = temp.path().join("pr-worktree");
        let result = checkout_pr_head(&repo_path, &worktree_path, 7, &head_sha).await;

        assert!(
            result.is_ok(),
            "checkout_pr_head should succeed: {:?}",
            result.err()
        );
        assert_eq!(git_stdout(&worktree_path, &["rev-parse", "HEAD"]), head_sha);
        // Detached HEAD: symbolic-ref must fail (no branch).
        assert!(
            !git(&worktree_path, &["symbolic-ref", "--quiet", "HEAD"])
                .status
                .success(),
            "worktree HEAD should be detached"
        );
        assert!(
            worktree_path.join("pr_file.txt").exists(),
            "PR file should be present"
        );
    }

    #[tokio::test]
    async fn checkout_pr_head_reports_a_stale_head_sha_actionably() {
        let temp = tempfile::tempdir().expect("tempdir should be created");

        let origin_path = temp.path().join("origin");
        init_committed_repo(&origin_path);
        std::fs::write(origin_path.join("pr_file.txt"), "first push\n")
            .expect("pr file should be written");
        assert_git_success(&origin_path, &["add", "pr_file.txt"]);
        assert_git_success(&origin_path, &["commit", "-m", "pr head v1"]);
        let stale_head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        assert_git_success(
            &origin_path,
            &["update-ref", "refs/pull/9/head", &stale_head_sha],
        );
        // Move origin's main back off the PR commit so a clone right now — before
        // OpenForge ever fetches the pull ref — does not pick it up on `main`.
        assert_git_success(&origin_path, &["reset", "--hard", "HEAD~1"]);

        // Local clone = OpenForge's local project repo, taken before the PR force-push below.
        // `--no-local` forces a real fetch-pack negotiation instead of git's local-path
        // fast path (which hardlinks/copies the whole object store and would smuggle in
        // the still-unreachable stale commit, defeating the point of this test).
        let repo_path = temp.path().join("repo");
        assert_git_success(
            temp.path(),
            &[
                "clone",
                "--no-local",
                &format!("file://{}", origin_path.display()),
                repo_path.to_str().unwrap(),
            ],
        );

        // The PR author force-pushes new commits: refs/pull/9/head now points
        // elsewhere and the old head is no longer reachable from it.
        std::fs::write(origin_path.join("pr_file.txt"), "force-pushed\n")
            .expect("pr file should be rewritten");
        assert_git_success(&origin_path, &["add", "pr_file.txt"]);
        assert_git_success(&origin_path, &["commit", "-m", "pr head v2"]);
        let new_head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        assert_git_success(
            &origin_path,
            &[
                "update-ref",
                "--no-deref",
                "refs/pull/9/head",
                &new_head_sha,
            ],
        );

        // OpenForge still has the stale head_sha cached from before the force-push.
        let worktree_path = temp.path().join("pr-worktree");
        let result = checkout_pr_head(&repo_path, &worktree_path, 9, &stale_head_sha).await;

        let error = result.expect_err("a moved PR head must not succeed silently");
        assert!(
            matches!(error, GitWorktreeError::StaleHeadSha(_)),
            "expected StaleHeadSha, got: {error:?}"
        );
        let message = error.to_string();
        assert!(
            message.contains(&stale_head_sha),
            "message should name the stale commit: {message}"
        );
        assert!(
            message.to_lowercase().contains("refresh"),
            "message should tell the user how to recover: {message}"
        );
        assert!(
            !worktree_path.exists(),
            "no worktree should be left behind on a stale-head failure"
        );
    }

    #[tokio::test]
    async fn checkout_pr_head_worktree_can_be_removed() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let origin_path = temp.path().join("origin");
        init_committed_repo(&origin_path);
        let head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        assert_git_success(&origin_path, &["update-ref", "refs/pull/1/head", &head_sha]);
        let repo_path = temp.path().join("repo");
        assert_git_success(
            temp.path(),
            &[
                "clone",
                origin_path.to_str().unwrap(),
                repo_path.to_str().unwrap(),
            ],
        );
        let worktree_path = temp.path().join("pr-worktree");
        checkout_pr_head(&repo_path, &worktree_path, 1, &head_sha)
            .await
            .expect("checkout should succeed");

        remove_worktree(&repo_path, &worktree_path)
            .await
            .expect("removing a detached PR worktree should succeed");
        assert!(
            !worktree_path.exists(),
            "worktree dir should be gone after removal"
        );
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

    #[cfg(unix)]
    #[tokio::test]
    async fn list_git_branches_returns_local_refs_while_the_origin_fetch_hangs() {
        use crate::git_origin_fetch::hanging_fetch_test_support::*;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        let pid_file = init_repo_with_hanging_origin(&repo_path);
        assert_git_success(&repo_path, &["branch", "feature/hangs-on-fetch"]);

        let branches = tokio::time::timeout(Duration::from_secs(20), list_git_branches(&repo_path))
            .await
            .expect("listing branches must not wait on a fetch that never returns")
            .expect("branches should list");

        assert!(
            branches
                .iter()
                .any(|branch| branch.name == "feature/hangs-on-fetch"),
            "local refs must be returned even when origin is unreachable"
        );

        // The background refresh is still hanging; take it down so the fixture
        // cannot outlive the test.
        let helper_pid = wait_for_recorded_pid(&pid_file).await;
        terminate_fetch_process_group(process_group_of(helper_pid));
        assert_process_exits(helper_pid).await;
    }

    fn init_uncommitted_repo(repo_path: &Path) {
        std::fs::create_dir_all(repo_path).expect("repo directory should be created");
        assert_git_success(repo_path, &["init", "-b", "main"]);
    }

    #[tokio::test]
    async fn repo_has_commits_false_for_unborn_repo() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("empty repo");
        init_uncommitted_repo(&repo_path);

        let has_commits = repo_has_commits(&repo_path)
            .await
            .expect("repo_has_commits should succeed on an unborn repo");

        assert!(
            !has_commits,
            "a freshly initialized repo with no commits (unborn HEAD) must report no commits"
        );
    }

    #[tokio::test]
    async fn repo_has_commits_true_after_first_commit() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        let has_commits = repo_has_commits(&repo_path)
            .await
            .expect("repo_has_commits should succeed on a committed repo");

        assert!(
            has_commits,
            "a repo with at least one commit must report having commits"
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

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "feature/open-pr",
            DivergenceResolution::Auto,
        )
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
            &[
                "update-ref",
                "refs/remotes/origin/feature/equal",
                &local_sha,
            ],
        );
        let worktree_path = temp.path().join("worktree");

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/equal",
            DivergenceResolution::Auto,
        )
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

        assert_git_success(
            &repo_path,
            &["checkout", "-b", "tmp-remote", "feature/behind"],
        );
        std::fs::write(repo_path.join("README.md"), "remote ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "remote advance"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        assert_git_success(
            &repo_path,
            &[
                "update-ref",
                "refs/remotes/origin/feature/behind",
                &remote_sha,
            ],
        );
        // Sanity: local branch is still behind the remote ref.
        assert_ne!(base_sha, remote_sha);
        let worktree_path = temp.path().join("worktree");

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/behind",
            DivergenceResolution::Auto,
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
            DivergenceResolution::Auto,
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
            &[
                "update-ref",
                "refs/remotes/origin/feature/diverged",
                &remote_sha,
            ],
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
            DivergenceResolution::Auto,
        )
        .await
        .expect_err("diverged local branch should not be silently mutated");

        let message = error.to_string();
        assert!(
            message.contains("diverged") && message.contains("ahead") && message.contains("behind"),
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

    // ========================================================================
    // Safe branch deletion on worktree teardown (AVIV-102)
    //
    // OpenForge-created branches are deleted when a task's worktree is torn
    // down, but only when doing so cannot destroy live work. These tests pin
    // the safety contract: fully pushed/clean branches are deleted, while
    // branches with unpushed/diverged commits, uncommitted worktree changes, or
    // a checkout elsewhere are preserved.
    // ========================================================================

    fn branch_exists(repo_path: &Path, branch: &str) -> bool {
        git(
            repo_path,
            &["show-ref", "--verify", &format!("refs/heads/{branch}")],
        )
        .status
        .success()
    }

    fn branch_tip(repo_path: &Path, branch: &str) -> String {
        git_stdout(repo_path, &["rev-parse", &format!("refs/heads/{branch}")])
    }

    fn ensure_origin_remote(repo_path: &Path) {
        let _ = git(
            repo_path,
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/openforge.git",
            ],
        );
    }

    /// Simulates that `branch` has been pushed: point `origin/<branch>` at `sha`
    /// and configure the branch upstream so `@{upstream}` resolves.
    fn set_remote_tracking_upstream(repo_path: &Path, branch: &str, sha: &str) {
        ensure_origin_remote(repo_path);
        assert_git_success(
            repo_path,
            &["update-ref", &format!("refs/remotes/origin/{branch}"), sha],
        );
        assert_git_success(
            repo_path,
            &[
                "branch",
                &format!("--set-upstream-to=origin/{branch}"),
                branch,
            ],
        );
    }

    #[tokio::test]
    async fn remove_worktree_with_branch_deletes_fully_pushed_clean_branch() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("wt");
        let branch = "openforge/T-pushed";
        create_worktree(&repo_path, &worktree_path, branch, "origin/main")
            .await
            .expect("worktree should be created");
        // Upstream equals the branch tip: nothing local-only, safe to delete.
        let sha = branch_tip(&repo_path, branch);
        set_remote_tracking_upstream(&repo_path, branch, &sha);

        remove_worktree_with_branch(&repo_path, &worktree_path, Some(branch))
            .await
            .expect("teardown should succeed");

        assert!(
            !branch_exists(&repo_path, branch),
            "a fully pushed, clean OpenForge branch should be deleted on teardown"
        );
        assert!(
            !worktree_path.exists(),
            "the worktree directory should still be removed"
        );
    }

    #[tokio::test]
    async fn remove_worktree_with_branch_preserves_branch_with_unpushed_commits() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("wt");
        let branch = "openforge/T-unpushed";
        create_worktree(&repo_path, &worktree_path, branch, "origin/main")
            .await
            .expect("worktree should be created");
        // Upstream pinned at the base tip, then add a local-only commit.
        let base_sha = branch_tip(&repo_path, branch);
        set_remote_tracking_upstream(&repo_path, branch, &base_sha);
        std::fs::write(worktree_path.join("README.md"), "local-only work\n")
            .expect("fixture file should be written");
        assert_git_success(&worktree_path, &["commit", "-am", "local-only commit"]);

        remove_worktree_with_branch(&repo_path, &worktree_path, Some(branch))
            .await
            .expect("teardown should succeed");

        assert!(
            branch_exists(&repo_path, branch),
            "a branch with unpushed local commits must be preserved, never force-deleted"
        );
    }

    #[tokio::test]
    async fn remove_worktree_with_branch_preserves_diverged_branch() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("wt");
        let branch = "openforge/T-diverged";
        create_worktree(&repo_path, &worktree_path, branch, "origin/main")
            .await
            .expect("worktree should be created");
        let base_sha = branch_tip(&repo_path, branch);
        // Build a remote-only commit on top of the base and point the upstream at it.
        assert_git_success(&repo_path, &["checkout", "-b", "tmp-remote", &base_sha]);
        std::fs::write(repo_path.join("remote-only.txt"), "remote only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "remote-only.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "remote-only commit"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        set_remote_tracking_upstream(&repo_path, branch, &remote_sha);
        // Local-only commit in the worktree, so local has diverged from the remote.
        std::fs::write(worktree_path.join("README.md"), "local divergent work\n")
            .expect("fixture file should be written");
        assert_git_success(&worktree_path, &["commit", "-am", "local divergent commit"]);

        remove_worktree_with_branch(&repo_path, &worktree_path, Some(branch))
            .await
            .expect("teardown should succeed");

        assert!(
            branch_exists(&repo_path, branch),
            "a branch that has diverged from its upstream must be preserved"
        );
    }

    #[tokio::test]
    async fn remove_worktree_with_branch_preserves_branch_with_uncommitted_changes() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("wt");
        let branch = "openforge/T-dirty";
        create_worktree(&repo_path, &worktree_path, branch, "origin/main")
            .await
            .expect("worktree should be created");
        // Fully pushed at the tip, so the ONLY unsafe condition is the dirty worktree.
        let sha = branch_tip(&repo_path, branch);
        set_remote_tracking_upstream(&repo_path, branch, &sha);
        std::fs::write(worktree_path.join("README.md"), "uncommitted change\n")
            .expect("fixture file should be written");

        remove_worktree_with_branch(&repo_path, &worktree_path, Some(branch))
            .await
            .expect("teardown should succeed");

        assert!(
            branch_exists(&repo_path, branch),
            "a branch whose worktree has uncommitted changes must be preserved"
        );
    }

    #[tokio::test]
    async fn remove_worktree_with_branch_preserves_branch_checked_out_in_main_repo() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        // The branch is the user's active branch, checked out in the main repo,
        // mirroring the DEV-182634 cautionary case.
        let branch = "DEV-182634-display-operational-health-trust-score";
        assert_git_success(&repo_path, &["checkout", "-b", branch]);
        // A leftover task worktree references this branch but sits on its own branch.
        let worktree_path = temp.path().join("wt");
        assert_git_success(
            &repo_path,
            &[
                "worktree",
                "add",
                "-b",
                "scratch",
                worktree_path.to_str().expect("utf8 worktree path"),
            ],
        );

        remove_worktree_with_branch(&repo_path, &worktree_path, Some(branch))
            .await
            .expect("teardown should succeed");

        assert!(
            branch_exists(&repo_path, branch),
            "a branch checked out in the main repo must never be deleted on teardown"
        );
    }

    #[tokio::test]
    async fn remove_worktree_without_branch_never_deletes_branch() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("wt");
        let branch = "openforge/T-keep";
        create_worktree(&repo_path, &worktree_path, branch, "origin/main")
            .await
            .expect("worktree should be created");

        remove_worktree(&repo_path, &worktree_path)
            .await
            .expect("teardown should succeed");

        assert!(
            branch_exists(&repo_path, branch),
            "remove_worktree without a branch must never delete the branch"
        );
    }

    // ========================================================================
    // Existing-branch pre-flight inspection + divergence resolution (AVIV-123)
    //
    // inspect_existing_branch is a read-only pre-flight run at Start time: it
    // fetches origin best-effort, classifies the local branch against
    // origin/<branch>, and reports ahead/behind commit summaries WITHOUT
    // creating a worktree or mutating any branch. create_worktree_from_existing_branch
    // gains a DivergenceResolution knob that only the diverged arm consults.
    // ========================================================================

    /// Point `origin/<branch>` at `sha` so the remote-tracking ref exists for
    /// classification, without requiring a real remote.
    fn set_origin_tracking_ref(repo_path: &Path, branch: &str, sha: &str) {
        assert_git_success(
            repo_path,
            &["update-ref", &format!("refs/remotes/origin/{branch}"), sha],
        );
    }

    #[tokio::test]
    async fn inspect_existing_branch_reports_local_only() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(&repo_path, &["branch", "feature/local-only"]);

        let plan = inspect_existing_branch(&repo_path, "feature/local-only")
            .await
            .expect("local-only branch should classify");

        assert_eq!(plan.relation, ExistingBranchRelation::LocalOnly);
        assert!(plan.ahead.is_empty());
        assert!(plan.behind.is_empty());
    }

    #[tokio::test]
    async fn inspect_existing_branch_reports_remote_only() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        set_origin_tracking_ref(&repo_path, "feature/remote-only", &head);

        let plan = inspect_existing_branch(&repo_path, "origin/feature/remote-only")
            .await
            .expect("remote-only branch should classify");

        assert_eq!(plan.relation, ExistingBranchRelation::RemoteOnly);
        assert!(plan.ahead.is_empty());
        assert!(plan.behind.is_empty());
    }

    #[tokio::test]
    async fn inspect_existing_branch_reports_auto_fast_forward_when_local_is_behind() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Local branch at base; remote one commit ahead.
        assert_git_success(&repo_path, &["branch", "feature/behind"]);
        assert_git_success(
            &repo_path,
            &["checkout", "-b", "tmp-remote", "feature/behind"],
        );
        std::fs::write(repo_path.join("README.md"), "remote ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["commit", "-am", "remote advance"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        set_origin_tracking_ref(&repo_path, "feature/behind", &remote_sha);

        let plan = inspect_existing_branch(&repo_path, "origin/feature/behind")
            .await
            .expect("behind branch should classify as auto fast-forward");

        assert_eq!(plan.relation, ExistingBranchRelation::AutoFastForward);
    }

    #[tokio::test]
    async fn inspect_existing_branch_reports_diverged_with_ahead_and_behind_lists() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Remote-only commit.
        assert_git_success(&repo_path, &["checkout", "-b", "tmp-remote"]);
        std::fs::write(repo_path.join("remote.txt"), "remote only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "remote.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "remote-only commit"]);
        let remote_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        set_origin_tracking_ref(&repo_path, "feature/diverged", &remote_sha);

        // Local-only commit on top of the shared base.
        assert_git_success(&repo_path, &["checkout", "-b", "feature/diverged"]);
        std::fs::write(repo_path.join("local.txt"), "local only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "local.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "local-only commit"]);
        assert_git_success(&repo_path, &["checkout", "main"]);

        let plan = inspect_existing_branch(&repo_path, "origin/feature/diverged")
            .await
            .expect("diverged branch should classify");

        assert_eq!(plan.relation, ExistingBranchRelation::Diverged);
        assert_eq!(plan.ahead.len(), 1, "one local-only commit is ahead");
        assert_eq!(plan.ahead[0].subject, "local-only commit");
        assert_eq!(plan.behind.len(), 1, "one remote-only commit is behind");
        assert_eq!(plan.behind[0].subject, "remote-only commit");
        assert!(!plan.ahead_truncated);
        assert!(!plan.behind_truncated);
    }

    #[tokio::test]
    async fn inspect_existing_branch_caps_commit_lists_at_fifty_and_flags_truncation() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Remote at base.
        let base_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        set_origin_tracking_ref(&repo_path, "feature/many-ahead", &base_sha);

        // Local branch with 55 commits ahead of the remote.
        assert_git_success(&repo_path, &["checkout", "-b", "feature/many-ahead"]);
        for index in 0..55 {
            std::fs::write(repo_path.join("counter.txt"), format!("commit {index}\n"))
                .expect("fixture file should be written");
            assert_git_success(&repo_path, &["add", "counter.txt"]);
            assert_git_success(
                &repo_path,
                &["commit", "-m", &format!("ahead commit {index}")],
            );
        }
        assert_git_success(&repo_path, &["checkout", "main"]);

        let plan = inspect_existing_branch(&repo_path, "origin/feature/many-ahead")
            .await
            .expect("many-ahead branch should classify");

        assert_eq!(plan.relation, ExistingBranchRelation::Diverged);
        assert_eq!(
            plan.ahead.len(),
            50,
            "ahead commit list must be capped at 50 entries"
        );
        assert!(
            plan.ahead_truncated,
            "truncation past the 50-commit cap must be flagged, not silent"
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_keep_local_preserves_ahead_commits() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Remote at base; local branch one commit ahead (diverged/ahead).
        let base_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        set_origin_tracking_ref(&repo_path, "feature/keep", &base_sha);
        assert_git_success(&repo_path, &["checkout", "-b", "feature/keep"]);
        std::fs::write(repo_path.join("local.txt"), "local ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "local.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "local ahead commit"]);
        let local_tip = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/keep"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        let worktree_path = temp.path().join("worktree");

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/keep",
            DivergenceResolution::KeepLocal,
        )
        .await
        .expect("KeepLocal should create a worktree on the diverged local branch");

        assert_eq!(branch_name, "feature/keep");
        // Worktree HEAD equals the local tip: ahead commits survived.
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "HEAD"]),
            local_tip
        );
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "feature/keep"
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_reset_to_remote_discards_ahead_commits() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Build a remote-only commit and point origin/<branch> at it.
        assert_git_success(&repo_path, &["checkout", "-b", "tmp-remote"]);
        std::fs::write(repo_path.join("remote.txt"), "remote only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "remote.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "remote-only commit"]);
        let remote_tip = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_git_success(&repo_path, &["branch", "-D", "tmp-remote"]);
        set_origin_tracking_ref(&repo_path, "feature/reset", &remote_tip);

        // Diverged local branch with its own ahead commit.
        assert_git_success(&repo_path, &["checkout", "-b", "feature/reset"]);
        std::fs::write(repo_path.join("local.txt"), "local only\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "local.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "local-only commit"]);
        let local_tip = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/reset"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        assert_ne!(local_tip, remote_tip);
        let worktree_path = temp.path().join("worktree");

        let branch_name = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/reset",
            DivergenceResolution::ResetToRemote,
        )
        .await
        .expect("ResetToRemote should create a worktree and reset it to the remote tip");

        assert_eq!(branch_name, "feature/reset");
        // Worktree HEAD equals the remote tip: local ahead commits were discarded.
        assert_eq!(
            git_stdout(&worktree_path, &["rev-parse", "HEAD"]),
            remote_tip
        );
        // The local branch ref itself now points at the remote tip (reset moved it).
        assert_eq!(
            git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/reset"]),
            remote_tip
        );
    }

    #[tokio::test]
    async fn create_worktree_from_existing_branch_auto_still_errors_when_diverged() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        // Remote at base; local branch one commit ahead.
        let base_sha = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        set_origin_tracking_ref(&repo_path, "feature/auto", &base_sha);
        assert_git_success(&repo_path, &["checkout", "-b", "feature/auto"]);
        std::fs::write(repo_path.join("local.txt"), "local ahead\n")
            .expect("fixture file should be written");
        assert_git_success(&repo_path, &["add", "local.txt"]);
        assert_git_success(&repo_path, &["commit", "-m", "local ahead commit"]);
        let local_tip = git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/auto"]);
        assert_git_success(&repo_path, &["checkout", "main"]);
        let worktree_path = temp.path().join("worktree");

        let error = create_worktree_from_existing_branch(
            &repo_path,
            &worktree_path,
            "origin/feature/auto",
            DivergenceResolution::Auto,
        )
        .await
        .expect_err("Auto must preserve today's structured divergence error");

        let message = error.to_string();
        assert!(
            message.contains("diverged") && message.contains("ahead"),
            "Auto divergence error should explain the divergence, got: {message}"
        );
        // Nothing mutated.
        assert_eq!(
            git_stdout(&repo_path, &["rev-parse", "refs/heads/feature/auto"]),
            local_tip
        );
        assert!(
            !worktree_path.exists(),
            "Auto must not create a worktree when the local branch has diverged"
        );
    }
}
