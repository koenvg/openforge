use rusqlite::{params, OptionalExtension, Result, Row};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScopedWorkspaceRow {
    pub id: String,
    pub owner_plugin_id: String,
    pub namespace: String,
    pub target_key: String,
    pub revision: String,
    pub project_id: String,
    pub repo_path: String,
    pub checkout_revision: String,
    pub resolved_commit: String,
    pub workspace_path: String,
    pub measured_bytes: u64,
    pub cleanup_state: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct NewScopedWorkspace<'a> {
    pub id: &'a str,
    pub owner_plugin_id: &'a str,
    pub namespace: &'a str,
    pub target_key: &'a str,
    pub revision: &'a str,
    pub project_id: &'a str,
    pub repo_path: &'a str,
    pub checkout_revision: &'a str,
    pub resolved_commit: &'a str,
    pub workspace_path: &'a str,
}

fn scoped_workspace_from_row(row: &Row<'_>) -> Result<ScopedWorkspaceRow> {
    let measured_bytes = row.get::<_, i64>(10)?;
    Ok(ScopedWorkspaceRow {
        id: row.get(0)?,
        owner_plugin_id: row.get(1)?,
        namespace: row.get(2)?,
        target_key: row.get(3)?,
        revision: row.get(4)?,
        project_id: row.get(5)?,
        repo_path: row.get(6)?,
        checkout_revision: row.get(7)?,
        resolved_commit: row.get(8)?,
        workspace_path: row.get(9)?,
        measured_bytes: u64::try_from(measured_bytes).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
        cleanup_state: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        last_used_at: row.get(14)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, owner_plugin_id, namespace, target_key, revision, project_id, repo_path, \
     checkout_revision, resolved_commit, workspace_path, measured_bytes, cleanup_state, \
     created_at, updated_at, last_used_at";

fn next_scoped_workspace_timestamp(conn: &rusqlite::Connection) -> Result<i64> {
    conn.query_row(
        "SELECT MAX(unixepoch() * 1000, COALESCE(MAX(last_used_at) + 1, 0))
         FROM scoped_workspaces",
        [],
        |row| row.get(0),
    )
}

impl super::Database {
    pub(crate) fn reserve_scoped_workspace(
        &self,
        workspace: &NewScopedWorkspace<'_>,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = next_scoped_workspace_timestamp(&conn)?;
        conn.execute(
            "INSERT INTO scoped_workspaces (
                id, owner_plugin_id, namespace, target_key, revision, project_id, repo_path,
                checkout_revision, resolved_commit, workspace_path, measured_bytes,
                cleanup_state, created_at, updated_at, last_used_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 'reserved', ?11, ?11, ?11)",
            params![
                workspace.id,
                workspace.owner_plugin_id,
                workspace.namespace,
                workspace.target_key,
                workspace.revision,
                workspace.project_id,
                workspace.repo_path,
                workspace.checkout_revision,
                workspace.resolved_commit,
                workspace.workspace_path,
                now,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn scoped_workspace(
        &self,
        namespace: &str,
        target_key: &str,
        revision: &str,
    ) -> Result<Option<ScopedWorkspaceRow>> {
        let conn = self.lock_conn()?;
        conn.query_row(
            &format!(
                "SELECT {SELECT_COLUMNS} FROM scoped_workspaces
                 WHERE namespace = ?1 AND target_key = ?2 AND revision = ?3"
            ),
            params![namespace, target_key, revision],
            scoped_workspace_from_row,
        )
        .optional()
    }

    pub(crate) fn scoped_workspaces_for_logical_scope(
        &self,
        namespace: &str,
        target_key: &str,
    ) -> Result<Vec<ScopedWorkspaceRow>> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM scoped_workspaces
             WHERE namespace = ?1 AND target_key = ?2 ORDER BY created_at, id"
        ))?;
        let rows =
            statement.query_map(params![namespace, target_key], scoped_workspace_from_row)?;
        rows.collect()
    }

    pub(crate) fn publish_scoped_workspace(
        &self,
        id: &str,
        workspace_path: &str,
        measured_bytes: u64,
    ) -> Result<()> {
        let measured_bytes = i64::try_from(measured_bytes)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let conn = self.lock_conn()?;
        let now = next_scoped_workspace_timestamp(&conn)?;
        let changed = conn.execute(
            "UPDATE scoped_workspaces
             SET workspace_path = ?1, measured_bytes = ?2, cleanup_state = 'ready',
                 updated_at = ?3, last_used_at = ?3
             WHERE id = ?4 AND cleanup_state = 'reserved'",
            params![workspace_path, measured_bytes, now, id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    pub(crate) fn record_scoped_workspace_measurement(
        &self,
        id: &str,
        measured_bytes: u64,
    ) -> Result<()> {
        let measured_bytes = i64::try_from(measured_bytes)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let conn = self.lock_conn()?;
        let now = next_scoped_workspace_timestamp(&conn)?;
        let changed = conn.execute(
            "UPDATE scoped_workspaces SET measured_bytes = ?1, updated_at = ?2
             WHERE id = ?3 AND cleanup_state = 'reserved'",
            params![measured_bytes, now, id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    pub(crate) fn touch_scoped_workspace(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = next_scoped_workspace_timestamp(&conn)?;
        conn.execute(
            "UPDATE scoped_workspaces SET updated_at = ?1, last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub(crate) fn mark_scoped_workspace_cleanup_pending(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = next_scoped_workspace_timestamp(&conn)?;
        conn.execute(
            "UPDATE scoped_workspaces SET cleanup_state = 'cleanup_pending', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub(crate) fn delete_scoped_workspace(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM scoped_workspaces WHERE id = ?1", [id])?;
        Ok(())
    }

    pub(crate) fn scoped_workspaces_in_states(
        &self,
        states: &[&str],
    ) -> Result<Vec<ScopedWorkspaceRow>> {
        if states.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = (1..=states.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM scoped_workspaces
             WHERE cleanup_state IN ({placeholders}) ORDER BY last_used_at, id"
        ))?;
        let rows = statement.query_map(
            rusqlite::params_from_iter(states.iter()),
            scoped_workspace_from_row,
        )?;
        rows.collect()
    }

    pub(crate) fn scoped_workspaces_for_owner(
        &self,
        owner_plugin_id: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<ScopedWorkspaceRow>> {
        let conn = self.lock_conn()?;
        let (sql, values): (String, Vec<&str>) = match project_id {
            Some(project_id) => (
                format!(
                    "SELECT {SELECT_COLUMNS} FROM scoped_workspaces
                     WHERE owner_plugin_id = ?1 AND project_id = ?2 ORDER BY created_at, id"
                ),
                vec![owner_plugin_id, project_id],
            ),
            None => (
                format!(
                    "SELECT {SELECT_COLUMNS} FROM scoped_workspaces
                     WHERE owner_plugin_id = ?1 ORDER BY created_at, id"
                ),
                vec![owner_plugin_id],
            ),
        };
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(
            rusqlite::params_from_iter(values),
            scoped_workspace_from_row,
        )?;
        rows.collect()
    }

    pub(crate) fn inactive_or_orphaned_scoped_workspaces(&self) -> Result<Vec<ScopedWorkspaceRow>> {
        let conn = self.lock_conn()?;
        let qualified_columns = format!("sw.{}", SELECT_COLUMNS.replace(", ", ", sw."));
        let mut statement = conn.prepare(&format!(
            "SELECT {qualified_columns} FROM scoped_workspaces sw
             LEFT JOIN projects project ON project.id = sw.project_id
             LEFT JOIN plugins plugin ON plugin.id = sw.owner_plugin_id
             LEFT JOIN app_plugins app_plugin ON app_plugin.plugin_id = plugin.id
             LEFT JOIN project_plugins project_plugin
                ON project_plugin.plugin_id = plugin.id
               AND project_plugin.project_id = sw.project_id
             LEFT JOIN global_plugins global_plugin ON global_plugin.plugin_id = plugin.id
             WHERE sw.cleanup_state = 'ready'
               AND (
                    project.id IS NULL
                    OR plugin.id IS NULL
                    OR CASE
                        WHEN json_extract(plugin.package_metadata, '$.enablement') = 'app'
                        THEN COALESCE(app_plugin.enabled, 0)
                        ELSE COALESCE(
                            project_plugin.enabled,
                            global_plugin.enabled,
                            CASE WHEN plugin.is_builtin = 1 THEN 1 ELSE 0 END
                        )
                    END = 0
               )
             ORDER BY sw.created_at, sw.id"
        ))?;
        let rows = statement.query_map([], scoped_workspace_from_row)?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn reserves_publishes_and_finds_a_scoped_workspace() {
        let (db, _temp_dir) = make_test_db("scoped_workspace_storage");
        let project = db
            .create_project("Repository", "/tmp/repository")
            .expect("create project");
        let reservation = NewScopedWorkspace {
            id: "scoped-agent-v1-abc",
            owner_plugin_id: "com.example.review",
            namespace: "github-pr",
            target_key: "owner/repo#42",
            revision: "head-a",
            project_id: &project.id,
            repo_path: "/tmp/repository",
            checkout_revision: "feature/review",
            resolved_commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            workspace_path: "/tmp/scoped/staging/workspace",
        };

        db.reserve_scoped_workspace(&reservation)
            .expect("reserve Scoped Workspace");
        assert!(db.reserve_scoped_workspace(&reservation).is_err());

        let reserved = db
            .scoped_workspace("github-pr", "owner/repo#42", "head-a")
            .expect("read exact scope")
            .expect("reserved workspace");
        assert_eq!(reserved.cleanup_state, "reserved");
        assert_eq!(reserved.owner_plugin_id, "com.example.review");

        db.publish_scoped_workspace(&reserved.id, "/tmp/scoped/ready/workspace", 4096)
            .expect("publish Scoped Workspace");
        let published = db
            .scoped_workspaces_for_logical_scope("github-pr", "owner/repo#42")
            .expect("read logical scope");
        assert_eq!(published.len(), 1);
        assert_eq!(published[0].cleanup_state, "ready");
        assert_eq!(published[0].workspace_path, "/tmp/scoped/ready/workspace");
        assert_eq!(published[0].measured_bytes, 4096);
    }
}
