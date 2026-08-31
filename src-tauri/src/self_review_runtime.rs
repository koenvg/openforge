use crate::diff_parser;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

const SELF_REVIEW_BASE_CANDIDATES: &[&str] = &["origin/main", "origin/HEAD", "main", "master"];
const MAX_INLINE_VIDEO_PREVIEW_SIZE: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Parse NUL-separated git log output into CommitInfo structs.
pub fn parse_git_log_output(output: &str) -> Vec<CommitInfo> {
    if output.trim().is_empty() {
        return Vec::new();
    }
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 5 {
                Some(CommitInfo {
                    sha: parts[0].to_string(),
                    short_sha: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    date: parts[4].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

pub async fn get_task_diff_for_workspace(
    worktree_path: &str,
    include_committed: bool,
    include_uncommitted: bool,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    // The diff base is the merge-base when committed changes are included, and
    // HEAD when they are not (so the diff shows only work-tree changes). Skipping
    // merge-base resolution in the latter case also lets uncommitted-only review
    // work in repos without a usable base candidate.
    let base_ref = if include_committed {
        resolve_self_review_base(worktree_path).await?
    } else {
        "HEAD".to_string()
    };

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("-C").arg(worktree_path).arg("diff").arg(&base_ref);
    if !include_uncommitted {
        cmd.arg("HEAD");
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let diff_output = String::from_utf8_lossy(&output.stdout);
    let mut diffs = diff_parser::parse_unified_diff(&diff_output, true);

    if include_uncommitted {
        let untracked_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["ls-files", "--others", "--exclude-standard"])
            .output()
            .await
            .map_err(|e| format!("Failed to run git ls-files: {}", e))?;

        if untracked_output.status.success() {
            let untracked_str = String::from_utf8_lossy(&untracked_output.stdout);
            for filename in untracked_str.lines() {
                let filename = filename.trim().to_string();
                if filename.is_empty() {
                    continue;
                }
                let full_path = std::path::Path::new(&worktree_path).join(&filename);
                match tokio::fs::read_to_string(&full_path).await {
                    Ok(content) => {
                        let lines: Vec<&str> = content.lines().collect();
                        let line_count = lines.len();
                        let total_patch_lines = line_count + 1; // +1 for @@ header
                        let (is_truncated, patch_line_count, patch_lines_to_use) =
                            if line_count > 10_000 {
                                (true, Some(total_patch_lines as i32), 199) // 199 content lines + 1 header = 200
                            } else {
                                (false, None, line_count)
                            };
                        let mut patch = format!("@@ -0,0 +1,{} @@\n", line_count);
                        for line in lines.iter().take(patch_lines_to_use) {
                            patch.push('+');
                            patch.push_str(line);
                            patch.push('\n');
                        }
                        diffs.push(diff_parser::TaskFileDiff {
                            sha: String::new(),
                            filename,
                            status: "added".to_string(),
                            additions: line_count as i32,
                            deletions: 0,
                            changes: line_count as i32,
                            patch: Some(patch),
                            previous_filename: None,
                            is_truncated,
                            patch_line_count,
                        });
                    }
                    Err(_) => {
                        diffs.push(diff_parser::TaskFileDiff {
                            sha: String::new(),
                            filename,
                            status: "binary".to_string(),
                            additions: 0,
                            deletions: 0,
                            changes: 0,
                            patch: None,
                            previous_filename: None,
                            is_truncated: false,
                            patch_line_count: None,
                        });
                    }
                }
            }
        }
    }

    Ok(diffs)
}

// ============================================================================
// Base ref helpers
// ============================================================================

async fn merge_base_for_ref(worktree_path: &str, base_ref: &str) -> Result<Option<String>, String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["merge-base", base_ref, "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base for {base_ref}: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let merge_base = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if merge_base.is_empty() {
        Ok(None)
    } else {
        Ok(Some(merge_base))
    }
}

async fn resolve_self_review_base(worktree_path: &str) -> Result<String, String> {
    for base_ref in SELF_REVIEW_BASE_CANDIDATES {
        if let Some(merge_base) = merge_base_for_ref(worktree_path, base_ref).await? {
            return Ok(merge_base);
        }
    }

    Err(format!(
        "Failed to resolve self-review base: no usable merge base found from candidates [{}]",
        SELF_REVIEW_BASE_CANDIDATES.join(", ")
    ))
}

/// The git ref a file's "old" side is diffed against. When committed changes are
/// included the base is the merge-base (showing the full task diff); when only
/// uncommitted changes are wanted the base is HEAD, so work-tree edits stand
/// alone and no merge-base candidate is required.
async fn resolve_content_base_ref(
    worktree_path: &str,
    include_committed: bool,
) -> Result<String, String> {
    if include_committed {
        resolve_self_review_base(worktree_path).await
    } else {
        Ok("HEAD".to_string())
    }
}

// ============================================================================
// File content helpers
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum FileRevisionAvailability {
    Available { size: usize },
    Missing,
    TooLarge { size: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentsResult {
    pub old_content: String,
    pub new_content: String,
    pub old_availability: FileRevisionAvailability,
    pub new_availability: FileRevisionAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileRevisionContent {
    content: String,
    availability: FileRevisionAvailability,
}

fn is_image_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico")
    )
}

fn video_mime_type(path: &str) -> Option<&'static str> {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())?;

    match extension.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "ogv" | "ogg" => Some("video/ogg"),
        "mov" => Some("video/quicktime"),
        _ => None,
    }
}

fn is_video_path(path: &str) -> bool {
    video_mime_type(path).is_some()
}

fn is_removed_status(status: &str) -> bool {
    status == "removed" || status == "deleted"
}

fn bytes_to_frontend_revision(path: &str, bytes: &[u8]) -> FileRevisionContent {
    let size = bytes.len();
    if is_video_path(path) && size > MAX_INLINE_VIDEO_PREVIEW_SIZE {
        return FileRevisionContent {
            content: String::new(),
            availability: FileRevisionAvailability::TooLarge { size },
        };
    }

    let content = if is_image_path(path) || is_video_path(path) {
        general_purpose::STANDARD.encode(bytes)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    };

    FileRevisionContent {
        content,
        availability: FileRevisionAvailability::Available { size },
    }
}

fn missing_frontend_revision() -> FileRevisionContent {
    FileRevisionContent {
        content: String::new(),
        availability: FileRevisionAvailability::Missing,
    }
}

fn into_file_contents_result(
    old_revision: FileRevisionContent,
    new_revision: FileRevisionContent,
) -> FileContentsResult {
    FileContentsResult {
        old_content: old_revision.content,
        new_content: new_revision.content,
        old_availability: old_revision.availability,
        new_availability: new_revision.availability,
    }
}

async fn read_contained_worktree_file(worktree_path: &str, path: &str) -> Option<Vec<u8>> {
    let canonical_root = tokio::fs::canonicalize(worktree_path).await.ok()?;
    let canonical_file = tokio::fs::canonicalize(canonical_root.join(path))
        .await
        .ok()?;
    if !canonical_file.starts_with(&canonical_root) {
        return None;
    }

    tokio::fs::read(canonical_file).await.ok()
}

async fn fetch_file_contents(
    worktree_path: &str,
    base_ref: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
    include_uncommitted: bool,
) -> Result<FileContentsResult, String> {
    let old_revision = if status == "added" {
        missing_frontend_revision()
    } else {
        let old_file_path = old_path.unwrap_or(path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", base_ref, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            bytes_to_frontend_revision(old_file_path, &old_output.stdout)
        } else {
            missing_frontend_revision()
        }
    };

    let new_revision = if is_removed_status(status) {
        missing_frontend_revision()
    } else if include_uncommitted {
        match read_contained_worktree_file(worktree_path, path).await {
            Some(bytes) => bytes_to_frontend_revision(path, &bytes),
            None => missing_frontend_revision(),
        }
    } else {
        let new_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("HEAD:{}", path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if new_output.status.success() {
            bytes_to_frontend_revision(path, &new_output.stdout)
        } else {
            missing_frontend_revision()
        }
    };

    Ok(into_file_contents_result(old_revision, new_revision))
}

// ============================================================================
// Single-file command
// ============================================================================

pub async fn get_task_file_contents_for_workspace(
    worktree_path: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
    include_committed: bool,
    include_uncommitted: bool,
) -> Result<FileContentsResult, String> {
    let base_ref = resolve_content_base_ref(worktree_path, include_committed).await?;

    fetch_file_contents(
        worktree_path,
        &base_ref,
        path,
        old_path,
        status,
        include_uncommitted,
    )
    .await
}

// ============================================================================
// Batch command — computes merge-base ONCE, then fetches N files
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct FileContentRequest {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
}

pub async fn get_task_batch_file_contents_for_workspace(
    worktree_path: &str,
    files: &[FileContentRequest],
    include_committed: bool,
    include_uncommitted: bool,
) -> Result<Vec<FileContentsResult>, String> {
    let base_ref = resolve_content_base_ref(worktree_path, include_committed).await?;

    // Fetch each file using the single pre-computed base ref.
    let mut results = Vec::with_capacity(files.len());
    for file in files {
        let contents = fetch_file_contents(
            worktree_path,
            &base_ref,
            &file.path,
            file.old_path.as_deref(),
            &file.status,
            include_uncommitted,
        )
        .await?;
        results.push(contents);
    }

    Ok(results)
}

pub async fn get_task_commits_for_workspace(
    worktree_path: &str,
) -> Result<Vec<CommitInfo>, String> {
    let merge_base = resolve_self_review_base(worktree_path).await?;

    let log_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args([
            "log",
            "--ancestry-path",
            "--topo-order",
            "--reverse",
            "--pretty=format:%H%x00%h%x00%s%x00%an%x00%aI",
            &format!("{}..HEAD", merge_base),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !log_output.status.success() {
        let stderr = String::from_utf8_lossy(&log_output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&log_output.stdout);
    Ok(parse_git_log_output(&output_str))
}

// ============================================================================
// Per-commit diff helpers
// ============================================================================

/// Get the parent SHA for a commit. Falls back to the empty tree SHA for root commits.
async fn get_parent_sha(worktree_path: &str, commit_sha: &str) -> Result<String, String> {
    let parent_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["rev-parse", &format!("{}^1", commit_sha)])
        .output()
        .await
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if parent_output.status.success() {
        Ok(String::from_utf8_lossy(&parent_output.stdout)
            .trim()
            .to_string())
    } else {
        // Root commit — use git's empty tree SHA
        Ok("4b825dc642cb6eb9a060e54bf899d15006245d1a".to_string())
    }
}

async fn fetch_commit_file_contents(
    worktree_path: &str,
    parent_sha: &str,
    commit_sha: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
) -> Result<FileContentsResult, String> {
    let old_revision = if status == "added" {
        missing_frontend_revision()
    } else {
        let old_file_path = old_path.unwrap_or(path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", parent_sha, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            bytes_to_frontend_revision(old_file_path, &old_output.stdout)
        } else {
            missing_frontend_revision()
        }
    };

    let new_revision = if is_removed_status(status) {
        missing_frontend_revision()
    } else {
        let new_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", commit_sha, path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if new_output.status.success() {
            bytes_to_frontend_revision(path, &new_output.stdout)
        } else {
            missing_frontend_revision()
        }
    };

    Ok(into_file_contents_result(old_revision, new_revision))
}

// ============================================================================
// Per-commit diff commands
// ============================================================================

pub async fn get_commit_diff_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    let diff_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["diff", &parent_sha, commit_sha])
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&diff_output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&diff_output.stdout);
    Ok(diff_parser::parse_unified_diff(&output_str, true))
}

pub async fn get_commit_file_contents_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
) -> Result<FileContentsResult, String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    fetch_commit_file_contents(
        worktree_path,
        &parent_sha,
        commit_sha,
        path,
        old_path,
        status,
    )
    .await
}

