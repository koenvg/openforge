use std::sync::Mutex;
use tauri::State;
use crate::{db, diff_parser};

#[tauri::command]
pub async fn get_task_diff(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let worktree_path = {
        let db = db.lock().unwrap();
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .arg("diff")
        .arg(&merge_base)
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let diff_output = String::from_utf8_lossy(&output.stdout);
    Ok(diff_parser::parse_unified_diff(&diff_output, true))
}

#[tauri::command]
pub async fn get_task_file_contents(
    task_id: String,
    path: String,
    old_path: Option<String>,
    status: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(String, String), String> {
    let worktree_path = {
        let db = db.lock().unwrap();
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    let old_content = if status == "added" {
        String::new()
    } else {
        let old_file_path = old_path.as_deref().unwrap_or(&path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&worktree_path)
            .args(["show", &format!("{}:{}", merge_base, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            String::from_utf8_lossy(&old_output.stdout).to_string()
        } else {
            String::new()
        }
    };

    let new_content = if status == "deleted" {
        String::new()
    } else {
        let full_path = std::path::Path::new(&worktree_path).join(&path);
        tokio::fs::read_to_string(&full_path)
            .await
            .unwrap_or_default()
    };

    Ok((old_content, new_content))
}

#[tauri::command]
pub async fn add_self_review_comment(
    task_id: String,
    comment_type: String,
    file_path: Option<String>,
    line_number: Option<i32>,
    body: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<i64, String> {
    let db = db.lock().unwrap();
    db.insert_self_review_comment(
        &task_id,
        &comment_type,
        file_path.as_deref(),
        line_number,
        &body,
    )
    .map_err(|e| format!("Failed to add self review comment: {}", e))
}

#[tauri::command]
pub async fn get_active_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = db.lock().unwrap();
    db.get_active_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get active self review comments: {}", e))
}

#[tauri::command]
pub async fn get_archived_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = db.lock().unwrap();
    db.get_archived_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get archived self review comments: {}", e))
}

#[tauri::command]
pub async fn delete_self_review_comment(
    comment_id: i64,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_self_review_comment(comment_id)
        .map_err(|e| format!("Failed to delete self review comment: {}", e))
}

#[tauri::command]
pub async fn archive_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.archive_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to archive self review comments: {}", e))
}
