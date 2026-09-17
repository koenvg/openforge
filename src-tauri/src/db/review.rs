use crate::github_client::{PrLabel, PullRequestTerminalState};
use rusqlite::Result;
use serde::Serialize;

/// Review PR row from database (cross-repo, not task-linked)
#[derive(Debug, Clone, Serialize)]
pub struct ReviewPrRow {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub ci_status: Option<String>,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub merged_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub viewed_head_sha: Option<String>,
    /// The signed-in user's own standing verdict on this PR ("approved" or
    /// "changes_requested"), or None when they hold none. Drives the "you
    /// reviewed this" chip on the review list card.
    pub viewer_review_state: Option<String>,
    /// GitHub labels on the PR. Serialized to the frontend as an array; empty
    /// when the PR has no labels. Persisted as a nullable JSON-TEXT column.
    pub labels: Vec<PrLabel>,
}

#[derive(Debug, Clone)]
pub struct ReviewPrUpsert {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub ci_status: Option<String>,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub merged_at: Option<i64>,
    /// The signed-in user's own standing verdict ("approved" /
    /// "changes_requested" / None). Recomputed each sync from the PR's reviews;
    /// written straight through so a dismissal clears a stale verdict.
    pub viewer_review_state: Option<String>,
    pub labels: Vec<PrLabel>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewPrReconcileCandidate {
    pub(crate) id: i64,
    pub(crate) number: i64,
    pub(crate) repo_owner: String,
    pub(crate) repo_name: String,
}

impl super::Database {
    pub fn upsert_review_pr(&self, row: &ReviewPrUpsert) -> Result<()> {
        let labels_json = super::serialize_json_list_column(&row.labels);
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO review_prs (id, number, title, body, state, draft, html_url, user_login, user_avatar_url, repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files, ci_status, mergeable, mergeable_state, merged_at, viewer_review_state, labels, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
             ON CONFLICT(id) DO UPDATE SET
                 number = excluded.number,
                 title = excluded.title,
                 body = excluded.body,
                 state = excluded.state,
                 draft = excluded.draft,
                 html_url = excluded.html_url,
                 user_login = excluded.user_login,
                 user_avatar_url = excluded.user_avatar_url,
                 repo_owner = excluded.repo_owner,
                 repo_name = excluded.repo_name,
                 head_ref = excluded.head_ref,
                 base_ref = excluded.base_ref,
                  head_sha = excluded.head_sha,
                  additions = excluded.additions,
                  deletions = excluded.deletions,
                  changed_files = excluded.changed_files,
                  ci_status = COALESCE(excluded.ci_status, review_prs.ci_status),
                  mergeable = excluded.mergeable,
                  mergeable_state = excluded.mergeable_state,
                  merged_at = excluded.merged_at,
                  viewer_review_state = excluded.viewer_review_state,
                  labels = excluded.labels,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at,
                  viewed_at = CASE WHEN review_prs.review_requested = 0 OR (review_prs.viewed_head_sha IS NOT NULL AND review_prs.viewed_head_sha != excluded.head_sha) THEN NULL ELSE review_prs.viewed_at END,
                  viewed_head_sha = CASE WHEN review_prs.review_requested = 0 OR (review_prs.viewed_head_sha IS NOT NULL AND review_prs.viewed_head_sha != excluded.head_sha) THEN NULL ELSE review_prs.viewed_head_sha END,
                  dismissed_at = CASE WHEN review_prs.review_requested = 0 OR (review_prs.dismissed_head_sha IS NOT NULL AND review_prs.dismissed_head_sha != excluded.head_sha) THEN NULL ELSE review_prs.dismissed_at END,
                  dismissed_head_sha = CASE WHEN review_prs.review_requested = 0 OR (review_prs.dismissed_head_sha IS NOT NULL AND review_prs.dismissed_head_sha != excluded.head_sha) THEN NULL ELSE review_prs.dismissed_head_sha END,
                  review_requested = 1",
            rusqlite::params![
                row.id,
                row.number,
                row.title,
                row.body,
                row.state,
                row.draft as i32,
                row.html_url,
                row.user_login,
                row.user_avatar_url,
                row.repo_owner,
                row.repo_name,
                row.head_ref,
                row.base_ref,
                row.head_sha,
                row.additions,
                row.deletions,
                row.changed_files,
                row.ci_status,
                row.mergeable,
                row.mergeable_state,
                row.merged_at,
                row.viewer_review_state,
                labels_json,
                row.created_at,
                row.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_review_prs(&self) -> Result<Vec<ReviewPrRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, number, title, body, state, draft, html_url, user_login, user_avatar_url,
                    repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions,
                    changed_files, ci_status, mergeable, mergeable_state, merged_at, created_at, updated_at, viewed_at, viewed_head_sha, viewer_review_state, labels
             FROM review_prs
             WHERE dismissed_at IS NULL
             ORDER BY CASE WHEN viewed_at IS NULL THEN 0 ELSE 1 END, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ReviewPrRow {
                id: row.get(0)?,
                number: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                state: row.get(4)?,
                draft: row.get::<_, i32>(5)? != 0,
                html_url: row.get(6)?,
                user_login: row.get(7)?,
                user_avatar_url: row.get(8)?,
                repo_owner: row.get(9)?,
                repo_name: row.get(10)?,
                head_ref: row.get(11)?,
                base_ref: row.get(12)?,
                head_sha: row.get(13)?,
                additions: row.get(14)?,
                deletions: row.get(15)?,
                changed_files: row.get(16)?,
                ci_status: row.get(17)?,
                mergeable: row.get(18)?,
                mergeable_state: row.get(19)?,
                merged_at: row.get(20)?,
                created_at: row.get(21)?,
                updated_at: row.get(22)?,
                viewed_at: row.get(23)?,
                viewed_head_sha: row.get(24)?,
                viewer_review_state: row.get(25)?,
                labels: super::parse_labels_column(row.get(26)?),
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Mark a review PR as viewed with the given head SHA.
    /// Sets `viewed_at` to the current Unix timestamp and `viewed_head_sha` to the provided sha.
    pub fn mark_review_pr_viewed(&self, pr_id: i64, head_sha: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE review_prs SET viewed_at = ?1, viewed_head_sha = ?2 WHERE id = ?3",
            rusqlite::params![now, head_sha, pr_id],
        )?;
        Ok(())
    }

    /// Mark a review PR as unread again.
    /// Clears `viewed_at` and `viewed_head_sha` to NULL so the PR re-surfaces as unread
    /// (and re-sorts to the top of the list), mirroring the never-viewed state.
    pub fn mark_review_pr_unviewed(&self, pr_id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE review_prs SET viewed_at = NULL, viewed_head_sha = NULL WHERE id = ?1",
            rusqlite::params![pr_id],
        )?;
        Ok(())
    }

    /// Remove a review PR from the list (manual "Remove from list" action).
    /// Soft delete: sets `dismissed_at` and pins `dismissed_head_sha` to the PR's
    /// current head. The row stays so a later sync can re-surface it when a new
    /// commit lands (head SHA differs) or the user is (re-)requested as a reviewer;
    /// see the transition logic in `upsert_review_pr`. Preserved across syncs the
    /// same way `viewed_at` is, so a still-requested PR does not reappear next poll.
    pub fn dismiss_review_pr(&self, pr_id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE review_prs SET dismissed_at = ?1, dismissed_head_sha = head_sha WHERE id = ?2",
            rusqlite::params![now, pr_id],
        )?;
        Ok(())
    }

    /// Mark every review PR that is no longer in GitHub's review-requested search as
    /// not currently requested, without deleting it. Replaces the old prune step:
    /// the list is sticky, so rows that leave the search are kept (they only leave
    /// the list via a manual removal). The `review_requested` flag lets the next
    /// `upsert_review_pr` detect a not-requested -> requested transition and
    /// re-surface a removed PR. `current_ids` are the PR ids in the latest search.
    pub fn mark_review_prs_not_requested(&self, current_ids: &[i64]) -> Result<()> {
        let conn = self.lock_conn()?;
        if current_ids.is_empty() {
            conn.execute("UPDATE review_prs SET review_requested = 0", [])?;
        } else {
            let placeholders: Vec<String> = current_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "UPDATE review_prs SET review_requested = 0 WHERE id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<Box<dyn rusqlite::types::ToSql>> = current_ids
                .iter()
                .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            stmt.execute(param_refs.as_slice())?;
        }
        Ok(())
    }

    pub(crate) fn get_review_pr_reconcile_candidates(
        &self,
    ) -> Result<Vec<ReviewPrReconcileCandidate>> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(
            "SELECT id, number, repo_owner, repo_name
             FROM review_prs
             WHERE review_requested = 0 AND state = 'open' AND dismissed_at IS NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ReviewPrReconcileCandidate {
                id: row.get(0)?,
                number: row.get(1)?,
                repo_owner: row.get(2)?,
                repo_name: row.get(3)?,
            })
        })?;

