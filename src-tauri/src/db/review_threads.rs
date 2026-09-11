use rusqlite::{Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Addresses a set of Review Threads. All three parts are opaque to the host: it
/// stores and compares them and never resolves them against another record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadScope {
    pub namespace: String,
    pub target_key: String,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewThreadAnchor {
    #[serde(rename_all = "camelCase")]
    Line {
        file_path: String,
        line: i64,
        side: String,
    },
    #[serde(rename_all = "camelCase")]
    Custom { key: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadMessageRow {
    pub id: String,
    pub role: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadRow {
    pub id: String,
    pub namespace: String,
    pub target_key: String,
    pub revision: String,
    pub run_id: Option<String>,
    pub origin: String,
    pub anchor: ReviewThreadAnchor,
    pub status: String,
    pub awaiting: String,
    pub idempotency_key: Option<String>,
    pub seen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<ReviewThreadMessageRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewThread {
    #[serde(flatten)]
    pub scope: ReviewThreadScope,
    pub anchor: ReviewThreadAnchor,
    pub origin: String,
    pub body: String,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplyToReviewThread {
    pub thread_id: String,
    pub role: String,
    pub body: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ReviewThreadError {
    #[error("Review Thread field '{field}' {reason}")]
    InvalidField { field: &'static str, reason: String },
    #[error("Review Thread '{0}' does not exist")]
    ThreadNotFound(String),
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
}

type ReviewThreadResult<T> = std::result::Result<T, ReviewThreadError>;

fn invalid(field: &'static str, reason: &str) -> ReviewThreadError {
    ReviewThreadError::InvalidField {
        field,
        reason: reason.to_string(),
    }
}

const ORIGINS: [&str; 3] = ["agent", "human", "plugin"];
const ROLES: [&str; 2] = ["agent", "human"];

fn validate_scope(scope: &ReviewThreadScope) -> ReviewThreadResult<()> {
    if scope.namespace.trim().is_empty() {
        return Err(invalid("namespace", "must not be empty"));
    }
    if scope.target_key.trim().is_empty() {
        return Err(invalid("targetKey", "must not be empty"));
    }
    if scope.revision.trim().is_empty() {
        return Err(invalid("revision", "must not be empty"));
    }
    Ok(())
}

fn validate_anchor(anchor: &ReviewThreadAnchor) -> ReviewThreadResult<()> {
    match anchor {
        ReviewThreadAnchor::Line {
            file_path,
            line,
            side,
        } => {
            if file_path.trim().is_empty() {
                return Err(invalid("filePath", "must not be empty"));
            }
            if *line < 1 {
                return Err(invalid("line", "must be at least 1"));
            }
            if side != "LEFT" && side != "RIGHT" {
                return Err(invalid("side", "must be LEFT or RIGHT"));
            }
            Ok(())
        }
        ReviewThreadAnchor::Custom { key } => {
            if key.trim().is_empty() {
                return Err(invalid("anchor.key", "must not be empty"));
            }
            Ok(())
        }
    }
}

fn validate_body(body: &str) -> ReviewThreadResult<()> {
    if body.trim().is_empty() {
        return Err(invalid("body", "must not be empty"));
    }
    Ok(())
}

const THREAD_COLUMNS: &str = "id, namespace, target_key, revision, run_id, origin, anchor_kind, \
     file_path, line, side, anchor_key, status, awaiting, idempotency_key, seen_at, created_at, \
     updated_at";

fn read_thread_row(row: &rusqlite::Row<'_>) -> SqlResult<ReviewThreadRow> {
    let anchor_kind: String = row.get(6)?;
    let anchor = if anchor_kind == "custom" {
        ReviewThreadAnchor::Custom {
            key: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
        }
    } else {
        ReviewThreadAnchor::Line {
            file_path: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            line: row.get::<_, Option<i64>>(8)?.unwrap_or_default(),
            side: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        }
    };

    Ok(ReviewThreadRow {
        id: row.get(0)?,
        namespace: row.get(1)?,
        target_key: row.get(2)?,
        revision: row.get(3)?,
        run_id: row.get(4)?,
        origin: row.get(5)?,
        anchor,
        status: row.get(11)?,
        awaiting: row.get(12)?,
        idempotency_key: row.get(13)?,
        seen_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        messages: Vec::new(),
    })
}

fn read_message_row(row: &rusqlite::Row<'_>) -> SqlResult<(String, ReviewThreadMessageRow)> {
    Ok((
        row.get(0)?,
        ReviewThreadMessageRow {
            id: row.get(1)?,
            role: row.get(2)?,
            body: row.get(3)?,
            created_at: row.get(4)?,
        },
    ))
}

fn group_messages(
    rows: impl Iterator<Item = SqlResult<(String, ReviewThreadMessageRow)>>,
) -> SqlResult<HashMap<String, Vec<ReviewThreadMessageRow>>> {
    let mut grouped: HashMap<String, Vec<ReviewThreadMessageRow>> = HashMap::new();
    for row in rows {
        let (thread_id, message) = row?;
        grouped.entry(thread_id).or_default().push(message);
    }
    Ok(grouped)
}

fn read_thread(conn: &Connection, thread_id: &str) -> ReviewThreadResult<ReviewThreadRow> {
    let mut thread = conn
        .query_row(
            &format!("SELECT {THREAD_COLUMNS} FROM review_threads WHERE id = ?1"),
            [thread_id],
            read_thread_row,
        )
        .optional()?
        .ok_or_else(|| ReviewThreadError::ThreadNotFound(thread_id.to_string()))?;

    let mut statement = conn.prepare(
        "SELECT thread_id, id, role, body, created_at
           FROM review_thread_messages
          WHERE thread_id = ?1
          ORDER BY sequence",
    )?;
    let mut grouped = group_messages(statement.query_map([thread_id], read_message_row)?)?;
    thread.messages = grouped.remove(thread_id).unwrap_or_default();
    Ok(thread)
}

fn insert_message(
    tx: &rusqlite::Transaction<'_>,
    thread_id: &str,
    role: &str,
    body: &str,
    created_at: i64,
    sequence: i64,
) -> SqlResult<()> {
    tx.execute(
        "INSERT INTO review_thread_messages (id, thread_id, role, body, created_at, sequence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            format!("rtm_{}", uuid::Uuid::new_v4()),
            thread_id,
            role,
            body,
            created_at,
            sequence
        ],
    )?;
    Ok(())
}

impl super::Database {
    pub fn list_review_threads(
        &self,
        scope: &ReviewThreadScope,
    ) -> ReviewThreadResult<Vec<ReviewThreadRow>> {
        validate_scope(scope)?;
        let conn = self.lock_conn()?;
        let scope_params = rusqlite::params![&scope.namespace, &scope.target_key, &scope.revision];

        let mut thread_statement = conn.prepare(&format!(
            "SELECT {THREAD_COLUMNS}
               FROM review_threads
              WHERE namespace = ?1 AND target_key = ?2 AND revision = ?3
              ORDER BY created_at, id"
        ))?;
        let mut threads = thread_statement
            .query_map(scope_params, read_thread_row)?
            .collect::<SqlResult<Vec<_>>>()?;

        let mut message_statement = conn.prepare(
            "SELECT message.thread_id, message.id, message.role, message.body, message.created_at
               FROM review_thread_messages message
               JOIN review_threads thread ON thread.id = message.thread_id
              WHERE thread.namespace = ?1 AND thread.target_key = ?2 AND thread.revision = ?3
              ORDER BY message.thread_id, message.sequence",
        )?;
        let mut grouped =
            group_messages(message_statement.query_map(scope_params, read_message_row)?)?;
        for thread in &mut threads {
            thread.messages = grouped.remove(&thread.id).unwrap_or_default();
        }

        Ok(threads)
    }

    pub fn create_review_thread(
        &self,
        request: &CreateReviewThread,
    ) -> ReviewThreadResult<ReviewThreadRow> {
        validate_scope(&request.scope)?;
        validate_anchor(&request.anchor)?;
        validate_body(&request.body)?;
        if !ORIGINS.contains(&request.origin.as_str()) {
            return Err(invalid("origin", "must be agent, human, or plugin"));
        }

        let now = super::current_unix_timestamp()?;
        let thread_id = format!("rt_{}", uuid::Uuid::new_v4());
        let author_role = if request.origin == "agent" {
            "agent"
        } else {
            "human"
        };
        let (anchor_kind, file_path, line, side, anchor_key) = match &request.anchor {
            ReviewThreadAnchor::Line {
                file_path,
                line,
                side,
            } => (
                "line",
                Some(file_path.as_str()),
                Some(*line),
                Some(side.as_str()),
                None,
            ),
            ReviewThreadAnchor::Custom { key } => ("custom", None, None, None, Some(key.as_str())),
        };

        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO review_threads (
                id, namespace, target_key, revision, run_id, origin, anchor_kind,
                file_path, line, side, anchor_key, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            rusqlite::params![
                &thread_id,
                &request.scope.namespace,
                &request.scope.target_key,
                &request.scope.revision,
                &request.run_id,
                &request.origin,
                anchor_kind,
                file_path,
                line,
                side,
                anchor_key,
                now,
            ],
        )?;
        insert_message(&tx, &thread_id, author_role, &request.body, now, 0)?;
        tx.commit()?;

        read_thread(&conn, &thread_id)
    }

    pub fn reply_to_review_thread(
        &self,
        request: &ReplyToReviewThread,
    ) -> ReviewThreadResult<ReviewThreadRow> {
        validate_body(&request.body)?;
        if !ROLES.contains(&request.role.as_str()) {
            return Err(invalid("role", "must be agent or human"));
        }

        let now = super::current_unix_timestamp()?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;

        let thread_exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM review_threads WHERE id = ?1)",
            [&request.thread_id],
            |row| row.get(0),
        )?;
        if !thread_exists {
            return Err(ReviewThreadError::ThreadNotFound(request.thread_id.clone()));
        }

        let next_sequence: i64 = tx.query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM review_thread_messages WHERE thread_id = ?1",
            [&request.thread_id],
            |row| row.get(0),
        )?;
        insert_message(
            &tx,
            &request.thread_id,
            &request.role,
            &request.body,
            now,
            next_sequence,
        )?;
        tx.execute(
            "UPDATE review_threads SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, &request.thread_id],
        )?;
        tx.commit()?;

        read_thread(&conn, &request.thread_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;

    fn scope() -> ReviewThreadScope {
        ReviewThreadScope {
            namespace: "github".to_string(),
            target_key: "gh:acme/web#1421".to_string(),
            revision: "sha-1".to_string(),
        }
    }

    fn line_anchor() -> ReviewThreadAnchor {
        ReviewThreadAnchor::Line {
            file_path: "src/main.rs".to_string(),
            line: 42,
            side: "RIGHT".to_string(),
        }
    }

    fn create_request(body: &str) -> CreateReviewThread {
        CreateReviewThread {
            scope: scope(),
            anchor: line_anchor(),
            origin: "agent".to_string(),
            body: body.to_string(),
            run_id: None,
        }
    }

    #[test]
    fn a_created_thread_carries_its_anchor_origin_and_first_message() {
        let (db, _temp) = make_test_db("review_threads_create");

        let thread = db
            .create_review_thread(&create_request("Missing null check"))
            .expect("create");

        assert_eq!(thread.anchor, line_anchor());
        assert_eq!(thread.origin, "agent");
        assert_eq!(thread.status, "open");
        assert_eq!(thread.awaiting, "none");
        assert_eq!(thread.messages.len(), 1);
        assert_eq!(thread.messages[0].role, "agent");
        assert_eq!(thread.messages[0].body, "Missing null check");
    }

    #[test]
    fn a_reply_appends_a_message_to_the_same_thread() {
        let (db, _temp) = make_test_db("review_threads_reply");
        let thread = db
            .create_review_thread(&create_request("Missing null check"))
            .expect("create");

        let replied = db
            .reply_to_review_thread(&ReplyToReviewThread {
                thread_id: thread.id.clone(),
                role: "human".to_string(),
                body: "Why?".to_string(),
            })
            .expect("reply");

        assert_eq!(replied.id, thread.id);
        assert_eq!(
            replied
                .messages
                .iter()
                .map(|message| (message.role.as_str(), message.body.as_str()))
                .collect::<Vec<_>>(),
            vec![("agent", "Missing null check"), ("human", "Why?")]
        );
        assert_eq!(db.list_review_threads(&scope()).expect("list").len(), 1);
    }

    #[test]
    fn repeated_replies_keep_their_order() {
        let (db, _temp) = make_test_db("review_threads_reply_order");
        let thread = db
            .create_review_thread(&create_request("first"))
            .expect("create");

        for body in ["second", "third", "fourth"] {
            db.reply_to_review_thread(&ReplyToReviewThread {
                thread_id: thread.id.clone(),
                role: "human".to_string(),
                body: body.to_string(),
            })
            .expect("reply");
        }

        let listed = db.list_review_threads(&scope()).expect("list");
        assert_eq!(
            listed[0]
                .messages
                .iter()
                .map(|message| message.body.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second", "third", "fourth"]
        );
    }

    #[test]
    fn listing_returns_only_threads_stored_under_the_exact_triple() {
        let (db, _temp) = make_test_db("review_threads_scope");
        db.create_review_thread(&create_request("in scope"))
            .expect("create");

        for other in [
            ReviewThreadScope {
                namespace: "task".to_string(),
                ..scope()
            },
            ReviewThreadScope {
                target_key: "gh:acme/web#9".to_string(),
                ..scope()
            },
            ReviewThreadScope {
                revision: "sha-2".to_string(),
                ..scope()
            },
        ] {
            db.create_review_thread(&CreateReviewThread {
                scope: other,
                ..create_request("out of scope")
            })
            .expect("create");
        }

        let threads = db.list_review_threads(&scope()).expect("list");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].messages[0].body, "in scope");
    }

    #[test]
    fn a_revision_with_no_threads_lists_empty() {
        let (db, _temp) = make_test_db("review_threads_empty_revision");
        db.create_review_thread(&create_request("on sha-1"))
            .expect("create");

        let threads = db
            .list_review_threads(&ReviewThreadScope {
                revision: "sha-2".to_string(),
                ..scope()
            })
            .expect("list");

        assert!(threads.is_empty());
    }

    #[test]
    fn a_target_key_that_matches_no_other_host_record_is_accepted() {
        let (db, _temp) = make_test_db("review_threads_unknown_target");
        let unknown = ReviewThreadScope {
            namespace: "made-up".to_string(),
            target_key: "nothing-references-this".to_string(),
            revision: "rev".to_string(),
        };

        let thread = db
            .create_review_thread(&CreateReviewThread {
                scope: unknown.clone(),
                ..create_request("still stored")
            })
            .expect("create");

        assert_eq!(thread.target_key, "nothing-references-this");
        assert_eq!(db.list_review_threads(&unknown).expect("list").len(), 1);
    }

    #[test]
    fn a_structurally_invalid_create_is_rejected_naming_the_field_and_stores_nothing() {
        let cases: Vec<(&str, CreateReviewThread, &str)> = vec![
            (
                "empty file path",
                CreateReviewThread {
                    anchor: ReviewThreadAnchor::Line {
                        file_path: String::new(),
                        line: 42,
                        side: "RIGHT".to_string(),
                    },
                    ..create_request("body")
                },
                "filePath",
            ),
            (
                "line below one",
                CreateReviewThread {
                    anchor: ReviewThreadAnchor::Line {
                        file_path: "src/main.rs".to_string(),
                        line: 0,
                        side: "RIGHT".to_string(),
                    },
                    ..create_request("body")
                },
                "line",
            ),
            (
                "side that is neither LEFT nor RIGHT",
                CreateReviewThread {
                    anchor: ReviewThreadAnchor::Line {
                        file_path: "src/main.rs".to_string(),
                        line: 42,
                        side: "BOTH".to_string(),
                    },
                    ..create_request("body")
                },
                "side",
            ),
            ("empty body", create_request("   "), "body"),
            (
                "unsupported origin",
                CreateReviewThread {
                    origin: "robot".to_string(),
                    ..create_request("body")
                },
                "origin",
            ),
            (
                "empty namespace",
                CreateReviewThread {
                    scope: ReviewThreadScope {
                        namespace: String::new(),
                        ..scope()
                    },
                    ..create_request("body")
                },
                "namespace",
            ),
        ];

        for (case, request, field) in cases {
            let (db, _temp) = make_test_db("review_threads_invalid");

            let error = db
                .create_review_thread(&request)
                .expect_err(&format!("{case} should be rejected"));

            assert!(
                error.to_string().contains(field),
                "{case} should name '{field}', got: {error}"
            );
            assert!(
                db.list_review_threads(&scope()).expect("list").is_empty(),
                "{case} must store nothing"
            );
        }
    }

    #[test]
    fn a_rejected_create_leaves_earlier_threads_stored() {
        let (db, _temp) = make_test_db("review_threads_partial");
        db.create_review_thread(&create_request("first"))
            .expect("create");

        db.create_review_thread(&create_request(""))
            .expect_err("second should be rejected");

        assert_eq!(db.list_review_threads(&scope()).expect("list").len(), 1);
    }

    #[test]
    fn an_anchor_outside_the_reviewed_diff_is_stored_as_given() {
        let (db, _temp) = make_test_db("review_threads_outside_diff");
        let far_anchor = ReviewThreadAnchor::Line {
            file_path: "not/in/the/diff.rs".to_string(),
            line: 99_999,
            side: "LEFT".to_string(),
        };

        let thread = db
            .create_review_thread(&CreateReviewThread {
                anchor: far_anchor.clone(),
                ..create_request("orphan")
            })
            .expect("create");

        assert_eq!(thread.anchor, far_anchor);
    }

    #[test]
    fn replying_to_an_unknown_thread_is_rejected_and_creates_no_thread() {
        let (db, _temp) = make_test_db("review_threads_unknown_reply");

        let error = db
            .reply_to_review_thread(&ReplyToReviewThread {
                thread_id: "rt_missing".to_string(),
                role: "human".to_string(),
                body: "Anybody there?".to_string(),
            })
            .expect_err("reply should be rejected");

        assert!(error.to_string().contains("rt_missing"), "got: {error}");
        assert!(db.list_review_threads(&scope()).expect("list").is_empty());
    }

    #[test]
    fn an_empty_reply_body_is_rejected_naming_the_field_and_appends_nothing() {
        let (db, _temp) = make_test_db("review_threads_empty_reply");
        let thread = db
            .create_review_thread(&create_request("first"))
            .expect("create");

        let error = db
            .reply_to_review_thread(&ReplyToReviewThread {
                thread_id: thread.id.clone(),
                role: "human".to_string(),
                body: "  ".to_string(),
            })
            .expect_err("reply should be rejected");

        assert!(error.to_string().contains("body"), "got: {error}");
        assert_eq!(
            db.list_review_threads(&scope()).expect("list")[0]
                .messages
                .len(),
            1
        );
    }

    #[test]
    fn a_reviewer_initiated_thread_records_a_person_as_its_author() {
        let (db, _temp) = make_test_db("review_threads_human_origin");

        let thread = db
            .create_review_thread(&CreateReviewThread {
                origin: "human".to_string(),
                ..create_request("What does this do?")
            })
            .expect("create");

        assert_eq!(thread.origin, "human");
        assert_eq!(thread.messages[0].role, "human");
    }

    #[test]
    fn a_custom_anchor_round_trips_through_the_store() {
        let (db, _temp) = make_test_db("review_threads_custom_anchor");
        let anchor = ReviewThreadAnchor::Custom {
            key: "overview".to_string(),
        };

        let thread = db
            .create_review_thread(&CreateReviewThread {
                anchor: anchor.clone(),
                ..create_request("General remark")
            })
            .expect("create");

        assert_eq!(thread.anchor, anchor);
        assert_eq!(
            db.list_review_threads(&scope()).expect("list")[0].anchor,
            anchor
        );
    }
}
