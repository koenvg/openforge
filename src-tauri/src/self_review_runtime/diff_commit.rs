use super::git_refs;
use crate::diff_parser;
use serde::Serialize;

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
        git_refs::resolve_self_review_base(worktree_path).await?
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

pub async fn get_task_commits_for_workspace(
    worktree_path: &str,
) -> Result<Vec<CommitInfo>, String> {
    let merge_base = git_refs::resolve_self_review_base(worktree_path).await?;

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

pub async fn get_commit_diff_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let parent_sha = git_refs::get_parent_sha(worktree_path, commit_sha).await?;

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