        rows.collect()
    }

    pub(crate) fn update_review_pr_terminal_state(
        &self,
        pr_id: i64,
        terminal_state: PullRequestTerminalState,
    ) -> Result<bool> {
        let (state, merged_at) = match terminal_state {
            PullRequestTerminalState::Closed => ("closed", None),
            PullRequestTerminalState::Merged(merged_at) => ("merged", merged_at),
        };
        let conn = self.lock_conn()?;
        let updated = conn.execute(
            "UPDATE review_prs
             SET state = ?1, merged_at = ?2
             WHERE id = ?3 AND review_requested = 0 AND state = 'open' AND dismissed_at IS NULL",
            rusqlite::params![state, merged_at, pr_id],
        )?;
        Ok(updated > 0)
    }

    /// Test-only raw read of the sticky-list bookkeeping columns for a single PR,
    /// including dismissed rows (which `get_all_review_prs` hides). Returns
    /// `(dismissed, dismissed_head_sha, review_requested)`.
    #[cfg(test)]
    pub fn review_pr_dismissal_state(
        &self,
        pr_id: i64,
    ) -> Result<Option<(bool, Option<String>, bool)>> {
        use rusqlite::OptionalExtension;
        let conn = self.lock_conn()?;
        conn.query_row(
            "SELECT dismissed_at, dismissed_head_sha, review_requested FROM review_prs WHERE id = ?1",
            rusqlite::params![pr_id],
            |row| {
                let dismissed_at: Option<i64> = row.get(0)?;
                let dismissed_head_sha: Option<String> = row.get(1)?;
                let review_requested: i32 = row.get(2)?;
                Ok((dismissed_at.is_some(), dismissed_head_sha, review_requested != 0))
            },
        )
        .optional()
    }
}

