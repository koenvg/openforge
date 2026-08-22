use rusqlite::Result;

use super::super::Database;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrMergeReadinessFacts {
    pub status: Option<String>,
    pub action: Option<String>,
    pub blockers_json: Option<String>,
    pub warnings_json: Option<String>,
    pub source_head_sha: Option<String>,
    pub merge_group_sha: Option<String>,
    pub required_checks_policy_known: Option<bool>,
    pub required_reviews_policy_known: Option<bool>,
    pub merge_queue_required: Option<bool>,
    pub merge_queue_state: Option<String>,
    pub updated_at: i64,
}

impl PrMergeReadinessFacts {
    pub fn merge_readiness_warnings_or_default(&self) -> String {
        self.warnings_json.clone().unwrap_or_default()
    }
}

pub(in crate::db) fn terminal_readiness_blockers_json(code: &str, message: &str) -> String {
    serde_json::json!([{ "code": code, "message": message }]).to_string()
}

impl Database {
    pub fn update_pr_merge_readiness(
        &self,
        pr_id: i64,
        facts: &PrMergeReadinessFacts,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE pull_requests SET
                merge_readiness_status = ?1,
                merge_readiness_action = ?2,
                merge_readiness_blockers = ?3,
                merge_readiness_warnings = ?4,
                readiness_source_head_sha = ?5,
                merge_group_sha = ?6,
                required_checks_policy_known = ?7,
                required_reviews_policy_known = ?8,
                merge_queue_required = ?9,
                merge_queue_state = ?10,
                readiness_updated_at = ?11
             WHERE id = ?12",
            rusqlite::params![
                facts.status,
                facts.action,
                facts.blockers_json,
                facts.warnings_json,
                facts.source_head_sha,
                facts.merge_group_sha,
                facts.required_checks_policy_known,
                facts.required_reviews_policy_known,
                facts.merge_queue_required,
                facts.merge_queue_state,
                facts.updated_at,
                pr_id,
            ],
        )?;
        Ok(())
    }
}
