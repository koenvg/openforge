pub(super) const SELF_REVIEW_BASE_CANDIDATES: &[&str] =
    &["origin/main", "origin/HEAD", "main", "master"];

pub(super) async fn merge_base_for_ref(
    worktree_path: &str,
    base_ref: &str,
) -> Result<Option<String>, String> {
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

pub(super) async fn resolve_self_review_base(worktree_path: &str) -> Result<String, String> {
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
pub(super) async fn resolve_content_base_ref(
    worktree_path: &str,
    include_committed: bool,
) -> Result<String, String> {
    if include_committed {
        resolve_self_review_base(worktree_path).await
    } else {
        Ok("HEAD".to_string())
    }
}

/// Get the parent SHA for a commit. Falls back to the empty tree SHA for root commits.
pub(super) async fn get_parent_sha(
    worktree_path: &str,
    commit_sha: &str,
) -> Result<String, String> {
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
