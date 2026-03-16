use rusqlite::Result;
use serde::Serialize;

/// Shepherd message row from database
#[derive(Debug, Clone, Serialize)]
pub struct ShepherdMessageRow {
    pub id: i64,
    pub project_id: String,
    pub role: String,
    pub content: String,
    pub event_context: Option<String>,
    pub created_at: i64,
}

impl super::Database {
    /// Insert a shepherd message
    pub fn insert_shepherd_message(
        &self,
        project_id: &str,
        role: &str,
        content: &str,
        event_context: Option<&str>,
    ) -> Result<ShepherdMessageRow> {
        let conn = self.conn.lock().unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO shepherd_messages (project_id, role, content, event_context, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![project_id, role, content, event_context, now],
        )?;

        let id = conn.last_insert_rowid();

        Ok(ShepherdMessageRow {
            id,
            project_id: project_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            event_context: event_context.map(|s| s.to_string()),
            created_at: now,
        })
    }

    /// Get shepherd messages for a project, most recent first
    pub fn get_shepherd_messages(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<ShepherdMessageRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, role, content, event_context, created_at
             FROM shepherd_messages
             WHERE project_id = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT ?2",
        )?;

        let messages = stmt.query_map(rusqlite::params![project_id, limit], |row| {
            Ok(ShepherdMessageRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                event_context: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut result = Vec::new();
        for message in messages {
            result.push(message?);
        }
        Ok(result)
    }

    /// Clear all shepherd messages for a project
    pub fn clear_shepherd_messages(&self, project_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM shepherd_messages WHERE project_id = ?1",
            rusqlite::params![project_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_shepherd_messages_crud() {
        let (db, path) = make_test_db("shepherd_crud");

        // Create a project
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // Insert messages
        let msg1 = db
            .insert_shepherd_message(&project.id, "user", "Hello shepherd", None)
            .expect("Failed to insert message 1");
        assert_eq!(msg1.role, "user");
        assert_eq!(msg1.content, "Hello shepherd");
        assert_eq!(msg1.event_context, None);

        let msg2 = db
            .insert_shepherd_message(&project.id, "shepherd", "Processing...", Some("event_123"))
            .expect("Failed to insert message 2");
        assert_eq!(msg2.role, "shepherd");
        assert_eq!(msg2.event_context, Some("event_123".to_string()));

        // Get messages (most recent first)
        let messages = db
            .get_shepherd_messages(&project.id, 10)
            .expect("Failed to get messages");
        assert_eq!(messages.len(), 2);
        // Most recent first
        assert_eq!(messages[0].id, msg2.id);
        assert_eq!(messages[1].id, msg1.id);

        // Clear messages
        db.clear_shepherd_messages(&project.id)
            .expect("Failed to clear messages");
        let messages = db
            .get_shepherd_messages(&project.id, 10)
            .expect("Failed to get messages after clear");
        assert_eq!(messages.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_shepherd_messages_project_isolation() {
        let (db, path) = make_test_db("shepherd_isolation");

        // Create two projects
        let project1 = db
            .create_project("Project 1", "/tmp/proj1")
            .expect("Failed to create project 1");
        let project2 = db
            .create_project("Project 2", "/tmp/proj2")
            .expect("Failed to create project 2");

        // Insert messages for project 1
        db.insert_shepherd_message(&project1.id, "user", "Message for project 1", None)
            .expect("Failed to insert message for project 1");

        // Insert messages for project 2
        db.insert_shepherd_message(&project2.id, "user", "Message for project 2", None)
            .expect("Failed to insert message for project 2");

        // Get messages for project 1 — should only have 1
        let messages1 = db
            .get_shepherd_messages(&project1.id, 10)
            .expect("Failed to get messages for project 1");
        assert_eq!(messages1.len(), 1);
        assert_eq!(messages1[0].content, "Message for project 1");

        // Get messages for project 2 — should only have 1
        let messages2 = db
            .get_shepherd_messages(&project2.id, 10)
            .expect("Failed to get messages for project 2");
        assert_eq!(messages2.len(), 1);
        assert_eq!(messages2[0].content, "Message for project 2");

        // Clear project 1 — should not affect project 2
        db.clear_shepherd_messages(&project1.id)
            .expect("Failed to clear project 1");
        let messages1_after = db
            .get_shepherd_messages(&project1.id, 10)
            .expect("Failed to get messages for project 1 after clear");
        assert_eq!(messages1_after.len(), 0);

        let messages2_after = db
            .get_shepherd_messages(&project2.id, 10)
            .expect("Failed to get messages for project 2 after clear");
        assert_eq!(messages2_after.len(), 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
