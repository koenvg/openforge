use super::git_refs;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

pub(super) const MAX_INLINE_VIDEO_PREVIEW_SIZE: usize = 25 * 1024 * 1024;

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
pub(super) struct FileRevisionContent {
    pub(super) content: String,
    pub(super) availability: FileRevisionAvailability,
}

pub(super) fn is_image_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico")
    )
}

pub(super) fn video_mime_type(path: &str) -> Option<&'static str> {
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

pub(super) fn is_video_path(path: &str) -> bool {
    video_mime_type(path).is_some()
}

pub(super) fn is_removed_status(status: &str) -> bool {
    status == "removed" || status == "deleted"
}

pub(super) fn bytes_to_frontend_revision(path: &str, bytes: &[u8]) -> FileRevisionContent {
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

pub(super) async fn read_contained_worktree_file(
    worktree_path: &str,
    path: &str,
) -> Option<Vec<u8>> {
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
    let base_ref = git_refs::resolve_content_base_ref(worktree_path, include_committed).await?;

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
    let base_ref = git_refs::resolve_content_base_ref(worktree_path, include_committed).await?;

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

pub async fn get_commit_file_contents_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
) -> Result<FileContentsResult, String> {
    let parent_sha = git_refs::get_parent_sha(worktree_path, commit_sha).await?;

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
    let parent_sha = git_refs::get_parent_sha(worktree_path, commit_sha).await?;

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