pub async fn get_commit_batch_file_contents_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
    files: &[FileContentRequest],
) -> Result<Vec<FileContentsResult>, String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    let mut results = Vec::with_capacity(files.len());
    for file in files {
        let contents = fetch_commit_file_contents(
            worktree_path,
            &parent_sha,
            commit_sha,
            &file.path,
            file.old_path.as_deref(),
            &file.status,
        )
        .await?;
        results.push(contents);
    }

    Ok(results)
}

pub fn resolve_workspace_path(db: &crate::db::Database, task_id: &str) -> Result<String, String> {
    let worktree = db
        .get_worktree_for_task(task_id)
        .map_err(|e| format!("Failed to get worktree for task: {}", e))?;

    if let Some(row) = &worktree {
        if std::path::Path::new(&row.worktree_path).is_dir() {
            return Ok(row.worktree_path.clone());
        }
    }

    let workspace = db
        .get_task_workspace_for_task(task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {}", e))?;

    if let Some(workspace) = workspace {
        if std::path::Path::new(&workspace.workspace_path).is_dir() {
            return Ok(workspace.workspace_path);
        }
    }

    Err(format!("No workspace found for task {}", task_id))
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatusSummary {
    /// Whether the branch has an upstream (remote tracking) branch to compare to.
    pub has_remote: bool,
    /// Commits ahead of the remote tracking branch (i.e. waiting to be pushed).
    pub remote_ahead: i32,
    /// Commits behind the remote tracking branch (i.e. waiting to be pulled).
    pub remote_behind: i32,
    /// Commits on this branch relative to the base it was cut from — the task's
    /// own work. Counted off the base merge target internally but never surfaced
    /// as "main" in the UI; lets a fresh, unpushed branch still report its commits.
    pub local_commits: i32,
    /// Files with uncommitted changes vs HEAD (staged + unstaged tracked).
    pub uncommitted_files: i32,
    /// Inserted lines across uncommitted changes.
    pub insertions: i32,
    /// Deleted lines across uncommitted changes.
    pub deletions: i32,
    /// New files git is not tracking yet, excluding gitignored paths. `git diff`
    /// cannot see these, so they are counted separately from `uncommitted_files`
    /// rather than folded into it.
    pub untracked_files: i32,
    /// Lines across untracked files. Binary or unreadable files contribute none,
    /// mirroring how git reports them as "Bin" with no line stats.
    pub untracked_insertions: i32,
}

/// Find the first base-branch candidate (origin/main, origin/HEAD, main, master)
/// that exists and shares history with HEAD, so ahead/behind can be measured even
/// when the branch has no upstream tracking branch.
async fn resolve_base_ref(worktree_path: &str) -> Option<String> {
    for base_ref in SELF_REVIEW_BASE_CANDIDATES {
        if let Ok(Some(_)) = merge_base_for_ref(worktree_path, base_ref).await {
            return Some((*base_ref).to_string());
        }
    }
    None
}

/// Parse `git diff --shortstat` output, e.g.
/// " 38 files changed, 1607 insertions(+), 642 deletions(-)", into
/// (files, insertions, deletions). Missing segments default to 0; empty input
/// (a clean tree) yields all zeroes.
pub fn parse_diff_shortstat(shortstat: &str) -> (i32, i32, i32) {
    let mut files = 0;
    let mut insertions = 0;
    let mut deletions = 0;
    for segment in shortstat.split(',') {
        let segment = segment.trim();
        let number = segment
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        if segment.contains("changed") {
            files = number;
        } else if segment.contains("insertion") {
            insertions = number;
        } else if segment.contains("deletion") {
            deletions = number;
        }
    }
    (files, insertions, deletions)
}

/// Parse `git rev-list --left-right --count HEAD...@{upstream}` output
/// (`<ahead>\t<behind>`) into (ahead, behind). Malformed/empty input yields (0, 0).
pub fn parse_ahead_behind(rev_list: &str) -> (i32, i32) {
    let mut counts = rev_list.split_whitespace();
    let ahead = counts
        .next()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    let behind = counts
        .next()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

/// Count untracked (but not gitignored) files and the lines across them.
/// `git diff HEAD` reports nothing for these, so they need their own pass.
async fn count_untracked(worktree_path: &str) -> Result<(i32, i32), String> {
    // -z: NUL-separated, so filenames containing newlines or quotes survive.
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["ls-files", "--others", "--exclude-standard", "-z"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git ls-files: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git ls-files failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = 0;
    let mut insertions = 0;
    for filename in stdout.split('\0').filter(|name| !name.is_empty()) {
        files += 1;
        let full_path = std::path::Path::new(worktree_path).join(filename);
        if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
            insertions += content.lines().count() as i32;
        }
    }
    Ok((files, insertions))
}

/// Summarize a worktree's git state: commits ahead/behind its upstream tracking
/// branch, the uncommitted diff vs HEAD (files / insertions / deletions), and
/// untracked new files, which the diff cannot see.
pub async fn get_task_git_status_for_workspace(
    worktree_path: &str,
) -> Result<GitStatusSummary, String> {
    // Uncommitted changes vs HEAD (staged + unstaged tracked changes).
    let diff_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("HEAD")
        .arg("--shortstat")
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;
    if !diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&diff_output.stderr);
        return Err(format!("git diff failed: {}", stderr.trim()));
    }
    let (uncommitted_files, insertions, deletions) =
        parse_diff_shortstat(&String::from_utf8_lossy(&diff_output.stdout));

    let (untracked_files, untracked_insertions) = count_untracked(worktree_path).await?;

    // Ahead/behind vs the branch's own upstream (remote tracking) branch. When the
    // branch has no upstream, rev-list fails and we report "no remote".
    let remote_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg("HEAD...@{upstream}")
        .output()
        .await
        .map_err(|e| format!("Failed to run git rev-list: {}", e))?;
    let (has_remote, remote_ahead, remote_behind) = if remote_output.status.success() {
        let (ahead, behind) = parse_ahead_behind(&String::from_utf8_lossy(&remote_output.stdout));
        (true, ahead, behind)
    } else {
        (false, 0, 0)
    };

    // Commits this branch has produced, counted off the base it was cut from. This
    // surfaces local work (e.g. "1 commit") even with no remote. The base is only
    // used to count — it is never surfaced in the UI.
    let local_commits = match resolve_base_ref(worktree_path).await {
        Some(base) => {
            let count_output = tokio::process::Command::new("git")
                .arg("-C")
                .arg(worktree_path)
                .arg("rev-list")
                .arg("--count")
                .arg(format!("{base}..HEAD"))
                .output()
                .await
                .map_err(|e| format!("Failed to run git rev-list: {}", e))?;
            if count_output.status.success() {
                String::from_utf8_lossy(&count_output.stdout)
                    .trim()
                    .parse::<i32>()
                    .unwrap_or(0)
            } else {
                0
            }
        }
        None => 0,
    };

    Ok(GitStatusSummary {
        has_remote,
        remote_ahead,
        remote_behind,
        local_commits,
        uncommitted_files,
        insertions,
        deletions,
        untracked_files,
        untracked_insertions,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;
    use std::{fs, path::Path, process::Command};
    use tempfile::tempdir;

    fn run_git(repo_path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .expect("run git command");

        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git_repo() -> tempfile::TempDir {
        let repo = tempdir().expect("create temp git repo");
        run_git(repo.path(), &["init"]);
        run_git(repo.path(), &["checkout", "-B", "main"]);
        run_git(repo.path(), &["config", "user.email", "test@example.com"]);
        run_git(repo.path(), &["config", "user.name", "Test User"]);
        repo
    }

    #[test]
    fn git_status_parse_diff_shortstat_full() {
        let (files, ins, del) =
            parse_diff_shortstat(" 38 files changed, 1607 insertions(+), 642 deletions(-)\n");
        assert_eq!(files, 38);
        assert_eq!(ins, 1607);
        assert_eq!(del, 642);
    }

    #[test]
    fn git_status_parse_diff_shortstat_insertions_only() {
        let (files, ins, del) = parse_diff_shortstat(" 1 file changed, 5 insertions(+)\n");
        assert_eq!(files, 1);
        assert_eq!(ins, 5);
        assert_eq!(del, 0);
    }

    #[test]
    fn git_status_parse_diff_shortstat_deletions_only() {
        let (files, ins, del) = parse_diff_shortstat(" 2 files changed, 3 deletions(-)\n");
        assert_eq!(files, 2);
        assert_eq!(ins, 0);
        assert_eq!(del, 3);
    }

    #[test]
    fn git_status_parse_diff_shortstat_empty_is_zero() {
        assert_eq!(parse_diff_shortstat(""), (0, 0, 0));
    }

    #[test]
    fn git_status_parse_ahead_behind_reads_ahead_then_behind() {
        // `git rev-list --left-right --count HEAD...@{upstream}` => "<ahead>\t<behind>"
        assert_eq!(parse_ahead_behind("3\t1\n"), (3, 1));
        assert_eq!(parse_ahead_behind("0\t0\n"), (0, 0));
    }

    #[test]
    fn git_status_parse_ahead_behind_zero_when_empty_or_malformed() {
        assert_eq!(parse_ahead_behind(""), (0, 0));
        assert_eq!(parse_ahead_behind("garbage"), (0, 0));
    }

    #[tokio::test]
    async fn git_status_summary_reports_no_remote_with_local_commits() {
        let repo = init_git_repo();
        // Base commit on main.
        fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "base"]);
        // Task branch with one commit (no remote/upstream configured).
        run_git(repo.path(), &["checkout", "-b", "task"]);
        fs::write(repo.path().join("b.txt"), "2\n").expect("write b.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "task commit"]);
        // One uncommitted modification.
        fs::write(repo.path().join("a.txt"), "1\nmore\n").expect("modify a.txt");

        let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("git status summary");

        assert!(!summary.has_remote);
        assert_eq!(summary.remote_ahead, 0);
        assert_eq!(summary.remote_behind, 0);
        assert_eq!(summary.local_commits, 1);
        assert_eq!(summary.uncommitted_files, 1);
        assert_eq!(summary.insertions, 1);
        assert_eq!(summary.deletions, 0);
    }

    #[tokio::test]
    async fn git_status_summary_counts_untracked_files_and_their_lines() {
        let repo = init_git_repo();
        fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "base"]);
        // Brand-new files, which `git diff HEAD` cannot see at all.
        fs::write(repo.path().join("new1.txt"), "one\ntwo\nthree\n").expect("write new1.txt");
        fs::write(repo.path().join("new2.txt"), "solo").expect("write new2.txt");

        let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("git status summary");

        assert_eq!(summary.untracked_files, 2);
        // 3 lines, plus 1 line that has no trailing newline.
        assert_eq!(summary.untracked_insertions, 4);
        // Untracked files must stay out of the tracked-diff counts.
        assert_eq!(summary.uncommitted_files, 0);
        assert_eq!(summary.insertions, 0);
    }

    #[tokio::test]
    async fn git_status_summary_untracked_excludes_gitignored_files() {
        let repo = init_git_repo();
        fs::write(repo.path().join(".gitignore"), "ignored/\n").expect("write .gitignore");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "base"]);
        fs::create_dir(repo.path().join("ignored")).expect("create ignored dir");
        fs::write(repo.path().join("ignored/junk.txt"), "noise\n").expect("write junk.txt");

        let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("git status summary");

        assert_eq!(summary.untracked_files, 0);
        assert_eq!(summary.untracked_insertions, 0);
    }

    #[tokio::test]
    async fn git_status_summary_untracked_counts_binary_file_without_lines() {
        let repo = init_git_repo();
        fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "base"]);
        // Invalid UTF-8 — counts as a file, but contributes no lines.
        fs::write(repo.path().join("blob.bin"), [0xff, 0xfe, 0x00, 0x01]).expect("write blob.bin");

        let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("git status summary");

        assert_eq!(summary.untracked_files, 1);
        assert_eq!(summary.untracked_insertions, 0);
    }

    #[tokio::test]
    async fn git_status_summary_reports_ahead_of_remote_when_pushed() {
        let remote = tempdir().expect("create bare remote");
        run_git(remote.path(), &["init", "--bare"]);

        let repo = init_git_repo();
        fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "base"]);
        run_git(
            repo.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        // Push sets up the upstream tracking branch (origin/main); branch is in sync.
        run_git(repo.path(), &["push", "-u", "origin", "main"]);
        // One local commit that has not been pushed.
        fs::write(repo.path().join("c.txt"), "x\n").expect("write c.txt");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "unpushed"]);

        let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("git status summary");

        assert!(summary.has_remote);
        assert_eq!(summary.remote_ahead, 1);
        assert_eq!(summary.remote_behind, 0);
    }

    fn write_repo_file(repo_path: &Path, path: &str, content: &str) {
        fs::write(repo_path.join(path), content).expect("write repo file");
    }

    fn commit_all(repo_path: &Path, message: &str) {
        run_git(repo_path, &["add", "."]);
        run_git(repo_path, &["commit", "-m", message]);
    }

    #[tokio::test]
    async fn test_task_diff_falls_back_to_local_main_without_origin_main() {
        let repo = init_git_repo();
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
        commit_all(repo.path(), "feature commit");

        let result = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false).await;

        assert!(
            result.is_ok(),
            "local-only repositories without origin/main should still produce a self-review diff: {:?}",
            result
        );
        let diffs = result.unwrap();
        assert!(
            diffs.iter().any(|diff| {
                diff.filename == "tracked.txt"
                    && diff.patch.as_deref().unwrap_or("").contains("+feature")
            }),
            "expected diff for feature commit, got {:?}",
            diffs
        );
    }

    /// Repo with one committed change to `tracked.txt`, then an uncommitted
    /// modification to it, plus a brand-new untracked file. Used to assert the
    /// committed/uncommitted scope flags select the right slice of changes.
    fn setup_committed_and_uncommitted_repo() -> tempfile::TempDir {
        let repo = init_git_repo();
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\ncommitted\n");
        commit_all(repo.path(), "committed change");
        // Uncommitted (unstaged) modification on top of the committed change.
        write_repo_file(repo.path(), "tracked.txt", "base\ncommitted\nuncommitted\n");
        // Untracked file — uncommitted, never added.
        write_repo_file(repo.path(), "untracked.txt", "new file\n");
        repo
    }

    #[tokio::test]
    async fn test_task_diff_committed_only_excludes_uncommitted_and_untracked() {
        let repo = setup_committed_and_uncommitted_repo();

        let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false)
            .await
            .expect("committed-only diff");

        let tracked = diffs
            .iter()
            .find(|d| d.filename == "tracked.txt")
            .expect("tracked.txt in diff");
        let patch = tracked.patch.as_deref().unwrap_or("");
        assert!(
            patch.contains("+committed"),
            "committed change should show: {patch}"
        );
        assert!(
            !patch.contains("+uncommitted"),
            "uncommitted change must be hidden in committed-only mode: {patch}"
        );
        assert!(
            !diffs.iter().any(|d| d.filename == "untracked.txt"),
            "untracked file must be hidden in committed-only mode"
        );
    }

    #[tokio::test]
    async fn test_task_diff_both_includes_committed_and_uncommitted() {
        let repo = setup_committed_and_uncommitted_repo();

        let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, true)
            .await
            .expect("both-scopes diff");

        let tracked = diffs
            .iter()
            .find(|d| d.filename == "tracked.txt")
            .expect("tracked.txt in diff");
        let patch = tracked.patch.as_deref().unwrap_or("");
        assert!(
            patch.contains("+committed"),
            "committed change should show: {patch}"
        );
        assert!(
            patch.contains("+uncommitted"),
            "uncommitted change should show: {patch}"
        );
        assert!(
            diffs.iter().any(|d| d.filename == "untracked.txt"),
            "untracked file should show when uncommitted is included"
        );
    }

    #[tokio::test]
    async fn test_task_diff_uncommitted_only_excludes_committed() {
        let repo = setup_committed_and_uncommitted_repo();

        let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, true)
            .await
            .expect("uncommitted-only diff");

        let tracked = diffs
            .iter()
            .find(|d| d.filename == "tracked.txt")
            .expect("tracked.txt in diff");
        let patch = tracked.patch.as_deref().unwrap_or("");
        assert!(
            patch.contains("+uncommitted"),
            "uncommitted change should show: {patch}"
        );
        assert!(
            !patch.contains("+committed"),
            "committed change is already in HEAD and must NOT re-appear in uncommitted-only mode: {patch}"
        );
        assert!(
            diffs.iter().any(|d| d.filename == "untracked.txt"),
            "untracked file should show in uncommitted-only mode"
        );
    }

    #[tokio::test]
    async fn test_task_diff_neither_scope_is_empty() {
        let repo = setup_committed_and_uncommitted_repo();

        let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, false)
            .await
            .expect("empty-scope diff");

        assert!(
            diffs.is_empty(),
            "no scope selected yields no diff, got {diffs:?}"
        );
    }

    #[tokio::test]
    async fn test_task_diff_uncommitted_only_works_without_base_candidate() {
        // No origin/main, main, or master shares history with HEAD — committed mode
        // would error, but uncommitted-only compares against HEAD and must still work.
        let repo = init_git_repo();
        run_git(repo.path(), &["checkout", "-B", "trunk"]);
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "trunk base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\nuncommitted\n");

        let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, true)
            .await
            .expect("uncommitted-only diff should not require a base candidate");

        let tracked = diffs
            .iter()
            .find(|d| d.filename == "tracked.txt")
            .expect("tracked.txt in diff");
        assert!(tracked
            .patch
            .as_deref()
            .unwrap_or("")
            .contains("+uncommitted"));
    }

    #[tokio::test]
    async fn test_task_file_contents_committed_only_uses_merge_base_and_head() {
        let repo = setup_committed_and_uncommitted_repo();

        let contents = get_task_file_contents_for_workspace(
            repo.path().to_str().unwrap(),
            "tracked.txt",
            None,
            "modified",
            true,
            false,
        )
        .await
        .expect("committed-only file contents");

        assert_eq!(contents.old_content, "base\n", "old = merge-base version");
        assert_eq!(
            contents.new_content, "base\ncommitted\n",
            "new = HEAD version"
        );
    }

    #[tokio::test]
    async fn test_task_file_contents_uncommitted_only_uses_head_and_worktree() {
        let repo = setup_committed_and_uncommitted_repo();

        let contents = get_task_file_contents_for_workspace(
            repo.path().to_str().unwrap(),
            "tracked.txt",
            None,
            "modified",
            false,
            true,
        )
        .await
        .expect("uncommitted-only file contents");

        assert_eq!(
            contents.old_content, "base\ncommitted\n",
            "old = HEAD version"
        );
        assert_eq!(
            contents.new_content, "base\ncommitted\nuncommitted\n",
            "new = working-tree version"
        );
    }

    #[tokio::test]
    async fn test_task_commits_falls_back_to_local_main_without_origin_main() {
        let repo = init_git_repo();
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
        commit_all(repo.path(), "feature commit");

        let commits = get_task_commits_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect(
                "local-only repositories without origin/main should still produce commit history",
            );

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "feature commit");
    }

    #[tokio::test]
    async fn test_task_commits_prefers_origin_main_when_available() {
        let repo = init_git_repo();
        write_repo_file(repo.path(), "tracked.txt", "root\n");
        commit_all(repo.path(), "root commit");
        write_repo_file(repo.path(), "tracked.txt", "root\norigin base\n");
        commit_all(repo.path(), "origin base commit");
        run_git(
            repo.path(),
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );
        run_git(repo.path(), &["reset", "--hard", "HEAD~1"]);
        run_git(repo.path(), &["checkout", "-b", "feature", "origin/main"]);
        write_repo_file(repo.path(), "tracked.txt", "root\norigin base\nfeature\n");
        commit_all(repo.path(), "feature commit");

        let commits = get_task_commits_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect("origin/main should be used when available");

        let messages: Vec<&str> = commits
            .iter()
            .map(|commit| commit.message.as_str())
            .collect();
        assert_eq!(messages, vec!["feature commit"]);
    }

    #[tokio::test]
    async fn test_task_diff_errors_when_no_candidate_base_exists() {
        let repo = init_git_repo();
        run_git(repo.path(), &["checkout", "-B", "trunk"]);
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "trunk base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
        commit_all(repo.path(), "feature commit");

        let err = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false)
            .await
            .expect_err("missing base candidates should not fall back to HEAD and hide diffs");

        assert!(
            err.contains("Failed to resolve self-review base"),
            "expected explicit base-resolution error, got {err}"
        );
    }

    #[tokio::test]
    async fn test_task_commits_errors_when_no_candidate_base_exists() {
        let repo = init_git_repo();
        run_git(repo.path(), &["checkout", "-B", "trunk"]);
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "trunk base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
        commit_all(repo.path(), "feature commit");

        let err = get_task_commits_for_workspace(repo.path().to_str().unwrap())
            .await
            .expect_err("missing base candidates should not fall back to HEAD and hide commits");

        assert!(
            err.contains("Failed to resolve self-review base"),
            "expected explicit base-resolution error, got {err}"
        );
    }

    #[test]
    fn test_resolve_workspace_path_from_task_workspaces_only() {
        let (db, _temp_dir) = make_test_db("resolve_workspace_path_task_workspaces_only");
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task("No worktree task", "doing", Some(&project.id), None, None)
            .expect("create task failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, workspace_path);

        drop(db);
    }

    #[test]
    fn test_resolve_workspace_path_prefers_worktrees_row() {
        let (db, _temp_dir) = make_test_db("resolve_workspace_path_prefers_worktrees");
        let worktree_dir = tempdir().expect("create temp worktree dir");
        let worktree_path = worktree_dir.path().to_string_lossy().to_string();
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task("Both sources task", "doing", Some(&project.id), None, None)
            .expect("create task failed");

        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            &worktree_path,
            "branch-1",
        )
        .expect("create worktree record failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, worktree_path);

        drop(db);
    }

    #[test]
    fn test_resolve_workspace_path_falls_back_when_worktree_path_is_stale() {
        let (db, _temp_dir) = make_test_db("resolve_workspace_path_stale_worktree");
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Stale worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task failed");

        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/non-existent-worktree-path",
            "branch-1",
        )
        .expect("create worktree record failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, workspace_path);

        drop(db);
    }

    #[test]
    fn test_resolve_workspace_path_returns_err_when_no_row_exists() {
        let (db, _temp_dir) = make_test_db("resolve_workspace_path_no_row");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Task with no workspace",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task failed");

        let result = resolve_workspace_path(&db, &task.id);
        assert!(result.is_err(), "expected Err but got {:?}", result);
        assert!(
            result.unwrap_err().contains(&task.id),
            "error message should contain task id"
        );

        drop(db);
    }

    #[test]
    fn test_image_path_detection_is_case_insensitive() {
        assert!(is_image_path("assets/logo.PNG"));
        assert!(is_image_path("photo.jpeg"));
        assert!(is_image_path("icons/vector.svg"));
        assert!(!is_image_path("src/main.rs"));
    }

    #[test]
    fn test_video_path_detection_and_mime_types_are_case_insensitive() {
        let cases = [
            ("recordings/demo.mp4", "video/mp4"),
            ("recordings/demo.M4V", "video/mp4"),
            ("recordings/demo.webm", "video/webm"),
            ("recordings/demo.OGV", "video/ogg"),
            ("recordings/demo.ogg", "video/ogg"),
            ("recordings/demo.MOV", "video/quicktime"),
        ];

        for (path, expected_mime_type) in cases {
            assert!(is_video_path(path), "expected {path} to be a video");
            assert_eq!(video_mime_type(path), Some(expected_mime_type));
        }
        assert!(!is_video_path("src/main.rs"));
        assert_eq!(video_mime_type("src/main.rs"), None);
    }

    #[test]
    fn test_video_content_is_encoded_for_frontend() {
        let revision = bytes_to_frontend_revision("recordings/demo.mp4", &[0xff, 0x00, 0x7f]);

        assert_eq!(revision.content, "/wB/");
        assert_eq!(
            revision.availability,
            FileRevisionAvailability::Available { size: 3 }
        );
    }

    #[test]
    fn test_video_content_over_the_inline_limit_is_not_encoded() {
        let bytes = vec![0_u8; MAX_INLINE_VIDEO_PREVIEW_SIZE + 1];
        let revision = bytes_to_frontend_revision("recordings/demo.webm", &bytes);

        assert!(revision.content.is_empty());
        assert_eq!(
            revision.availability,
            FileRevisionAvailability::TooLarge { size: bytes.len() }
        );
    }

    #[tokio::test]
    async fn test_added_video_has_a_missing_old_revision_and_base64_new_revision() {
        let repo = init_git_repo();
        write_repo_file(repo.path(), "tracked.txt", "base\n");
        commit_all(repo.path(), "base commit");
        run_git(repo.path(), &["checkout", "-b", "feature"]);
        fs::create_dir_all(repo.path().join("recordings")).expect("create recordings directory");
        fs::write(repo.path().join("recordings/demo.MP4"), [0xff, 0x00, 0x7f])
            .expect("write video");
        commit_all(repo.path(), "add video");

        let contents = get_task_file_contents_for_workspace(
            repo.path().to_str().expect("repo path is UTF-8"),
            "recordings/demo.MP4",
            None,
            "added",
            true,
            false,
        )
        .await
        .expect("video contents");

        assert!(contents.old_content.is_empty());
        assert_eq!(contents.old_availability, FileRevisionAvailability::Missing);
        assert_eq!(contents.new_content, "/wB/");
        assert_eq!(
            contents.new_availability,
            FileRevisionAvailability::Available { size: 3 }
        );
    }

    #[test]
    fn test_image_content_is_encoded_for_frontend() {
        let content =
            bytes_to_frontend_revision("assets/logo.png", &[0x89, b'P', b'N', b'G']).content;
        assert_eq!(content, "iVBORw==");
    }

    #[test]
    fn test_text_content_stays_text_for_frontend() {
        let content = bytes_to_frontend_revision("src/main.rs", b"fn main() {}\n").content;
        assert_eq!(content, "fn main() {}\n");
    }

    #[tokio::test]
    async fn test_worktree_file_reads_stay_within_canonical_root() {
        let worktree = tempdir().expect("create worktree");
        fs::create_dir_all(worktree.path().join("assets")).expect("create assets directory");
        fs::write(worktree.path().join("assets/logo.png"), b"image").expect("write image");

        assert_eq!(
            read_contained_worktree_file(
                worktree.path().to_str().expect("worktree path is UTF-8"),
                "assets/logo.png",
            )
            .await,
            Some(b"image".to_vec()),
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let outside = tempdir().expect("create outside directory");
            fs::write(outside.path().join("secret.png"), b"secret").expect("write secret");
            symlink(outside.path(), worktree.path().join("linked")).expect("create symlink");

            assert_eq!(
                read_contained_worktree_file(
                    worktree.path().to_str().expect("worktree path is UTF-8"),
                    "linked/secret.png",
                )
                .await,
                None,
            );
        }
    }

    #[test]
    fn test_removed_status_accepts_git_and_github_names() {
        assert!(is_removed_status("removed"));
        assert!(is_removed_status("deleted"));
        assert!(!is_removed_status("modified"));
    }

    #[test]
    fn test_file_content_request_deserialize() {
        let json = r#"{"path":"src/main.rs","old_path":null,"status":"modified"}"#;
        let req: FileContentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "src/main.rs");
        assert!(req.old_path.is_none());
        assert_eq!(req.status, "modified");
    }

    #[test]
    fn test_file_content_request_deserialize_with_old_path() {
        let json = r#"{"path":"new/path.rs","old_path":"old/path.rs","status":"renamed"}"#;
        let req: FileContentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "new/path.rs");
        assert_eq!(req.old_path.as_deref(), Some("old/path.rs"));
        assert_eq!(req.status, "renamed");
    }

    #[test]
    fn test_batch_request_produces_parallel_results_structure() {
        let files = [
            FileContentRequest {
                path: "a.rs".into(),
                old_path: None,
                status: "added".into(),
            },
            FileContentRequest {
                path: "b.rs".into(),
                old_path: None,
                status: "modified".into(),
            },
            FileContentRequest {
                path: "c.rs".into(),
                old_path: Some("old_c.rs".into()),
                status: "renamed".into(),
            },
        ];

        assert_eq!(files.len(), 3);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["a.rs", "b.rs", "c.rs"]);
    }

    #[test]
    fn test_commit_info_serialize() {
        let info = super::CommitInfo {
            sha: "abc123def456".to_string(),
            short_sha: "abc123d".to_string(),
            message: "Fix login bug".to_string(),
            author: "dev".to_string(),
            date: "2025-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("abc123def456"));
        assert!(json.contains("abc123d"));
        assert!(json.contains("Fix login bug"));
    }

    #[test]
    fn test_parse_git_log_output_multiple() {
        let output = "abc123\0abc\0First commit\0Alice\x002025-01-01T00:00:00Z\ndef456\0def\0Second commit\0Bob\x002025-01-02T00:00:00Z";
        let result = super::parse_git_log_output(output);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].sha, "abc123");
        assert_eq!(result[0].short_sha, "abc");
        assert_eq!(result[0].message, "First commit");
        assert_eq!(result[0].author, "Alice");
        assert_eq!(result[1].sha, "def456");
        assert_eq!(result[1].message, "Second commit");
    }

    #[test]
    fn test_parse_git_log_output_empty() {
        let result = super::parse_git_log_output("");
        assert!(result.is_empty());
        let result = super::parse_git_log_output("   \n  ");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_git_log_output_malformed_line() {
        let output = "abc123\0abc\0Commit msg\0Author\x002025-01-01\nbadline";
        let result = super::parse_git_log_output(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sha, "abc123");
    }
}
