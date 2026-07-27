use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionPurgeIntentRow {
    pub id: i64,
    pub scope: String,
    pub owner_id: String,
    pub created_at: i64,
}

pub(super) fn enqueue_task_purge_if_present(conn: &Connection, task_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO browser_session_purge_intents (scope, owner_id, created_at)
         SELECT 'task', ?1, unixepoch()
         WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1)
         ON CONFLICT(scope, owner_id) DO NOTHING",
        [task_id],
    )?;
    Ok(())
}

pub(super) fn enqueue_project_task_purges(conn: &Connection, project_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO browser_session_purge_intents (scope, owner_id, created_at)
         SELECT 'task', id, unixepoch()
         FROM tasks
         WHERE project_id = ?1
         ORDER BY id
         ON CONFLICT(scope, owner_id) DO NOTHING",
        [project_id],
    )?;
    Ok(())
}

pub(super) fn enqueue_plugin_purge_if_present(conn: &Connection, plugin_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO browser_session_purge_intents (scope, owner_id, created_at)
         SELECT 'plugin', ?1, unixepoch()
         WHERE EXISTS (SELECT 1 FROM plugins WHERE id = ?1)
         ON CONFLICT(scope, owner_id) DO NOTHING",
        [plugin_id],
    )?;
    Ok(())
}

impl super::Database {
    pub fn list_browser_session_purge_intents(&self) -> Result<Vec<BrowserSessionPurgeIntentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare(
            "SELECT id, scope, owner_id, created_at
             FROM browser_session_purge_intents
             ORDER BY id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(BrowserSessionPurgeIntentRow {
                id: row.get(0)?,
                scope: row.get(1)?,
                owner_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn acknowledge_browser_session_purge_intent(&self, intent_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM browser_session_purge_intents WHERE id = ?1",
            [intent_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::{insert_test_task, make_test_db};
    use crate::db::PluginRow;

    fn plugin(id: &str) -> PluginRow {
        PluginRow {
            id: id.to_string(),
            name: id.to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: String::new(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "index.js".to_string(),
            backend_entry: None,
            install_path: format!("/tmp/{id}"),
            source_kind: "local".to_string(),
            source_spec: format!("/tmp/{id}"),
            package_metadata: "{}".to_string(),
            installed_at: 1,
            is_builtin: false,
        }
    }

    #[test]
    fn task_completion_records_one_durable_purge_intent_transactionally() {
        let (db, path) = make_test_db("browser_purge_task_completion");
        insert_test_task(&db);

        db.delete_task("T-100").expect("delete task");
        db.delete_task("T-100")
            .expect("repeat delete is idempotent");

        let intents = db
            .list_browser_session_purge_intents()
            .expect("list purge intents");
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].scope, "task");
        assert_eq!(intents[0].owner_id, "T-100");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn hard_task_deletion_records_a_durable_purge_intent() {
        let (db, path) = make_test_db("browser_purge_hard_task_delete");
        insert_test_task(&db);

        db.hard_delete_task("T-100").expect("hard delete task");

        let intents = db
            .list_browser_session_purge_intents()
            .expect("list purge intents");
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].scope, "task");
        assert_eq!(intents[0].owner_id, "T-100");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn failed_task_deletion_rolls_back_its_purge_intent() {
        let (db, path) = make_test_db("browser_purge_task_rollback");
        insert_test_task(&db);
        {
            let conn = db.connection();
            let conn = conn.lock().expect("lock database");
            conn.execute_batch(
                "CREATE TRIGGER fail_task_completion BEFORE UPDATE OF status ON tasks
                 WHEN OLD.id = 'T-100'
                 BEGIN SELECT RAISE(ABORT, 'forced task failure'); END;",
            )
            .expect("create failure trigger");
        }

        assert!(db.delete_task("T-100").is_err());
        assert!(db
            .list_browser_session_purge_intents()
            .expect("list purge intents")
            .is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn plugin_uninstall_records_one_durable_purge_intent_transactionally() {
        let (db, path) = make_test_db("browser_purge_plugin_uninstall");
        db.install_plugin(&plugin("browser"))
            .expect("install plugin");

        db.uninstall_plugin("browser").expect("uninstall plugin");

        let intents = db
            .list_browser_session_purge_intents()
            .expect("list purge intents");
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].scope, "plugin");
        assert_eq!(intents[0].owner_id, "browser");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn failed_plugin_uninstall_rolls_back_its_purge_intent() {
        let (db, path) = make_test_db("browser_purge_plugin_rollback");
        db.install_plugin(&plugin("browser"))
            .expect("install plugin");
        {
            let conn = db.connection();
            let conn = conn.lock().expect("lock database");
            conn.execute_batch(
                "CREATE TRIGGER fail_plugin_uninstall BEFORE DELETE ON plugins
                 WHEN OLD.id = 'browser'
                 BEGIN SELECT RAISE(ABORT, 'forced plugin failure'); END;",
            )
            .expect("create failure trigger");
        }

        assert!(db.uninstall_plugin("browser").is_err());
        assert!(db
            .list_browser_session_purge_intents()
            .expect("list purge intents")
            .is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn project_deletion_records_purge_intents_for_every_owned_task() {
        let (db, path) = make_test_db("browser_purge_project_delete");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let first = db
            .create_task("First", "backlog", Some(&project.id), None, None)
            .expect("create first task");
        let second = db
            .create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second task");

        db.delete_project(&project.id).expect("delete project");

        let intents = db
            .list_browser_session_purge_intents()
            .expect("list purge intents");
        assert_eq!(
            intents
                .iter()
                .map(|intent| intent.owner_id.as_str())
                .collect::<Vec<_>>(),
            vec![first.id.as_str(), second.id.as_str()],
        );
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn failed_project_deletion_rolls_back_task_purge_intents() {
        let (db, path) = make_test_db("browser_purge_project_rollback");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("First", "backlog", Some(&project.id), None, None)
            .expect("create task");
        {
            let conn = db.connection();
            let conn = conn.lock().expect("lock database");
            conn.execute_batch(
                "CREATE TRIGGER fail_project_task_delete BEFORE DELETE ON tasks
                 BEGIN SELECT RAISE(ABORT, 'forced project failure'); END;",
            )
            .expect("create failure trigger");
        }

        assert!(db.delete_project(&project.id).is_err());
        assert!(db
            .list_browser_session_purge_intents()
            .expect("list purge intents")
            .is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn acknowledgement_is_idempotent() {
        let (db, path) = make_test_db("browser_purge_acknowledgement");
        insert_test_task(&db);
        db.delete_task("T-100").expect("delete task");
        let intent_id = db
            .list_browser_session_purge_intents()
            .expect("list purge intents")[0]
            .id;

        db.acknowledge_browser_session_purge_intent(intent_id)
            .expect("acknowledge intent");
        db.acknowledge_browser_session_purge_intent(intent_id)
            .expect("repeat acknowledgement");

        assert!(db
            .list_browser_session_purge_intents()
            .expect("list purge intents")
            .is_empty());
        std::fs::remove_file(path).ok();
    }
}
