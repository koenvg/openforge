use super::git_refs::{merge_base_for_ref, SELF_REVIEW_BASE_CANDIDATES};
use serde::Serialize;

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
