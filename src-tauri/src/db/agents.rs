use rusqlite::Result;
use serde::Serialize;

/// Agent session row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentSessionRow {
    pub id: String,
    pub ticket_id: String,
    pub opencode_session_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub checkpoint_data: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub provider: String,
    pub claude_session_id: Option<String>,
}

/// Agent log row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentLogRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub log_type: String,
    pub content: String,
}

impl super::Database {
    pub fn create_agent_session(
        &self,
        id: &str,
        ticket_id: &str,
        opencode_session_id: Option<&str>,
        stage: &str,
        status: &str,
        provider: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_sessions (id, ticket_id, opencode_session_id, stage, status, provider, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![id, ticket_id, opencode_session_id, stage, status, provider, now, now],
        )?;
        Ok(())
    }

    pub fn update_agent_session(
        &self,
        id: &str,
        stage: &str,
        status: &str,
        checkpoint_data: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET stage = ?1, status = ?2, checkpoint_data = ?3, error_message = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![stage, status, checkpoint_data, error_message, now, id],
        )?;
        Ok(())
    }

    pub fn set_agent_session_opencode_id(&self, id: &str, opencode_session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agent_sessions SET opencode_session_id = ?1 WHERE id = ?2",
            [opencode_session_id, id],
        )?;
        Ok(())
    }

    pub fn set_agent_session_claude_id(&self, id: &str, claude_session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agent_sessions SET claude_session_id = ?1 WHERE id = ?2",
            [claude_session_id, id],
        )?;
        Ok(())
    }

    pub fn get_agent_session(&self, id: &str) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at, provider, claude_session_id
             FROM agent_sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                provider: row.get(9)?,
                claude_session_id: row.get(10)?
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_session_for_ticket(
        &self,
        ticket_id: &str,
    ) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at, provider, claude_session_id
             FROM agent_sessions WHERE ticket_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([ticket_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                provider: row.get(9)?,
                claude_session_id: row.get(10)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_sessions_for_tickets(
        &self,
        ticket_ids: &[String],
    ) -> Result<Vec<AgentSessionRow>> {
        if ticket_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ticket_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT s.id, s.ticket_id, s.opencode_session_id, s.stage, s.status, s.checkpoint_data, s.error_message, s.created_at, s.updated_at, s.provider, s.claude_session_id
             FROM agent_sessions s
             INNER JOIN (
                 SELECT ticket_id, MAX(created_at) as max_created
                 FROM agent_sessions
                 WHERE ticket_id IN ({})
                 GROUP BY ticket_id
             ) latest ON s.ticket_id = latest.ticket_id AND s.created_at = latest.max_created",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = ticket_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                provider: row.get(9)?,
                claude_session_id: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_sessions_by_provider(&self, provider: &str) -> Result<Vec<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at, provider, claude_session_id
             FROM agent_sessions WHERE provider = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([provider], |row| {
            Ok(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                provider: row.get(9)?,
                claude_session_id: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_running_claude_sessions(&self) -> Result<Vec<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at, provider, claude_session_id
             FROM agent_sessions WHERE provider = 'claude-code' AND status = 'running' ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                provider: row.get(9)?,
                claude_session_id: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn insert_agent_log(&self, session_id: &str, log_type: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_logs (session_id, timestamp, log_type, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, now, log_type, content],
        )?;
        Ok(())
    }

    pub fn get_agent_logs(&self, session_id: &str) -> Result<Vec<AgentLogRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, log_type, content FROM agent_logs WHERE session_id = ?1 ORDER BY timestamp ASC",
        )?;
        let logs = stmt.query_map([session_id], |row| {
            Ok(AgentLogRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                log_type: row.get(3)?,
                content: row.get(4)?,
            })
        })?;
        let mut result = Vec::new();
        for log in logs {
            result.push(log?);
        }
        Ok(result)
    }

    pub fn mark_running_sessions_interrupted(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET status = 'interrupted', error_message = 'Session interrupted by app restart', updated_at = ?1 WHERE status = 'running'",
            rusqlite::params![now],
        )?;
        Ok(conn.changes() as usize)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_agent_session_lifecycle() {
        let (db, path) = make_test_db("agent_session_lifecycle");
        insert_test_task(&db);

        db.create_agent_session("ses-1", "T-100", None, "read_ticket", "running", "opencode")
            .expect("create failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.ticket_id, "T-100");
        assert_eq!(session.stage, "read_ticket");
        assert_eq!(session.status, "running");
        assert!(session.opencode_session_id.is_none());

        db.set_agent_session_opencode_id("ses-1", "oc-abc")
            .expect("set opencode id failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.opencode_session_id, Some("oc-abc".to_string()));

        db.update_agent_session(
            "ses-1",
            "implement",
            "paused",
            Some("{\"diff\":\"...\"}"),
            None,
        )
        .expect("update failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.stage, "implement");
        assert_eq!(session.status, "paused");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"diff\":\"...\"}".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_latest_session_for_ticket() {
        let (db, path) = make_test_db("latest_session");
        insert_test_task(&db);

        db.create_agent_session("ses-old", "T-100", None, "read_ticket", "completed", "opencode")
            .expect("create 1 failed");
        db.create_agent_session("ses-new", "T-100", None, "implement", "running", "opencode")
            .expect("create 2 failed");

        let latest = db
            .get_latest_session_for_ticket("T-100")
            .expect("get failed")
            .expect("not found");
        assert_eq!(latest.id, "ses-new");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_checkpoint_data_persistence() {
        let (db, path) = make_test_db("checkpoint_persist");
        insert_test_task(&db);

        db.create_agent_session("ses-cp", "T-100", None, "implement", "running", "opencode")
            .expect("create session failed");

        db.update_agent_session(
            "ses-cp",
            "implement",
            "paused",
            Some("{\"question\":\"approve?\"}"),
            None,
        )
        .expect("update with checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"question\":\"approve?\"}".to_string())
        );

        db.update_agent_session("ses-cp", "implement", "running", None, None)
            .expect("clear checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.checkpoint_data, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_logs() {
        let (db, path) = make_test_db("agent_logs");
        insert_test_task(&db);

        db.create_agent_session("ses-log", "T-100", None, "implement", "running", "opencode")
            .expect("create session failed");

        db.insert_agent_log("ses-log", "stdout", "Building project...")
            .expect("insert log 1 failed");
        db.insert_agent_log("ses-log", "stderr", "Warning: unused var")
            .expect("insert log 2 failed");

        let logs = db.get_agent_logs("ses-log").expect("get logs failed");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].log_type, "stdout");
        assert_eq!(logs[0].content, "Building project...");
        assert_eq!(logs[1].log_type, "stderr");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_logs_claude_event_types() {
        let (db, path) = make_test_db("claude_event_types");
        insert_test_task(&db);

        db.create_agent_session("ses-claude", "T-100", None, "implement", "running", "claude-code")
            .expect("create session failed");

        // Insert logs with all semantic log_type values used by the Claude bridge
        db.insert_agent_log("ses-claude", "system.init", r#"{"type":"system","subtype":"init","session_id":"abc"}"#)
            .expect("insert system.init failed");
        db.insert_agent_log("ses-claude", "assistant", r#"{"type":"assistant","content":[{"type":"text","text":"Hello"}]}"#)
            .expect("insert assistant failed");
        db.insert_agent_log("ses-claude", "tool_use", r#"{"type":"tool_use","name":"Read","input":{"path":"foo.rs"}}"#)
            .expect("insert tool_use failed");
        db.insert_agent_log("ses-claude", "tool_result", r#"{"type":"tool_result","content":"file contents"}"#)
            .expect("insert tool_result failed");
        db.insert_agent_log("ses-claude", "result.success", r#"{"type":"result","subtype":"success","cost_usd":0.05}"#)
            .expect("insert result.success failed");
        db.insert_agent_log("ses-claude", "result.error_max_turns", r#"{"type":"result","subtype":"error_max_turns"}"#)
            .expect("insert result.error_max_turns failed");

        // Retrieve logs and verify
        let logs = db.get_agent_logs("ses-claude").expect("get logs failed");
        assert_eq!(logs.len(), 6);

        // Verify log_type values in order
        assert_eq!(logs[0].log_type, "system.init");
        assert_eq!(logs[1].log_type, "assistant");
        assert_eq!(logs[2].log_type, "tool_use");
        assert_eq!(logs[3].log_type, "tool_result");
        assert_eq!(logs[4].log_type, "result.success");
        assert_eq!(logs[5].log_type, "result.error_max_turns");

        // Verify content values match what was inserted
        assert_eq!(logs[0].content, r#"{"type":"system","subtype":"init","session_id":"abc"}"#);
        assert_eq!(logs[1].content, r#"{"type":"assistant","content":[{"type":"text","text":"Hello"}]}"#);
        assert_eq!(logs[2].content, r#"{"type":"tool_use","name":"Read","input":{"path":"foo.rs"}}"#);
        assert_eq!(logs[3].content, r#"{"type":"tool_result","content":"file contents"}"#);
        assert_eq!(logs[4].content, r#"{"type":"result","subtype":"success","cost_usd":0.05}"#);
        assert_eq!(logs[5].content, r#"{"type":"result","subtype":"error_max_turns"}"#);

        // Verify session_id is correct for all logs
        for log in &logs {
            assert_eq!(log.session_id, "ses-claude");
        }

        // Verify chronological ordering (timestamps are non-decreasing)
        for i in 0..logs.len() - 1 {
            assert!(logs[i].timestamp <= logs[i + 1].timestamp, "Logs should be in chronological order");
        }

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_mark_running_sessions_interrupted() {
        let (db, path) = make_test_db("mark_interrupted");
        insert_test_task(&db);

        db.create_agent_session("ses-run1", "T-100", None, "implement", "running", "opencode")
            .expect("create running 1 failed");
        db.create_agent_session("ses-run2", "T-100", None, "implement", "running", "opencode")
            .expect("create running 2 failed");
        db.create_agent_session("ses-done", "T-100", None, "implement", "completed", "opencode")
            .expect("create completed failed");
        db.create_agent_session("ses-fail", "T-100", None, "implement", "failed", "opencode")
            .expect("create failed failed");

        let count = db
            .mark_running_sessions_interrupted()
            .expect("mark interrupted failed");
        assert_eq!(count, 2);

        let s1 = db.get_agent_session("ses-run1").expect("get").unwrap();
        assert_eq!(s1.status, "interrupted");
        assert_eq!(
            s1.error_message,
            Some("Session interrupted by app restart".to_string())
        );

        let s2 = db.get_agent_session("ses-run2").expect("get").unwrap();
        assert_eq!(s2.status, "interrupted");

        let s3 = db.get_agent_session("ses-done").expect("get").unwrap();
        assert_eq!(s3.status, "completed");

        let s4 = db.get_agent_session("ses-fail").expect("get").unwrap();
        assert_eq!(s4.status, "failed");

        let count2 = db
            .mark_running_sessions_interrupted()
            .expect("second call failed");
        assert_eq!(count2, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_session_with_claude_provider() {
        let (db, path) = make_test_db("claude_provider");
        insert_test_task(&db);
        
        db.create_agent_session("ses-claude", "T-100", None, "implement", "running", "claude-code")
            .expect("create failed");
        
        let session = db.get_agent_session("ses-claude").expect("get failed").expect("not found");
        assert_eq!(session.provider, "claude-code");
        assert!(session.claude_session_id.is_none());
        
        db.set_agent_session_claude_id("ses-claude", "claude-ses-123")
            .expect("set claude id failed");
        
        let session = db.get_agent_session("ses-claude").expect("get failed").expect("not found");
        assert_eq!(session.claude_session_id, Some("claude-ses-123".to_string()));
        
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_sessions_by_provider() {
        let (db, path) = make_test_db("sessions_by_provider");
        insert_test_task(&db);
        
        db.create_agent_session("ses-oc1", "T-100", None, "implement", "running", "opencode")
            .expect("create opencode 1 failed");
        db.create_agent_session("ses-oc2", "T-100", None, "implement", "completed", "opencode")
            .expect("create opencode 2 failed");
        db.create_agent_session("ses-cc1", "T-100", None, "implement", "running", "claude-code")
            .expect("create claude 1 failed");
        
        let opencode_sessions = db.get_sessions_by_provider("opencode").expect("get opencode failed");
        assert_eq!(opencode_sessions.len(), 2);
        assert!(opencode_sessions.iter().all(|s| s.provider == "opencode"));
        
        let claude_sessions = db.get_sessions_by_provider("claude-code").expect("get claude failed");
        assert_eq!(claude_sessions.len(), 1);
        assert_eq!(claude_sessions[0].provider, "claude-code");
        
        let none_sessions = db.get_sessions_by_provider("nonexistent").expect("get none failed");
        assert_eq!(none_sessions.len(), 0);
        
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_running_claude_sessions() {
        let (db, path) = make_test_db("running_claude_sessions");
        insert_test_task(&db);
        
        db.create_agent_session("ses-cc-run", "T-100", None, "implement", "running", "claude-code")
            .expect("create running claude failed");
        db.create_agent_session("ses-cc-done", "T-100", None, "implement", "completed", "claude-code")
            .expect("create completed claude failed");
        db.create_agent_session("ses-oc-run", "T-100", None, "implement", "running", "opencode")
            .expect("create running opencode failed");
        
        let running = db.get_running_claude_sessions().expect("get running failed");
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, "ses-cc-run");
        assert_eq!(running[0].provider, "claude-code");
        assert_eq!(running[0].status, "running");
        
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
