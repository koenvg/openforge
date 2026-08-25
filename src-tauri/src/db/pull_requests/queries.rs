use rusqlite::Result;
use std::collections::HashSet;

use super::super::Database;
use super::rows::{read_pr_row, PrCommentRow, PrRow};

impl Database {
    /// Get all open pull requests from the database
    pub fn get_open_prs(&self) -> Result<Vec<PrRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, mergeable, mergeable_state, merged_at, created_at, updated_at, draft, is_queued,
                    merge_readiness_status, merge_readiness_action, merge_readiness_blockers, merge_readiness_warnings, readiness_source_head_sha, merge_group_sha, required_checks_policy_known, required_reviews_policy_known, merge_queue_required, merge_queue_state, readiness_updated_at, github_node_id,
                    merge_methods_policy_known, allowed_merge_methods, default_merge_method,
                    (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pull_requests.id AND addressed = 0) as unaddressed_comment_count
             FROM pull_requests
             WHERE state = 'open'
             ORDER BY updated_at DESC"
        )?;

        let prs = stmt.query_map([], read_pr_row)?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    fn query_pull_requests(&self, task_id: Option<&str>) -> Result<Vec<PrRow>> {
        let conn = self.lock_conn()?;
        let task_filter = if task_id.is_some() {
            " WHERE ticket_id = ?1"
        } else {
            ""
        };
        let sql = format!(
            "SELECT id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, mergeable, mergeable_state, merged_at, created_at, updated_at, draft, is_queued,
                    merge_readiness_status, merge_readiness_action, merge_readiness_blockers, merge_readiness_warnings, readiness_source_head_sha, merge_group_sha, required_checks_policy_known, required_reviews_policy_known, merge_queue_required, merge_queue_state, readiness_updated_at, github_node_id,
                    merge_methods_policy_known, allowed_merge_methods, default_merge_method,
                    (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pull_requests.id AND addressed = 0) as unaddressed_comment_count
             FROM pull_requests{task_filter}
             ORDER BY updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let prs = stmt.query_map(rusqlite::params_from_iter(task_id), read_pr_row)?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    pub fn get_all_pull_requests(&self) -> Result<Vec<PrRow>> {
        self.query_pull_requests(None)
    }

    pub fn get_pull_requests_for_task(&self, task_id: &str) -> Result<Vec<PrRow>> {
        self.query_pull_requests(Some(task_id))
    }

    /// Get CI status for a pull request
    pub fn get_pr_ci_status(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT ci_status FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Get review status for a pull request
    pub fn get_pr_review_status(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT review_status FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn get_task_id_for_pr(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT ticket_id FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Get existing comment IDs for a PR as a HashSet for efficient batch lookups
    pub fn get_existing_comment_ids(&self, pr_id: i64) -> Result<HashSet<i64>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT id FROM pr_comments WHERE pr_id = ?1")?;
        let ids = stmt.query_map([pr_id], |row| row.get(0))?;
        let mut result = HashSet::new();
        for id in ids {
            result.insert(id?);
        }
        Ok(result)
    }

    /// Get the last polled timestamp for a PR, or None if PR doesn't exist
    pub fn get_pr_last_polled(&self, pr_id: i64) -> Result<Option<i64>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT last_polled_at FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Get all comments for a specific PR
    pub fn get_comments_for_pr(&self, pr_id: i64) -> Result<Vec<PrCommentRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, outdated, created_at
             FROM pr_comments
             WHERE pr_id = ?1
             ORDER BY created_at ASC"
        )?;

        let comments = stmt.query_map([pr_id], |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                outdated: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    pub fn get_pr_comments_by_ids(&self, ids: &[i64]) -> Result<Vec<PrCommentRow>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock_conn()?;
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, outdated, created_at FROM pr_comments WHERE id IN ({}) ORDER BY created_at ASC",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let comments = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                outdated: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;
        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }
}
