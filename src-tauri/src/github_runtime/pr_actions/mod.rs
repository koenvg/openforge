mod execution;
mod linking;
mod validation;

use crate::db;
use std::sync::{Arc, Mutex};

pub use execution::{enqueue_task_pull_request, merge_task_pull_request};
pub use linking::link_pull_request;

pub fn get_pull_requests(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {e}"))
}

pub fn get_pull_requests_for_task(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_pull_requests_for_task(task_id)
        .map_err(|e| format!("Failed to get pull requests for task: {e}"))
}

pub fn get_pr_comments(
    db: &Arc<Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {e}"))
}

fn current_unix_timestamp() -> Result<i64, String> {
    crate::unix_timestamp::seconds(std::time::SystemTime::now())
        .map_err(|error| format!("failed to read current time: {error}"))
}
