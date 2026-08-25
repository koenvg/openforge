use rusqlite::Result;

use super::super::pull_request_readiness::terminal_readiness_blockers_json;
use super::super::{current_unix_timestamp, Database};

impl Database {
    /// Insert a PR comment into the database
    #[allow(clippy::too_many_arguments)]
    pub fn insert_pr_comment(
        &self,
        id: i64,
        pr_id: i64,
        author: &str,
        body: &str,
        comment_type: &str,
        file_path: Option<&str>,
        line_number: Option<i32>,
        addressed: bool,
        created_at: i64,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO pr_comments (id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id,
                pr_id,
                author,
                body,
                comment_type,
                file_path,
                line_number,
                if addressed { 1 } else { 0 },
                created_at,
            ],
        )?;
        Ok(())
    }

    /// Insert or update a pull request in the database.
    /// Legacy callers use the repository-local PR number as the row id.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_pull_request(
        &self,
        id: i64,
        ticket_id: &str,
        repo_owner: &str,
        repo_name: &str,
        title: &str,
        url: &str,
        state: &str,
        created_at: i64,
        updated_at: i64,
        draft: bool,
    ) -> Result<()> {
        self.insert_pull_request_with_number(
            id, id, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at,
            draft,
        )
    }

    /// Insert or update a pull request in the database.
    /// GitHub issue ids are globally unique; PR numbers are only unique within a repository.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_pull_request_with_number(
        &self,
        id: i64,
        pr_number: i64,
        ticket_id: &str,
        repo_owner: &str,
        repo_name: &str,
        title: &str,
        url: &str,
        state: &str,
        created_at: i64,
        updated_at: i64,
        draft: bool,
    ) -> Result<()> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO pull_requests (id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at, draft)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               pr_number=excluded.pr_number,
               ticket_id=excluded.ticket_id,
               repo_owner=excluded.repo_owner,
               repo_name=excluded.repo_name,
               title=excluded.title,
               url=excluded.url,
               state=CASE
                 WHEN pull_requests.state = 'merged' AND excluded.state IN ('open', 'closed') THEN pull_requests.state
                 WHEN pull_requests.state = 'closed' AND excluded.state = 'open' THEN pull_requests.state
                 ELSE excluded.state
               END,
               merged_at=CASE
                 WHEN pull_requests.state = 'merged' AND excluded.state IN ('open', 'closed') THEN pull_requests.merged_at
                 WHEN pull_requests.state = 'closed' AND excluded.state = 'open' THEN pull_requests.merged_at
                 ELSE pull_requests.merged_at
               END,
               updated_at=excluded.updated_at,
               draft=excluded.draft",
            rusqlite::params![
                id,
                pr_number,
                ticket_id,
                repo_owner,
                repo_name,
                title,
                url,
                state,
                created_at,
                updated_at,
                draft,
            ],
        )?;
        tx.execute(
            "UPDATE pr_comments
             SET pr_id = ?1
             WHERE pr_id IN (
               SELECT id FROM pull_requests
               WHERE repo_owner = ?2 AND repo_name = ?3 AND pr_number = ?4 AND id <> ?1
             )",
            rusqlite::params![id, repo_owner, repo_name, pr_number],
        )?;
        tx.execute(
            "DELETE FROM pull_requests
             WHERE repo_owner = ?1 AND repo_name = ?2 AND pr_number = ?3 AND id <> ?4",
            rusqlite::params![repo_owner, repo_name, pr_number, id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Update the head SHA for a pull request
    pub fn update_pr_head_sha(&self, pr_id: i64, sha: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET head_sha = ?1 WHERE id = ?2",
            rusqlite::params![sha, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_github_node_id(&self, pr_id: i64, github_node_id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET github_node_id = ?1 WHERE id = ?2",
            rusqlite::params![github_node_id, pr_id],
        )?;
        Ok(())
    }

    /// Update CI status and check runs for a pull request
    pub fn update_pr_ci_status(
        &self,
        pr_id: i64,
        head_sha: &str,
        ci_status: &str,
        ci_check_runs: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET head_sha = ?1, ci_status = ?2, ci_check_runs = ?3 WHERE id = ?4",
            rusqlite::params![head_sha, ci_status, ci_check_runs, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_mergeability(
        &self,
        pr_id: i64,
        mergeable: Option<bool>,
        mergeable_state: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET mergeable = ?1, mergeable_state = ?2 WHERE id = ?3",
            rusqlite::params![mergeable, mergeable_state, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_merge_method_policy(
        &self,
        pr_id: i64,
        policy_known: bool,
        allowed_merge_methods: &str,
        default_merge_method: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET
                merge_methods_policy_known = ?1,
                allowed_merge_methods = ?2,
                default_merge_method = ?3
             WHERE id = ?4",
            rusqlite::params![
                policy_known,
                allowed_merge_methods,
                default_merge_method,
                pr_id
            ],
        )?;
        Ok(())
    }

    pub fn update_pr_review_status(&self, pr_id: i64, review_status: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET review_status = ?1 WHERE id = ?2",
            rusqlite::params![review_status, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_merged(&self, id: i64, merged_at: i64) -> Result<()> {
        self.update_pr_merged_state(id, Some(merged_at))
    }

    pub fn update_pr_merged_state(&self, id: i64, merged_at: Option<i64>) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET
                state = 'merged',
                merged_at = ?1,
                merge_readiness_status = 'blocked',
                merge_readiness_action = 'resolve_blockers',
                merge_readiness_blockers = ?2,
                merge_readiness_warnings = '[]',
                readiness_source_head_sha = COALESCE(readiness_source_head_sha, head_sha),
                readiness_updated_at = ?3
             WHERE id = ?4",
            rusqlite::params![
                merged_at,
                terminal_readiness_blockers_json(
                    "already_merged",
                    "Pull request is already merged."
                ),
                current_unix_timestamp()?,
                id
            ],
        )?;
        Ok(())
    }

    pub fn update_pr_closed(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET
                state = 'closed',
                merged_at = NULL,
                merge_readiness_status = 'blocked',
                merge_readiness_action = 'resolve_blockers',
                merge_readiness_blockers = ?1,
                merge_readiness_warnings = '[]',
                readiness_source_head_sha = COALESCE(readiness_source_head_sha, head_sha),
                readiness_updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![
                terminal_readiness_blockers_json("pull_request_closed", "Pull request is closed."),
                current_unix_timestamp()?,
                id
            ],
        )?;
        Ok(())
    }

    pub fn update_pr_is_queued(&self, pr_id: i64, is_queued: bool) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET is_queued = ?1 WHERE id = ?2",
            rusqlite::params![is_queued as i32, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_queued(&self, pr_id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET
                is_queued = 1,
                merge_readiness_status = 'queued_pull_request',
                merge_readiness_action = 'wait_for_queue',
                merge_readiness_blockers = '[]',
                merge_readiness_warnings = '[]',
                readiness_source_head_sha = COALESCE(readiness_source_head_sha, head_sha),
                merge_queue_state = 'QUEUED',
                readiness_updated_at = ?1
             WHERE id = ?2",
            rusqlite::params![current_unix_timestamp()?, pr_id],
        )?;
        Ok(())
    }

    /// Set the last polled timestamp for a PR
    pub fn set_pr_last_polled(&self, pr_id: i64, timestamp: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET last_polled_at = ?1 WHERE id = ?2",
            rusqlite::params![timestamp, pr_id],
        )?;
        Ok(())
    }

    pub fn mark_comment_addressed(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("UPDATE pr_comments SET addressed = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Refresh a comment's `outdated` flag without touching its local
    /// `addressed` state. Used by the poller when re-reading comments from
    /// GitHub, so an addressed comment stays addressed even as it goes outdated.
    pub fn update_comment_outdated(&self, id: i64, outdated: bool) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pr_comments SET outdated = ?2 WHERE id = ?1",
            rusqlite::params![id, if outdated { 1 } else { 0 }],
        )?;
        Ok(())
    }

    pub fn mark_comments_addressed(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.lock_conn()?;
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "UPDATE pr_comments SET addressed = 1 WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        stmt.execute(param_refs.as_slice())?;
        Ok(())
    }
}
