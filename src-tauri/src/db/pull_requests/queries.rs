use rusqlite::Result;
use std::collections::HashSet;

#[cfg(test)]
use super::super::sqlite::sqlite_id_list;
use super::super::Database;
use super::rows::{read_pr_comment_row, read_pr_row, PrCommentRow, PrRow};
use super::UNADDRESSED_COMMENT_COUNT_SQL;

pub(super) const PULL_REQUEST_BY_REPOSITORY_NUMBER_CLAUSE: &str =
    "WHERE repo_owner = ?1 AND repo_name = ?2 AND pr_number = ?3
     ORDER BY updated_at DESC LIMIT 1";

pub(super) const PULL_REQUESTS_FOR_TASK_CLAUSE: &str =
    "WHERE ticket_id = ?1 ORDER BY updated_at DESC";

pub(super) fn pull_requests_sql(clause: &str) -> String {
    format!(
        "SELECT id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, mergeable, mergeable_state, merged_at, created_at, updated_at, draft, is_queued,
                merge_readiness_status, merge_readiness_action, merge_readiness_blockers, merge_readiness_warnings, readiness_source_head_sha, merge_group_sha, required_checks_policy_known, required_reviews_policy_known, merge_queue_required, merge_queue_state, readiness_updated_at, github_node_id,
                merge_methods_policy_known, allowed_merge_methods, default_merge_method, reviewers,
                {UNADDRESSED_COMMENT_COUNT_SQL} as unaddressed_comment_count
         FROM pull_requests pr {clause}"
    )
}

impl Database {
    /// Get all open pull requests from the database
    pub fn get_open_prs(&self) -> Result<Vec<PrRow>> {
        let conn = self.lock_conn()?;
        let sql = format!(
            "SELECT id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, mergeable, mergeable_state, merged_at, created_at, updated_at, draft, is_queued,
                    merge_readiness_status, merge_readiness_action, merge_readiness_blockers, merge_readiness_warnings, readiness_source_head_sha, merge_group_sha, required_checks_policy_known, required_reviews_policy_known, merge_queue_required, merge_queue_state, readiness_updated_at, github_node_id,
                    merge_methods_policy_known, allowed_merge_methods, default_merge_method, reviewers,
                    {UNADDRESSED_COMMENT_COUNT_SQL} as unaddressed_comment_count
             FROM pull_requests pr
             WHERE state = 'open'
             ORDER BY updated_at DESC"
        );
        let mut stmt = conn.prepare_cached(&sql)?;

        let prs = stmt.query_map([], read_pr_row)?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    fn query_pull_requests(
        &self,
        clause: &str,
        params: impl rusqlite::Params,
    ) -> Result<Vec<PrRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare_cached(&pull_requests_sql(clause))?;
        let prs = stmt.query_map(params, read_pr_row)?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    pub fn get_all_pull_requests(&self) -> Result<Vec<PrRow>> {
        self.query_pull_requests("ORDER BY updated_at DESC", [])
    }

    pub fn get_pull_requests_for_task(&self, task_id: &str) -> Result<Vec<PrRow>> {
        self.query_pull_requests(PULL_REQUESTS_FOR_TASK_CLAUSE, [task_id])
    }

    pub fn get_pull_request_by_repository_number(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Option<PrRow>> {
        Ok(self
            .query_pull_requests(
                PULL_REQUEST_BY_REPOSITORY_NUMBER_CLAUSE,
                rusqlite::params![owner, repo, number],
            )?
            .into_iter()
            .next())
    }

    pub fn get_pull_request_by_id(&self, id: i64) -> Result<Option<PrRow>> {
        Ok(self
            .query_pull_requests("WHERE id = ?1", [id])?
            .into_iter()
            .next())
    }

    /// Get CI status for a pull request
    pub fn get_pr_ci_status(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare_cached("SELECT ci_status FROM pull_requests WHERE id = ?1")?;
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
        let mut stmt =
            conn.prepare_cached("SELECT review_status FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn get_task_id_for_pr(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare_cached("SELECT ticket_id FROM pull_requests WHERE id = ?1")?;
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
        let mut stmt = conn.prepare_cached("SELECT id FROM pr_comments WHERE pr_id = ?1")?;
        let ids = stmt.query_map([pr_id], |row| row.get(0))?;
        let mut result = HashSet::new();
        for id in ids {
            result.insert(id?);
        }
        Ok(result)
    }

    /// Get the last polled timestamp for a PR, or None if PR doesn't exist
    #[cfg(test)]
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
        let mut stmt = conn.prepare_cached(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, in_reply_to_id, addressed, outdated, created_at
             FROM pr_comments
             WHERE pr_id = ?1
             ORDER BY created_at ASC"
        )?;

        let comments = stmt.query_map([pr_id], read_pr_comment_row)?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    #[cfg(test)]
    pub fn get_pr_comments_by_ids(&self, ids: &[i64]) -> Result<Vec<PrCommentRow>> {
        let Some(id_list) = sqlite_id_list(ids) else {
            return Ok(Vec::new());
        };

        let conn = self.lock_conn()?;
        let sql = format!(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, in_reply_to_id, addressed, outdated, created_at FROM pr_comments WHERE id IN ({}) ORDER BY created_at ASC",
            id_list.placeholders
        );
        let mut stmt = conn.prepare(&sql)?;
        let comments = stmt.query_map(id_list.params.as_slice(), read_pr_comment_row)?;
        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }
}
