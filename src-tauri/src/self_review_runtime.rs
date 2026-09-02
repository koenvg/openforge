mod diff_commit;
mod file_preview;
mod git_refs;
mod git_status;

// Keep the original module interface while routing implementation to focused modules.
#[allow(unused_imports)]
pub use diff_commit::{
    get_commit_diff_for_workspace, get_task_commits_for_workspace, get_task_diff_for_workspace,
    parse_git_log_output, CommitInfo,
};
#[allow(unused_imports)]
pub use file_preview::{
    get_commit_batch_file_contents_for_workspace, get_commit_file_contents_for_workspace,
    get_task_batch_file_contents_for_workspace, get_task_file_contents_for_workspace,
    FileContentRequest, FileContentsResult, FileRevisionAvailability,
};
#[allow(unused_imports)]
pub use git_status::{
    get_task_git_status_for_workspace, parse_ahead_behind, parse_diff_shortstat, GitStatusSummary,
};

#[cfg(test)]
use file_preview::{
    bytes_to_frontend_revision, is_image_path, is_removed_status, is_video_path,
    read_contained_worktree_file, video_mime_type, MAX_INLINE_VIDEO_PREVIEW_SIZE,
};

#[cfg(test)]
mod tests;