#[cfg(test)]
mod tests {
    use super::ReviewPrUpsert;
    use crate::db::test_helpers::*;
    use crate::github_client::PullRequestTerminalState;

    fn review_pr_row(id: i64, number: i64, head_sha: &str, updated_at: i64) -> ReviewPrUpsert {
        ReviewPrUpsert {
            id,
            number,
            title: format!("PR {id}"),
            body: None,
            state: "open".to_string(),
            draft: false,
            html_url: format!("https://github.com/owner/repo/pull/{number}"),
            user_login: "user".to_string(),
            user_avatar_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            head_ref: format!("branch{id}"),
            base_ref: "main".to_string(),
            head_sha: head_sha.to_string(),
            additions: 10,
            deletions: 5,
            changed_files: 2,
            ci_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            viewer_review_state: None,
            labels: vec![],
            created_at: 1000,
            updated_at,
        }
    }

    #[test]
    fn test_review_pr_upsert_and_retrieve() {
        let (db, _temp_dir) = make_test_db("review_pr_upsert");

        let row = ReviewPrUpsert {
            title: "Add new feature".to_string(),
            body: Some("This PR adds a new feature".to_string()),
            user_login: "octocat".to_string(),
            user_avatar_url: Some("https://avatars.githubusercontent.com/u/1?v=4".to_string()),
            head_ref: "feature-branch".to_string(),
            additions: 100,
            deletions: 50,
            changed_files: 10,
            ..review_pr_row(123, 456, "abc123def", 2000)
        };
        db.upsert_review_pr(&row).expect("upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].id, 123);
        assert_eq!(prs[0].number, 456);
        assert_eq!(prs[0].title, "Add new feature");
        assert_eq!(prs[0].body, Some("This PR adds a new feature".to_string()));
        assert_eq!(prs[0].state, "open");
        assert!(!prs[0].draft);
        assert_eq!(prs[0].html_url, "https://github.com/owner/repo/pull/456");
        assert_eq!(prs[0].user_login, "octocat");
        assert_eq!(
            prs[0].user_avatar_url,
            Some("https://avatars.githubusercontent.com/u/1?v=4".to_string())
        );
        assert_eq!(prs[0].repo_owner, "owner");
        assert_eq!(prs[0].repo_name, "repo");
        assert_eq!(prs[0].head_ref, "feature-branch");
        assert_eq!(prs[0].base_ref, "main");
        assert_eq!(prs[0].head_sha, "abc123def");
        assert_eq!(prs[0].additions, 100);
        assert_eq!(prs[0].deletions, 50);
        assert_eq!(prs[0].changed_files, 10);
        assert_eq!(prs[0].created_at, 1000);
        assert_eq!(prs[0].updated_at, 2000);

        let updated_row = ReviewPrUpsert {
            title: "Add new feature - updated".to_string(),
            body: Some("This PR adds a new feature".to_string()),
            user_login: "octocat".to_string(),
            user_avatar_url: Some("https://avatars.githubusercontent.com/u/1?v=4".to_string()),
            head_ref: "feature-branch".to_string(),
            additions: 100,
            deletions: 50,
            changed_files: 10,
            ..review_pr_row(123, 456, "abc123def", 3000)
        };
        db.upsert_review_pr(&updated_row)
            .expect("upsert update failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].title, "Add new feature - updated");
        assert_eq!(prs[0].updated_at, 3000);

        drop(db);
    }

    #[test]
    fn test_review_pr_labels_round_trip_and_clear() {
        use crate::github_client::PrLabel;

        let (db, _temp_dir) = make_test_db("review_pr_labels");

        let labels = vec![
            PrLabel {
                name: "DO NOT REVIEW".to_string(),
                color: "b60205".to_string(),
            },
            PrLabel {
                name: "bug".to_string(),
                color: "d73a4a".to_string(),
            },
        ];

        let upsert = |labels: &[PrLabel], updated_at: i64| {
            let row = ReviewPrUpsert {
                title: "Labeled PR".to_string(),
                user_login: "octocat".to_string(),
                head_ref: "feature-branch".to_string(),
                additions: 100,
                deletions: 50,
                changed_files: 10,
                labels: labels.to_vec(),
                ..review_pr_row(123, 456, "abc123def", updated_at)
            };
            db.upsert_review_pr(&row).expect("upsert failed");
        };

        // Non-empty labels persist and round-trip with name + color preserved.
        upsert(&labels, 2000);
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].labels, labels);

        // Re-upserting with no labels clears them (column stored as NULL).
        upsert(&[], 3000);
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].labels.is_empty());

        drop(db);
    }

    #[test]
    fn test_review_pr_viewer_review_state_round_trip() {
        let (db, _temp_dir) = make_test_db("review_pr_viewer_review_state");

        db.upsert_review_pr(&ReviewPrUpsert {
            viewer_review_state: Some("approved".to_string()),
            ..review_pr_row(1, 10, "sha1", 1000)
        })
        .expect("persist viewer verdict");
        let prs = db.get_all_review_prs().expect("read review PRs");
        assert_eq!(prs[0].viewer_review_state.as_deref(), Some("approved"));

        // A later sync where the viewer holds no verdict clears a stale one
        // (e.g. their review was dismissed). Written straight through, not COALESCEd.
        db.upsert_review_pr(&ReviewPrUpsert {
            viewer_review_state: None,
            ..review_pr_row(1, 10, "sha1", 2000)
        })
        .expect("clear viewer verdict");
        let prs = db.get_all_review_prs().expect("read review PRs again");
        assert!(prs[0].viewer_review_state.is_none());

        drop(db);
    }

    /// Minimal review-PR upsert for the sticky-list tests: only id, head SHA, and
    /// updated_at vary; everything else is boilerplate the assertions don't touch.
    fn upsert_review_pr_with_head(
        db: &crate::db::Database,
        id: i64,
        head_sha: &str,
        updated_at: i64,
    ) {
        db.upsert_review_pr(&ReviewPrUpsert {
            title: "PR".to_string(),
            head_ref: "branch".to_string(),
            ..review_pr_row(id, id, head_sha, updated_at)
        })
        .expect("upsert failed");
    }

    #[test]
    fn test_mark_not_requested_keeps_rows_and_flags() {
        let (db, _temp_dir) = make_test_db("review_pr_not_requested");
        upsert_review_pr_with_head(&db, 100, "sha1", 1000);
        upsert_review_pr_with_head(&db, 200, "sha2", 2000);
        upsert_review_pr_with_head(&db, 300, "sha3", 3000);

        // PR 200 dropped out of the review-requested search. The sticky list keeps
        // it; it is only flagged as no longer requested.
        db.mark_review_prs_not_requested(&[100, 300])
            .expect("mark not requested failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 3, "sticky list never drops rows");
        assert!(!db.review_pr_dismissal_state(200).unwrap().unwrap().2);
        assert!(db.review_pr_dismissal_state(100).unwrap().unwrap().2);

        // An empty search means nothing is currently requested; still no deletions.
        db.mark_review_prs_not_requested(&[])
            .expect("mark all not requested failed");
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 3);
        for id in [100, 200, 300] {
            assert!(!db.review_pr_dismissal_state(id).unwrap().unwrap().2);
        }

        drop(db);
    }

    #[test]
    fn test_dismiss_hides_pr_from_list() {
        let (db, _temp_dir) = make_test_db("review_pr_dismiss");
        upsert_review_pr_with_head(&db, 1, "abc", 1000);

        db.dismiss_review_pr(1).expect("dismiss failed");

        assert!(
            db.get_all_review_prs().unwrap().is_empty(),
            "a removed PR is hidden from the list"
        );
        let (dismissed, head, requested) = db.review_pr_dismissal_state(1).unwrap().unwrap();
        assert!(dismissed);
        assert_eq!(head, Some("abc".to_string()));
        assert!(requested, "removal does not change the requested flag");

        drop(db);
    }

    #[test]
    fn test_dismissed_pr_stays_hidden_when_still_requested() {
        let (db, _temp_dir) = make_test_db("review_pr_dismiss_sticky");
        upsert_review_pr_with_head(&db, 1, "abc", 1000);
        db.dismiss_review_pr(1).expect("dismiss failed");

        // Next poll finds the same PR still requested at the same head. It must not
        // reappear just because the poller re-upserts it.
        upsert_review_pr_with_head(&db, 1, "abc", 2000);

        assert!(
            db.get_all_review_prs().unwrap().is_empty(),
            "stays removed while merely still requested"
        );
        assert!(db.review_pr_dismissal_state(1).unwrap().unwrap().0);

        drop(db);
    }

    #[test]
    fn test_dismissed_pr_resurfaces_on_new_commit() {
        let (db, _temp_dir) = make_test_db("review_pr_resurface_commit");
        upsert_review_pr_with_head(&db, 1, "abc", 1000);
        db.dismiss_review_pr(1).expect("dismiss failed");

        // A new commit lands while still requested: the head SHA differs from the
        // one pinned at removal.
        upsert_review_pr_with_head(&db, 1, "def", 2000);

        assert_eq!(
            db.get_all_review_prs().unwrap().len(),
            1,
            "a new commit brings a removed PR back"
        );
        assert!(!db.review_pr_dismissal_state(1).unwrap().unwrap().0);

        drop(db);
    }

    #[test]
    fn test_dismissed_pr_resurfaces_on_rerequest() {
        let (db, _temp_dir) = make_test_db("review_pr_resurface_rerequest");
        upsert_review_pr_with_head(&db, 1, "abc", 1000);
        db.dismiss_review_pr(1).expect("dismiss failed");

        // The user leaves the reviewers (a poll without this id), then is
        // re-requested (a later poll with it again), all at the same head.
        db.mark_review_prs_not_requested(&[])
            .expect("mark not requested failed");
        assert!(
            db.get_all_review_prs().unwrap().is_empty(),
            "still hidden while merely un-requested"
        );
        upsert_review_pr_with_head(&db, 1, "abc", 2000);

        assert_eq!(
            db.get_all_review_prs().unwrap().len(),
            1,
            "a fresh review request brings a removed PR back"
        );
        let (dismissed, _head, requested) = db.review_pr_dismissal_state(1).unwrap().unwrap();
        assert!(!dismissed);
        assert!(requested);

        drop(db);
    }

    #[test]
    fn test_rerequest_marks_pr_unread() {
        let (db, _temp_dir) = make_test_db("review_pr_rerequest_unread");
        upsert_review_pr_with_head(&db, 1, "abc", 1000);
        db.mark_review_pr_viewed(1, "abc")
            .expect("mark viewed failed");

        // Un-request, then re-request at the same head. A re-request should pull the
        // PR back to the top as unread, not leave it sorted last as already-seen.
        db.mark_review_prs_not_requested(&[])
            .expect("mark not requested failed");
        upsert_review_pr_with_head(&db, 1, "abc", 2000);

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(
            prs[0].viewed_at.is_none(),
            "a re-requested PR resurfaces as unread"
        );

        drop(db);
    }

    #[test]
    fn test_review_pr_ordering() {
        let (db, _temp_dir) = make_test_db("review_pr_ordering");

        db.upsert_review_pr(&ReviewPrUpsert {
            title: "Older PR".to_string(),
            user_login: "user1".to_string(),
            ..review_pr_row(1, 10, "sha1", 1000)
        })
        .expect("insert older failed");
        db.upsert_review_pr(&ReviewPrUpsert {
            title: "Newer PR".to_string(),
            user_login: "user2".to_string(),
            additions: 20,
            deletions: 10,
            changed_files: 3,
            created_at: 2000,
            ..review_pr_row(2, 20, "sha2", 5000)
        })
        .expect("insert newer failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].id, 2);
        assert_eq!(prs[1].id, 1);

        drop(db);
    }

    #[test]
    fn test_upsert_preserves_known_ci_status_when_enrichment_has_no_state() {
        let (db, _temp_dir) = make_test_db("review_pr_ci_status_preserved");

        db.upsert_review_pr(&ReviewPrUpsert {
            ci_status: Some("success".to_string()),
            ..review_pr_row(1, 10, "sha1", 1000)
        })
        .expect("persist known CI status");
        db.upsert_review_pr(&ReviewPrUpsert {
            ci_status: None,
            ..review_pr_row(1, 10, "sha1", 2000)
        })
        .expect("upsert without a fetched CI status");

        let prs = db.get_all_review_prs().expect("read review PRs");
        assert_eq!(prs[0].ci_status.as_deref(), Some("success"));

        db.upsert_review_pr(&ReviewPrUpsert {
            ci_status: Some("failure".to_string()),
            ..review_pr_row(1, 10, "sha2", 3000)
        })
        .expect("replace known CI status");
        let prs = db.get_all_review_prs().expect("read updated review PRs");
        assert_eq!(prs[0].ci_status.as_deref(), Some("failure"));

        drop(db);
    }

    #[test]
    fn test_reconcile_candidates_and_terminal_updates_are_self_limiting() {
        let (db, _temp_dir) = make_test_db("review_pr_reconcile_candidates");
        for id in 1..=4 {
            db.upsert_review_pr(&review_pr_row(id, id, &format!("sha{id}"), id))
                .expect("insert review PR");
        }
        db.mark_review_prs_not_requested(&[])
            .expect("mark rows as kept");

        db.upsert_review_pr(&review_pr_row(2, 2, "sha2", 20))
            .expect("re-request PR 2");
        assert!(db
            .update_review_pr_terminal_state(3, PullRequestTerminalState::Closed)
            .expect("close PR 3"));
        db.dismiss_review_pr(4).expect("dismiss PR 4");

        let candidates = db
            .get_review_pr_reconcile_candidates()
            .expect("read reconcile candidates");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, 1);

        assert!(db
            .update_review_pr_terminal_state(
                1,
                PullRequestTerminalState::Merged(Some(1_700_000_000)),
            )
            .expect("merge kept PR 1"));
        assert!(!db
            .update_review_pr_terminal_state(2, PullRequestTerminalState::Closed)
            .expect("ignore concurrently re-requested PR 2"));

        let rows = db.get_all_review_prs().expect("read review PRs");
        let merged = rows.iter().find(|row| row.id == 1).expect("merged row");
        assert_eq!(merged.state, "merged");
        assert_eq!(merged.merged_at, Some(1_700_000_000));
        let closed = rows.iter().find(|row| row.id == 3).expect("closed row");
        assert_eq!(closed.state, "closed");
        assert_eq!(closed.merged_at, None);
        assert!(db
            .get_review_pr_reconcile_candidates()
            .expect("read candidates after terminal updates")
            .is_empty());

        drop(db);
    }

    #[test]
    fn test_review_pr_viewed_null_by_default() {
        let (db, _temp_dir) = make_test_db("review_pr_viewed_null");

        db.upsert_review_pr(&review_pr_row(1, 10, "sha1", 2000))
            .expect("upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
    }

    #[test]
    fn test_mark_review_pr_viewed() {
        let (db, _temp_dir) = make_test_db("review_pr_mark_viewed");

        db.upsert_review_pr(&review_pr_row(1, 10, "sha1", 2000))
            .expect("upsert failed");

        db.mark_review_pr_viewed(1, "sha1")
            .expect("mark viewed failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_some());
        assert_eq!(prs[0].viewed_head_sha, Some("sha1".to_string()));

        drop(db);
    }

    #[test]
    fn test_mark_review_pr_unviewed() {
        let (db, _temp_dir) = make_test_db("review_pr_mark_unviewed");

        db.upsert_review_pr(&review_pr_row(1, 10, "sha1", 2000))
            .expect("upsert failed");

        // Mark it viewed first so we can prove unviewed clears the state.
        db.mark_review_pr_viewed(1, "sha1")
            .expect("mark viewed failed");

        db.mark_review_pr_unviewed(1).expect("mark unviewed failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
    }

    #[test]
    fn test_upsert_preserves_viewed_when_sha_unchanged() {
        let (db, _temp_dir) = make_test_db("review_pr_preserve_viewed");

        db.upsert_review_pr(&review_pr_row(1, 10, "abc", 2000))
            .expect("upsert failed");

        db.mark_review_pr_viewed(1, "abc")
            .expect("mark viewed failed");

        let prs_before = db.get_all_review_prs().expect("get_all failed");
        let viewed_at_before = prs_before[0].viewed_at;

        // Upsert again with same sha
        db.upsert_review_pr(&ReviewPrUpsert {
            title: "PR 1 updated".to_string(),
            ..review_pr_row(1, 10, "abc", 3000)
        })
        .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].viewed_at, viewed_at_before);
        assert_eq!(prs[0].viewed_head_sha, Some("abc".to_string()));

        drop(db);
    }

    #[test]
    fn test_upsert_clears_viewed_when_sha_changed() {
        let (db, _temp_dir) = make_test_db("review_pr_clear_viewed");

        db.upsert_review_pr(&review_pr_row(1, 10, "abc", 2000))
            .expect("upsert failed");

        db.mark_review_pr_viewed(1, "abc")
            .expect("mark viewed failed");

        // Upsert again with different sha
        db.upsert_review_pr(&review_pr_row(1, 10, "def", 3000))
            .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
    }

    #[test]
    fn test_upsert_never_viewed_stays_unviewed() {
        let (db, _temp_dir) = make_test_db("review_pr_never_viewed");

        db.upsert_review_pr(&review_pr_row(1, 10, "abc", 2000))
            .expect("upsert failed");

        // Never mark as viewed, upsert with new sha
        db.upsert_review_pr(&review_pr_row(1, 10, "new-sha", 3000))
            .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
    }

    #[test]
    fn test_review_pr_viewed_sorting() {
        let (db, _temp_dir) = make_test_db("review_pr_viewed_sorting");

        // Insert 3 PRs (all unviewed initially)
        for i in 1_i64..=3 {
            db.upsert_review_pr(&ReviewPrUpsert {
                created_at: i * 1000,
                ..review_pr_row(i, i * 10, &format!("sha{i}"), i * 1000)
            })
            .expect("upsert failed");
        }

        // Mark PR 2 as viewed
        db.mark_review_pr_viewed(2, "sha2")
            .expect("mark viewed failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 3);

        // Unviewed PRs should come first
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[1].viewed_at.is_none());
        // Viewed PR should be last
        assert!(prs[2].viewed_at.is_some());
        assert_eq!(prs[2].id, 2);

        drop(db);
    }
}
