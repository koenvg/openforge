use rusqlite::{Connection, OptionalExtension, Result};
use rusqlite_migration::{Migrations, M};

macro_rules! define_migrations {
    ($($migration:expr),+ $(,)?) => {
        const MIGRATION_COUNT: usize = [$(define_migrations!(@count $migration)),+].len();

        #[allow(dead_code)]
        /// The user_version that a fully-migrated fresh database will have.
        /// Equals the number of migrations returned by [`get_migrations`].
        pub const LATEST_USER_VERSION: i32 = MIGRATION_COUNT as i32;

        #[cfg(test)]
        fn migration_count() -> i32 {
            MIGRATION_COUNT as i32
        }

        /// Returns the complete migration set for this application.
        /// This is the single source of truth for schema version management.
        pub fn get_migrations() -> Migrations<'static> {
            Migrations::new(vec![$($migration),+])
        }
    };
    (@count $_migration:expr) => {
        ()
    };
}

define_migrations!(
    M::up_with_hook(
        r#"
DROP TABLE IF EXISTS agent_logs;
DROP TABLE IF EXISTS pr_comments;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS pull_requests;
DROP TABLE IF EXISTS tickets;

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    project_id TEXT REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    opencode_session_id TEXT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    checkpoint_data TEXT,
    pty_instance_id INTEGER,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    log_type TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY,
    pr_number INTEGER NOT NULL DEFAULT 0,
    ticket_id TEXT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    head_sha TEXT NOT NULL DEFAULT '',
    ci_status TEXT,
    ci_check_runs TEXT,
    last_polled_at INTEGER DEFAULT 0,
    review_status TEXT,
    mergeable INTEGER,
    mergeable_state TEXT,
    merged_at INTEGER,
    merge_readiness_status TEXT,
    merge_readiness_action TEXT,
    merge_readiness_blockers TEXT,
    merge_readiness_warnings TEXT,
    readiness_source_head_sha TEXT,
    merge_group_sha TEXT,
    required_checks_policy_known INTEGER,
    required_reviews_policy_known INTEGER,
    merge_queue_required INTEGER,
    merge_queue_state TEXT,
    readiness_updated_at INTEGER,
    FOREIGN KEY (ticket_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS pr_comments (
    id INTEGER PRIMARY KEY,
    pr_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    comment_type TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    addressed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_config (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS worktrees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    repo_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_prs (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL,
    draft INTEGER NOT NULL DEFAULT 0,
    html_url TEXT NOT NULL,
    user_login TEXT NOT NULL,
    user_avatar_url TEXT,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    head_ref TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    changed_files INTEGER NOT NULL DEFAULT 0,
    mergeable INTEGER,
    mergeable_state TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    viewed_at INTEGER,
    viewed_head_sha TEXT
);

CREATE TABLE IF NOT EXISTS self_review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    comment_type TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_self_review_comments_task_archived ON self_review_comments(task_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_self_review_comments_task_round ON self_review_comments(task_id, round);
CREATE INDEX IF NOT EXISTS idx_review_prs_updated_at ON review_prs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_prs_repo ON review_prs(repo_owner, repo_name);

INSERT OR IGNORE INTO config (key, value) VALUES ('github_token', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('opencode_auto_start', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_poll_interval', '60');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_task_id', '1');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_project_id', '1')
            "#,
        |tx| {
            // One-time migration: Copy per-project credentials to global config
            let global_token: String = tx
                .query_row(
                    "SELECT value FROM config WHERE key = 'github_token'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();

            if global_token.is_empty() {
                let source_project: Option<String> = tx.query_row(
                        "SELECT project_id FROM project_config WHERE key = 'github_token' AND value != '' LIMIT 1",
                        [],
                        |row| row.get(0),
                    ).ok();

                if let Some(project_id) = source_project {
                    let value: String = tx
                        .query_row(
                            "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'github_token'",
                            rusqlite::params![project_id],
                            |row| row.get(0),
                        )
                        .unwrap_or_default();
                    if !value.is_empty() {
                        tx.execute(
                            "UPDATE config SET value = ?1 WHERE key = 'github_token'",
                            rusqlite::params![value],
                        )
                        .map_err(rusqlite_migration::HookError::RusqliteError)?;
                    }
                }
            }

            // One-time migration: Simplify kanban columns from 5 to 3
            tx.execute(
                "UPDATE tasks SET status = 'backlog' WHERE status = 'todo'",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
            tx.execute(
                    "UPDATE tasks SET status = 'doing' WHERE status IN ('in_progress', 'in_review', 'testing')",
                    [],
                ).map_err(rusqlite_migration::HookError::RusqliteError)?;
            tx.execute(
                    "UPDATE tasks SET status = 'backlog' WHERE status NOT IN ('backlog', 'doing', 'done')",
                    [],
                ).map_err(rusqlite_migration::HookError::RusqliteError)?;

            Ok(())
        },
    ),
    M::up_with_hook(
        r#"
            "#,
        |tx| {
            // Only add columns if the table exists (for fresh databases)
            let table_exists: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                    [],
                    |r| r.get(0),
                ).unwrap_or(false);

            if table_exists {
                tx.execute(
                        "ALTER TABLE agent_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode'",
                        [],
                    ).ok();
                tx.execute(
                    "ALTER TABLE agent_sessions ADD COLUMN claude_session_id TEXT",
                    [],
                )
                .ok();
            }

            // Only insert config if the table exists
            let config_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if config_exists {
                tx.execute(
                    "INSERT OR IGNORE INTO config (key, value) VALUES ('ai_provider', 'opencode')",
                    [],
                )
                .ok();
            }
            Ok(())
        },
    ),
    M::up_with_hook(r#""#, |tx| {
        let config_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if config_exists {
            tx.execute(
                        "UPDATE config SET value = 'claude-code' WHERE key = 'ai_provider' AND value = 'opencode'",
                        [],
                    ).map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS agent_review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_pr_id INTEGER NOT NULL,
    review_session_key TEXT NOT NULL,
    comment_type TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    side TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    opencode_session_id TEXT,
    raw_agent_output TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (review_pr_id) REFERENCES review_prs(id)
);
CREATE INDEX IF NOT EXISTS idx_agent_review_comments_pr ON agent_review_comments(review_pr_id);
CREATE INDEX IF NOT EXISTS idx_agent_review_comments_session ON agent_review_comments(review_session_key);
            "#,
    ),
    M::up_with_hook("", |tx| {
        let has_column: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'plan_text'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if has_column {
            tx.execute("ALTER TABLE tasks DROP COLUMN plan_text", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    M::up_with_hook("", |tx| {
        let has_prompt: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'prompt'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_prompt {
            tx.execute("ALTER TABLE tasks ADD COLUMN prompt TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        let has_summary: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'summary'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_summary {
            tx.execute("ALTER TABLE tasks ADD COLUMN summary TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        tx.execute("UPDATE tasks SET prompt = title WHERE prompt IS NULL", [])
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        Ok(())
    }),
    M::up_with_hook(r#""#, |tx| {
        let config_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if config_exists {
            tx.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES ('task_id_prefix', '')",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;

            use rand::Rng;
            let mut rng = rand::thread_rng();
            let prefix: String = (0..3)
                .map(|_| {
                    let idx = rng.gen_range(0..26);
                    (b'A' + idx as u8) as char
                })
                .collect();

            tx.execute(
                "UPDATE config SET value = ?1 WHERE key = 'task_id_prefix' AND value = ''",
                rusqlite::params![prefix],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    M::up_with_hook("", |tx| {
        let has_agent: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'agent'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_agent {
            tx.execute("ALTER TABLE tasks ADD COLUMN agent TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        let has_permission_mode: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'permission_mode'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
        if !has_permission_mode {
            tx.execute("ALTER TABLE tasks ADD COLUMN permission_mode TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    // V9: Copy global ai_provider to all existing projects' project_config
    M::up_with_hook("", |tx| {
        let has_table: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
                [],
                |r| r.get(0),
            ).unwrap_or(false);

        if has_table {
            let global_provider: String = tx
                .query_row(
                    "SELECT value FROM config WHERE key = 'ai_provider'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "claude-code".to_string());

            tx.execute(
                "INSERT OR IGNORE INTO project_config (project_id, key, value)
                     SELECT id, 'ai_provider', ?1 FROM projects",
                rusqlite::params![global_provider],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    // V10: Add draft column to pull_requests
    M::up_with_hook("", |tx| {
        let table_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='pull_requests'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
        if table_exists {
            let has_draft: bool = tx
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'draft'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);
            if !has_draft {
                tx.execute(
                    "ALTER TABLE pull_requests ADD COLUMN draft INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
    // V11: Drop unused agent_logs table
    M::up("DROP TABLE IF EXISTS agent_logs;"),
    // V12: Rename tasks.title → tasks.initial_prompt
    M::up("ALTER TABLE tasks RENAME COLUMN title TO initial_prompt;"),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS authored_prs (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL,
    draft INTEGER NOT NULL DEFAULT 0,
    html_url TEXT NOT NULL,
    user_login TEXT NOT NULL,
    user_avatar_url TEXT,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    head_ref TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    changed_files INTEGER NOT NULL DEFAULT 0,
    ci_status TEXT,
    ci_check_runs TEXT,
    review_status TEXT,
    mergeable INTEGER,
    mergeable_state TEXT,
    merged_at INTEGER,
    task_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_authored_prs_updated_at ON authored_prs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_authored_prs_repo ON authored_prs(repo_owner, repo_name);
CREATE INDEX IF NOT EXISTS idx_authored_prs_state ON authored_prs(state);

CREATE TABLE IF NOT EXISTS shepherd_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_context TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_shepherd_messages_project_created ON shepherd_messages(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shepherd',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_action_items_project_status ON action_items(project_id, status);
            "#,
    ),
    // V14: Add is_queued for merge queue detection
    M::up(
        "ALTER TABLE pull_requests ADD COLUMN is_queued INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE authored_prs ADD COLUMN is_queued INTEGER NOT NULL DEFAULT 0;",
    ),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shepherd',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_action_items_project_status ON action_items(project_id, status);
            "#,
    ),
    // V16: Backfill shepherd_messages for databases where V13 ran before it was added.
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS shepherd_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_context TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_shepherd_messages_project_created ON shepherd_messages(project_id, created_at DESC);
            "#,
    ),
    M::up_with_hook("SELECT 1;", |tx| {
        for (table, column, sql) in [
            (
                "pull_requests",
                "mergeable",
                "ALTER TABLE pull_requests ADD COLUMN mergeable INTEGER",
            ),
            (
                "pull_requests",
                "mergeable_state",
                "ALTER TABLE pull_requests ADD COLUMN mergeable_state TEXT",
            ),
            (
                "review_prs",
                "mergeable",
                "ALTER TABLE review_prs ADD COLUMN mergeable INTEGER",
            ),
            (
                "review_prs",
                "mergeable_state",
                "ALTER TABLE review_prs ADD COLUMN mergeable_state TEXT",
            ),
            (
                "authored_prs",
                "mergeable",
                "ALTER TABLE authored_prs ADD COLUMN mergeable INTEGER",
            ),
            (
                "authored_prs",
                "mergeable_state",
                "ALTER TABLE authored_prs ADD COLUMN mergeable_state TEXT",
            ),
        ] {
            let has_table: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                        table
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if !has_table {
                continue;
            }

            let exists: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = '{}'",
                        table, column
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if !exists {
                tx.execute(sql, [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }

        Ok(())
    }),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS task_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id),
    workspace_path TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    branch_name TEXT,
    provider_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_workspaces_status ON task_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_task_workspaces_project ON task_workspaces(project_id, updated_at DESC);
            "#,
    ),
    M::up_with_hook("SELECT 1;", |tx| {
        let has_tasks_table: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if has_tasks_table {
            for column in [
                "jira_key",
                "jira_title",
                "jira_status",
                "jira_assignee",
                "jira_description",
            ] {
                let exists: bool = tx
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                            column
                        ),
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);
                if exists {
                    tx.execute(&format!("ALTER TABLE tasks DROP COLUMN {}", column), [])
                        .map_err(rusqlite_migration::HookError::RusqliteError)?;
                }
            }
        }

        let has_config_table: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if has_config_table {
            tx.execute(
                    "DELETE FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        let has_project_config_table: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
        if has_project_config_table {
            tx.execute(
                    "DELETE FROM project_config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    api_version INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',
    contributes TEXT NOT NULL DEFAULT '{}',
    frontend_entry TEXT NOT NULL,
    backend_entry TEXT,
    install_path TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'legacy',
    source_spec TEXT NOT NULL DEFAULT '',
    package_metadata TEXT NOT NULL DEFAULT '{}',
    installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    is_builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_plugins (
    project_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (project_id, plugin_id),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
        "#,
    ),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
        "#,
    ),
    M::up_with_hook("", |tx| {
        let has_config_table: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if has_config_table {
            tx.execute(
                "UPDATE config SET value = '60' WHERE key = 'github_poll_interval' AND value = '15'",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS plugin_storage (
    plugin_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project', 'task')),
    scope_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (plugin_id, scope, scope_id, key),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
        "#,
    ),
    M::up_with_hook("", |tx| {
        let table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if !table_exists {
            return Ok(());
        }

        let has_pi_session_id: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('agent_sessions') WHERE name = 'pi_session_id'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if !has_pi_session_id {
            tx.execute(
                "ALTER TABLE agent_sessions ADD COLUMN pi_session_id TEXT",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    M::up_with_hook("SELECT 1;", |tx| {
        fn table_exists(tx: &rusqlite::Transaction<'_>, table: &str) -> bool {
            tx.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .unwrap_or(false)
        }

        fn column_exists(tx: &rusqlite::Transaction<'_>, table: &str, column: &str) -> bool {
            tx.query_row(
                &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = ?1"),
                [column],
                |row| row.get(0),
            )
            .unwrap_or(false)
        }

        fn drop_column_if_exists(
            tx: &rusqlite::Transaction<'_>,
            table: &str,
            column: &str,
        ) -> std::result::Result<(), rusqlite_migration::HookError> {
            if table_exists(tx, table) && column_exists(tx, table, column) {
                tx.execute(&format!("ALTER TABLE {table} DROP COLUMN {column}"), [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
            Ok(())
        }

        drop_column_if_exists(tx, "worktrees", "opencode_port")?;
        drop_column_if_exists(tx, "worktrees", "opencode_pid")?;
        drop_column_if_exists(tx, "task_workspaces", "opencode_port")?;

        Ok(())
    }),
    M::up_with_hook("SELECT 1;", |tx| {
        let has_plugin_storage: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='plugin_storage'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_plugin_storage {
            return Ok(());
        }

        let has_scope_column: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('plugin_storage') WHERE name='scope'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if has_scope_column {
            return Ok(());
        }

        tx.execute_batch(
            r#"
ALTER TABLE plugin_storage RENAME TO plugin_storage_legacy;
CREATE TABLE plugin_storage (
    plugin_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project', 'task')),
    scope_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (plugin_id, scope, scope_id, key),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
INSERT OR REPLACE INTO plugin_storage (plugin_id, scope, scope_id, key, value)
SELECT plugin_id, 'global', '', key, json_quote(value) FROM plugin_storage_legacy;
DROP TABLE plugin_storage_legacy;
            "#,
        )
        .map_err(rusqlite_migration::HookError::RusqliteError)?;

        Ok(())
    }),
    M::up_with_hook("SELECT 1;", |tx| {
        let table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !table_exists {
            return Ok(());
        }

        let has_pty_instance_id: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('agent_sessions') WHERE name = 'pty_instance_id'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_pty_instance_id {
            tx.execute(
                "ALTER TABLE agent_sessions ADD COLUMN pty_instance_id INTEGER",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        let legacy_checkpoint_rows = {
            let mut stmt = tx
                .prepare("SELECT id, checkpoint_data FROM agent_sessions WHERE checkpoint_data IS NOT NULL")
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            let mut legacy_checkpoint_rows = Vec::new();
            for row in rows {
                legacy_checkpoint_rows
                    .push(row.map_err(rusqlite_migration::HookError::RusqliteError)?);
            }
            legacy_checkpoint_rows
        };

        for (session_id, checkpoint_data) in legacy_checkpoint_rows {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&checkpoint_data) else {
                continue;
            };
            let Some(object) = value.as_object() else {
                continue;
            };
            let pty_instance_id = object
                .get("pty_instance_id")
                .or_else(|| object.get("ptyInstanceId"))
                .and_then(|value| value.as_u64())
                .and_then(|value| i64::try_from(value).ok());
            let Some(pty_instance_id) = pty_instance_id else {
                continue;
            };
            let metadata_only = object
                .keys()
                .all(|key| key == "pty_instance_id" || key == "ptyInstanceId");

            if metadata_only {
                tx.execute(
                    "UPDATE agent_sessions SET pty_instance_id = COALESCE(pty_instance_id, ?1), checkpoint_data = NULL WHERE id = ?2",
                    rusqlite::params![pty_instance_id, session_id],
                )
            } else {
                tx.execute(
                    "UPDATE agent_sessions SET pty_instance_id = COALESCE(pty_instance_id, ?1) WHERE id = ?2",
                    rusqlite::params![pty_instance_id, session_id],
                )
            }
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        Ok(())
    }),
    // Editable display title, decoupled from the prompt so it can be renamed at any
    // status. NULL means "no explicit title" and the UI falls back to the prompt.
    // Idempotent because some legacy fixtures/databases still carry a `title` column.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists {
            return Ok(());
        }

        let has_title: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'title'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_title {
            tx.execute("ALTER TABLE tasks ADD COLUMN title TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        for (column, sql) in [
            (
                "title_source",
                "ALTER TABLE tasks ADD COLUMN title_source TEXT",
            ),
            (
                "title_generated_at",
                "ALTER TABLE tasks ADD COLUMN title_generated_at INTEGER",
            ),
        ] {
            let exists: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                        column
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !exists {
                tx.execute(sql, [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }

        tx.execute(
            "UPDATE tasks SET title_source = 'manual' WHERE title IS NOT NULL AND TRIM(title) != '' AND title_source IS NULL",
            [],
        )
        .map_err(rusqlite_migration::HookError::RusqliteError)?;
        Ok(())
    }),
    // Persist how a task's git worktree should be created. NULL preserves the
    // legacy/default behavior: create an OpenForge task branch from latest main.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists {
            return Ok(());
        }

        for column in ["worktree_source", "worktree_branch"] {
            let exists: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                        column
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !exists {
                tx.execute(&format!("ALTER TABLE tasks ADD COLUMN {} TEXT", column), [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
    // Roadmap board: per-project local app-state for the Roadmap rail view.
    // GitHub remains the source of truth for issues/labels; only per-issue value
    // and the curated column-label ordering are persisted locally.
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS roadmap_item_value (
    project_id   TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    value        INTEGER CHECK (value IS NULL OR (value BETWEEN 1 AND 10)),
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, issue_number),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS roadmap_repo_config (
    project_id     TEXT PRIMARY KEY,
    column_labels  TEXT NOT NULL DEFAULT '[]',
    last_opened_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
        "#,
    ),
    // Per-task opt-out of the OpenForge handoff-notes (task management) prompt
    // block. Defaults to 1 (enabled) so existing tasks keep their current
    // behavior; the create dialog can set it to 0 to omit the block at start.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists {
            return Ok(());
        }

        let has_column: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'handoff_notes_enabled'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_column {
            tx.execute(
                "ALTER TABLE tasks ADD COLUMN handoff_notes_enabled INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    // Backward compatibility for databases that already had per-task
    // `handoff_notes_enabled`: preserve their prompt behavior by migrating that
    // opinionated workflow into the generic start-prompt contribution config.
    // New projects remain opt-in until a trusted plugin configures a contribution.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let project_config_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists || !project_config_table_exists {
            return Ok(());
        }

        let has_column: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'handoff_notes_enabled'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if has_column {
            backfill_handoff_notes_start_prompt_contributions(tx)
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    // Add a nullable `labels` JSON-TEXT column to the PR tables so each cached
    // PR can carry its GitHub labels (serialized array of {name, color}).
    // Mirrors the existing nullable-JSON-TEXT `ci_check_runs` pattern. Additive
    // and idempotent so it heals databases regardless of prior state.
    M::up_with_hook("", |tx| {
        for table in ["pull_requests", "review_prs", "authored_prs"] {
            let has_table: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                        table
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_table {
                continue;
            }

            let has_labels: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = 'labels'",
                        table
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_labels {
                tx.execute(&format!("ALTER TABLE {} ADD COLUMN labels TEXT", table), [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
    // Persist PR merge readiness decisions and the raw GitHub facts that produced
    // them. Guarded so pre-existing or manually healed databases keep their rows.
    M::up_with_hook("", |tx| {
        let table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='pull_requests'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !table_exists {
            return Ok(());
        }

        for (column, sql) in pull_request_readiness_columns() {
            let exists: bool = tx
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = '{}'",
                        column
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !exists {
                tx.execute(sql, [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
    // Durable lifecycle evidence for the authoritative "never started" prompt-edit guard.
    // Once set, this timestamp is never cleared even if a task returns to backlog or
    // execution-session rows are cleaned up.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists {
            return Ok(());
        }

        let column_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'execution_started_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !column_exists {
            tx.execute(
                "ALTER TABLE tasks ADD COLUMN execution_started_at INTEGER",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }

        let sessions_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if sessions_table_exists {
            tx.execute(
                "UPDATE tasks
                 SET execution_started_at = COALESCE(
                     (SELECT MIN(created_at) FROM agent_sessions WHERE ticket_id = tasks.id),
                     CAST(strftime('%s', 'now') AS INTEGER)
                 )
                 WHERE execution_started_at IS NULL
                   AND (
                     status != 'backlog'
                     OR EXISTS (SELECT 1 FROM agent_sessions WHERE ticket_id = tasks.id)
                   )",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        } else {
            tx.execute(
                "UPDATE tasks
                 SET execution_started_at = CAST(strftime('%s', 'now') AS INTEGER)
                 WHERE execution_started_at IS NULL AND status != 'backlog'",
                [],
            )
            .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    // Internal task labels no longer expose or store presentation colors.
    M::up_with_hook("", |tx| {
        let table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='task_labels'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !table_exists {
            return Ok(());
        }

        let has_color: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('task_labels') WHERE name = 'color'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if has_color {
            tx.execute("ALTER TABLE task_labels DROP COLUMN color", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    // Add a nullable `source_ticket_url` column so a task can link back to the
    // source ticket it originated from (e.g. a GitHub issue or Jira browse URL).
    // Additive and idempotent so it heals databases regardless of prior state.
    M::up_with_hook("", |tx| {
        let tasks_table_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !tasks_table_exists {
            return Ok(());
        }

        let has_column: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'source_ticket_url'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !has_column {
            tx.execute("ALTER TABLE tasks ADD COLUMN source_ticket_url TEXT", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
        }
        Ok(())
    }),
    M::up(
        "CREATE TABLE IF NOT EXISTS task_config (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            UNIQUE(task_id, key)
        );
        CREATE TABLE IF NOT EXISTS global_plugins (
            plugin_id TEXT PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
            enabled INTEGER NOT NULL DEFAULT 1
        );",
    ),
    // Personal, machine-global reusable text snippets shown in the Injectable
    // Picker. Unlike skills/commands (file-scanned), snippets are not per-project
    // and not file-backed; they live only here and insert their literal `body`.
    // Appended last so it takes the highest user_version after the merge.
    M::up(
        r#"
CREATE TABLE IF NOT EXISTS snippets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
        "#,
    ),
    // Per-snippet project scoping: an `all_projects` flag (default 1 = visible
    // everywhere, including projects created later) plus a join table for the
    // explicit project subset. Existing snippets keep all_projects=1. Guarded so it
    // is idempotent and heals partially-migrated databases (matches the sibling
    // column-add migrations).
    M::up_with_hook("", |tx| {
        let snippets_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='snippets'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if snippets_exists {
            let has_all_projects: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('snippets') WHERE name = 'all_projects'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_all_projects {
                tx.execute(
                    "ALTER TABLE snippets ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 1",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        tx.execute(
            "CREATE TABLE IF NOT EXISTS snippet_projects (
                snippet_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                PRIMARY KEY (snippet_id, project_id),
                FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(rusqlite_migration::HookError::RusqliteError)?;
        Ok(())
    }),
    // Injectable/snippet picker moved to the external com.openforge.injectables
    // plugin, which persists snippets to the filesystem. Drop the now-unused DB
    // tables. New migration (never edit/delete the CREATE migrations above — that
    // lowers LATEST_USER_VERSION and triggers DatabaseTooFarAhead).
    M::up("DROP TABLE IF EXISTS snippet_projects; DROP TABLE IF EXISTS snippets;"),
    // The skills-viewer builtin was replaced by the external com.openforge.injectables
    // plugin and removed from the builtin catalog, but existing databases still carry its
    // install rows — which resolve as an enabled builtin whose files no longer exist.
    // Purge them. Children first: FK enforcement (ON DELETE CASCADE) is not guaranteed
    // to be enabled while migrations run. Each table is existence-guarded because a
    // database replaying from an older version may not have the plugin tables yet.
    M::up_with_hook("", |tx| {
        let table_exists = |name: &str| -> bool {
            tx.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .unwrap_or(false)
        };
        // If the plugin registry itself was never created in this database's migration
        // history there is nothing to purge — and deleting from the child tables would
        // fail anyway, since their FK resolves against the missing `plugins` parent.
        if !table_exists("plugins") {
            return Ok(());
        }
        for (table, column) in [
            ("plugin_storage", "plugin_id"),
            ("project_plugins", "plugin_id"),
            ("plugins", "id"),
        ] {
            if table_exists(table) {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE {column} = 'com.openforge.skills-viewer'"),
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
    // The Roadmap board became the external com.openforge.issues plugin, which
    // resolves its repo from GitHub and keeps the per-issue value and the curated
    // column order in project-scoped plugin storage. Drop the tables that state
    // used to live in. New migration — never edit or delete the CREATE migrations
    // above, which would lower LATEST_USER_VERSION and trigger DatabaseTooFarAhead.
    M::up("DROP TABLE IF EXISTS roadmap_item_value; DROP TABLE IF EXISTS roadmap_repo_config;"),
    // Same story as skills-viewer above: roadmap left the builtin catalog, but
    // existing databases still carry its install rows, which would resolve as an
    // enabled builtin whose directory no longer exists. Purge them. Children first,
    // since FK enforcement is not guaranteed to be on while migrations run, and each
    // table is existence-guarded for databases replaying from an older version.
    M::up_with_hook("", |tx| {
        let table_exists = |name: &str| -> bool {
            tx.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .unwrap_or(false)
        };
        if !table_exists("plugins") {
            return Ok(());
        }
        for (table, column) in [
            ("plugin_storage", "plugin_id"),
            ("project_plugins", "plugin_id"),
            ("plugins", "id"),
        ] {
            if table_exists(table) {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE {column} = 'com.openforge.roadmap'"),
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
        }
        Ok(())
    }),
);

/// Detects existing databases (created before the migration system) and sets
/// user_version to skip V1 migration (which would be a no-op anyway since
/// tables already exist with IF NOT EXISTS).
pub(super) fn bootstrap_existing_db(conn: &Connection) -> Result<()> {
    let uv: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if uv == 0 {
        let has_tasks: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
            [],
            |r| r.get(0),
        )?;
        if has_tasks {
            conn.execute("PRAGMA user_version = 1", [])?;
        }
    }
    Ok(())
}

pub(super) fn ensure_tasks_columns(conn: &Connection) -> Result<()> {
    let has_tasks: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
        [],
        |r| r.get(0),
    )?;
    if !has_tasks {
        return Ok(());
    }

    for (col, backfill) in [
        ("prompt", true),
        ("summary", false),
        ("agent", false),
        ("permission_mode", false),
        ("worktree_source", false),
        ("worktree_branch", false),
        ("title", false),
        ("title_source", false),
        ("source_ticket_url", false),
    ] {
        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                col
            ),
            [],
            |r| r.get(0),
        )?;
        if !exists {
            conn.execute(&format!("ALTER TABLE tasks ADD COLUMN {} TEXT", col), [])?;
            if backfill {
                conn.execute(
                    "UPDATE tasks SET prompt = initial_prompt WHERE prompt IS NULL",
                    [],
                )?;
            }
        }
    }

    let title_generated_at_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'title_generated_at'",
        [],
        |r| r.get(0),
    )?;
    if !title_generated_at_exists {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN title_generated_at INTEGER",
            [],
        )?;
    }
    let execution_started_at_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'execution_started_at'",
        [],
        |row| row.get(0),
    )?;
    if !execution_started_at_exists {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN execution_started_at INTEGER",
            [],
        )?;
        let status_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'status'",
            [],
            |row| row.get(0),
        )?;
        if !status_exists {
            return Ok(());
        }
        let sessions_table_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
            [],
            |row| row.get(0),
        )?;
        if sessions_table_exists {
            conn.execute(
                "UPDATE tasks
                 SET execution_started_at = COALESCE(
                     (SELECT MIN(created_at) FROM agent_sessions WHERE ticket_id = tasks.id),
                     CAST(strftime('%s', 'now') AS INTEGER)
                 )
                 WHERE status != 'backlog'
                    OR EXISTS (SELECT 1 FROM agent_sessions WHERE ticket_id = tasks.id)",
                [],
            )?;
        } else {
            conn.execute(
                "UPDATE tasks
                 SET execution_started_at = CAST(strftime('%s', 'now') AS INTEGER)
                 WHERE status != 'backlog'",
                [],
            )?;
        }
    }
    Ok(())
}

pub(super) fn ensure_pr_number_column(conn: &Connection) -> Result<()> {
    let has_pull_requests: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='pull_requests'",
        [],
        |r| r.get(0),
    )?;
    if !has_pull_requests {
        return Ok(());
    }

    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'pr_number'",
        [],
        |r| r.get(0),
    )?;
    if !exists {
        conn.execute(
            "ALTER TABLE pull_requests ADD COLUMN pr_number INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute(
            "UPDATE pull_requests SET pr_number = id WHERE pr_number = 0",
            [],
        )?;
    }
    Ok(())
}

pub(super) fn ensure_mergeability_columns(conn: &Connection) -> Result<()> {
    for (table, column, sql) in [
        (
            "pull_requests",
            "mergeable",
            "ALTER TABLE pull_requests ADD COLUMN mergeable INTEGER",
        ),
        (
            "pull_requests",
            "mergeable_state",
            "ALTER TABLE pull_requests ADD COLUMN mergeable_state TEXT",
        ),
        (
            "review_prs",
            "mergeable",
            "ALTER TABLE review_prs ADD COLUMN mergeable INTEGER",
        ),
        (
            "review_prs",
            "mergeable_state",
            "ALTER TABLE review_prs ADD COLUMN mergeable_state TEXT",
        ),
        (
            "authored_prs",
            "mergeable",
            "ALTER TABLE authored_prs ADD COLUMN mergeable INTEGER",
        ),
        (
            "authored_prs",
            "mergeable_state",
            "ALTER TABLE authored_prs ADD COLUMN mergeable_state TEXT",
        ),
    ] {
        let has_table: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !has_table {
            continue;
        }

        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = '{}'",
                table, column
            ),
            [],
            |r| r.get(0),
        )?;

        if !exists {
            conn.execute(sql, [])?;
        }
    }

    Ok(())
}

/// Column definitions for persisted PR merge readiness and raw GitHub readiness facts.
fn pull_request_readiness_columns() -> [(&'static str, &'static str); 11] {
    [
        (
            "merge_readiness_status",
            "ALTER TABLE pull_requests ADD COLUMN merge_readiness_status TEXT",
        ),
        (
            "merge_readiness_action",
            "ALTER TABLE pull_requests ADD COLUMN merge_readiness_action TEXT",
        ),
        (
            "merge_readiness_blockers",
            "ALTER TABLE pull_requests ADD COLUMN merge_readiness_blockers TEXT",
        ),
        (
            "merge_readiness_warnings",
            "ALTER TABLE pull_requests ADD COLUMN merge_readiness_warnings TEXT",
        ),
        (
            "readiness_source_head_sha",
            "ALTER TABLE pull_requests ADD COLUMN readiness_source_head_sha TEXT",
        ),
        (
            "merge_group_sha",
            "ALTER TABLE pull_requests ADD COLUMN merge_group_sha TEXT",
        ),
        (
            "required_checks_policy_known",
            "ALTER TABLE pull_requests ADD COLUMN required_checks_policy_known INTEGER",
        ),
        (
            "required_reviews_policy_known",
            "ALTER TABLE pull_requests ADD COLUMN required_reviews_policy_known INTEGER",
        ),
        (
            "merge_queue_required",
            "ALTER TABLE pull_requests ADD COLUMN merge_queue_required INTEGER",
        ),
        (
            "merge_queue_state",
            "ALTER TABLE pull_requests ADD COLUMN merge_queue_state TEXT",
        ),
        (
            "readiness_updated_at",
            "ALTER TABLE pull_requests ADD COLUMN readiness_updated_at INTEGER",
        ),
    ]
}

pub(super) fn ensure_is_queued_columns(conn: &Connection) -> Result<()> {
    for table in ["pull_requests", "authored_prs"] {
        let has_table: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !has_table {
            continue;
        }

        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = 'is_queued'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !exists {
            conn.execute(
                &format!(
                    "ALTER TABLE {} ADD COLUMN is_queued INTEGER NOT NULL DEFAULT 0",
                    table
                ),
                [],
            )?;
        }
    }

    Ok(())
}

/// Backfills the nullable `labels` JSON-TEXT column on the PR tables for
/// databases that were already migrated past the (mid-list) column-adding
/// migration, which `rusqlite_migration` skips once `user_version` is beyond
/// it. Idempotent and version-independent, so it heals existing databases on
/// startup. Mirrors [`ensure_is_queued_columns`].
pub(super) fn ensure_labels_columns(conn: &Connection) -> Result<()> {
    for table in ["pull_requests", "review_prs", "authored_prs"] {
        let has_table: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !has_table {
            continue;
        }

        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = 'labels'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !exists {
            conn.execute(&format!("ALTER TABLE {} ADD COLUMN labels TEXT", table), [])?;
        }
    }

    Ok(())
}
fn legacy_handoff_notes_contribution_json(project_template: Option<&str>) -> Result<String> {
    let contribution = crate::agent_lifecycle::StartPromptContribution {
        id: crate::agent_lifecycle::HANDOFF_NOTES_WORKFLOW_CONTRIBUTION_ID.to_string(),
        enabled: true,
        content: crate::agent_lifecycle::legacy_handoff_notes_start_prompt_content(
            project_template,
        ),
        order: 0,
    };
    serde_json::to_string(&vec![contribution])
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn refresh_legacy_handoff_notes_workflow_content(content: &str) -> Option<String> {
    let old_default_template = "## Current summary\nBrief status of what changed and whether the task is ready for review.";
    let new_default_template = "## Summary\nBrief accumulated summary of what changed and whether the task is ready for review.";
    let old_example = "Good: \"## Current summary\\nScoped JWT refresh token rotation in auth middleware\\n\\n## Decisions made\\nKept rotation inside existing auth middleware.\"";
    let new_example = "Good: \"## Summary\\nScoped JWT refresh token rotation in auth middleware\\n\\n## Decisions made\\nKept rotation inside existing auth middleware.\"";
    let old_summary_update = "Replace the task's Handoff Notes with an accurate, up-to-date reviewer brief using the active template. Cover the active template's requested sections, including current status, decisions made, open questions, and follow-up tasks when applicable. Keep it current rather than appending run history.";
    let new_summary_update = "Update the task's Handoff Notes with an accurate, up-to-date reviewer brief using the active template. Preserve useful existing Summary context while adding new information, decisions, open questions, and follow-up tasks; do not discard earlier relevant work just to make the note \"current\".";

    if !content.contains(old_default_template)
        && !content.contains(old_example)
        && !content.contains(old_summary_update)
    {
        return None;
    }

    let updated = content
        .replace(old_default_template, new_default_template)
        .replace(old_example, new_example)
        .replace(old_summary_update, new_summary_update);

    (updated != content).then_some(updated)
}

fn refresh_legacy_handoff_notes_start_prompt_contributions(conn: &Connection) -> Result<()> {
    let mut statement = conn.prepare(
        "SELECT project_id, value
         FROM project_config
         WHERE key = ?1",
    )?;
    let rows = statement
        .query_map(
            [crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?
        .collect::<Result<Vec<_>>>()?;

    for (project_id, value) in rows {
        let Ok(mut contributions) =
            serde_json::from_str::<Vec<crate::agent_lifecycle::StartPromptContribution>>(&value)
        else {
            continue;
        };

        let mut changed = false;
        for contribution in &mut contributions {
            if contribution.id == crate::agent_lifecycle::HANDOFF_NOTES_WORKFLOW_CONTRIBUTION_ID {
                if let Some(updated_content) =
                    refresh_legacy_handoff_notes_workflow_content(&contribution.content)
                {
                    contribution.content = updated_content;
                    changed = true;
                }
            }
        }

        if changed {
            let serialized = serde_json::to_string(&contributions)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            conn.execute(
                "UPDATE project_config SET value = ?1 WHERE project_id = ?2 AND key = ?3",
                rusqlite::params![
                    serialized,
                    project_id,
                    crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
                ],
            )?;
        }
    }

    Ok(())
}
fn backfill_handoff_notes_start_prompt_contributions(conn: &Connection) -> Result<()> {
    let mut statement = conn.prepare(
        "SELECT DISTINCT project_id
         FROM tasks
         WHERE handoff_notes_enabled = 1 AND project_id IS NOT NULL AND project_id != ''",
    )?;
    let project_ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;

    for project_id in project_ids {
        let template = conn
            .query_row(
                "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'handoff_notes_template'",
                [&project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let contribution_json = legacy_handoff_notes_contribution_json(template.as_deref())?;
        conn.execute(
            "INSERT OR IGNORE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &project_id,
                crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
                contribution_json
            ],
        )?;
    }

    Ok(())
}

pub(super) fn ensure_handoff_notes_workflow_backfill(conn: &Connection) -> Result<()> {
    let tasks_table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
        [],
        |row| row.get(0),
    )?;
    let project_config_table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
        [],
        |row| row.get(0),
    )?;
    let config_table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
        [],
        |row| row.get(0),
    )?;
    if !tasks_table_exists || !project_config_table_exists || !config_table_exists {
        return Ok(());
    }

    refresh_legacy_handoff_notes_start_prompt_contributions(conn)?;
    let already_applied = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'start_prompt_contributions_backfill_applied'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(|value| value == "true")
        .unwrap_or(false);
    if already_applied {
        return Ok(());
    }

    let has_column: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'handoff_notes_enabled'",
        [],
        |row| row.get(0),
    )?;
    if has_column {
        backfill_handoff_notes_start_prompt_contributions(conn)?;
    }
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('start_prompt_contributions_backfill_applied', 'true')",
        [],
    )?;

    Ok(())
}

pub(super) fn ensure_pull_request_readiness_columns(conn: &Connection) -> Result<()> {
    let has_table: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='pull_requests'",
        [],
        |r| r.get(0),
    )?;

    if !has_table {
        return Ok(());
    }

    for (column, sql) in pull_request_readiness_columns() {
        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = '{}'",
                column
            ),
            [],
            |r| r.get(0),
        )?;

        if !exists {
            conn.execute(sql, [])?;
        }
    }

    Ok(())
}

pub(super) fn ensure_task_dependency_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
        "#,
    )?;

    Ok(())
}

pub(super) fn ensure_task_label_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS task_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, name_normalized)
);
CREATE INDEX IF NOT EXISTS idx_task_labels_project ON task_labels(project_id, name_normalized);

CREATE TABLE IF NOT EXISTS task_label_assignments (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_task_label_assignments_task ON task_label_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_label_assignments_label ON task_label_assignments(label_id);
        "#,
    )?;
    Ok(())
}

/// Recreate the hierarchy tables added alongside the plugin tables. Kept here (rather
/// than relying solely on their migration) because a database can carry a
/// user_version that already covers them while the tables themselves are absent —
/// e.g. one migrated on a branch that appended its own migrations before these
/// existed, so the positional indexes no longer line up. Without this, every
/// enabled-plugins query fails with "no such table: global_plugins".
pub(super) fn ensure_hierarchy_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS task_config (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(task_id, key)
);
CREATE TABLE IF NOT EXISTS global_plugins (
    plugin_id TEXT PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1
);
        "#,
    )?;
    Ok(())
}

pub(super) fn ensure_plugin_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    api_version INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',
    contributes TEXT NOT NULL DEFAULT '{}',
    frontend_entry TEXT NOT NULL,
    backend_entry TEXT,
    install_path TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'legacy',
    source_spec TEXT NOT NULL DEFAULT '',
    package_metadata TEXT NOT NULL DEFAULT '{}',
    installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    is_builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_plugins (
    project_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (project_id, plugin_id),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plugin_storage (
    plugin_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project', 'task')),
    scope_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (plugin_id, scope, scope_id, key),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
         "#,
    )?;

    for (column, sql) in [
        (
            "source_kind",
            "ALTER TABLE plugins ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy'",
        ),
        (
            "source_spec",
            "ALTER TABLE plugins ADD COLUMN source_spec TEXT NOT NULL DEFAULT ''",
        ),
        (
            "package_metadata",
            "ALTER TABLE plugins ADD COLUMN package_metadata TEXT NOT NULL DEFAULT '{}'",
        ),
    ] {
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('plugins') WHERE name = ?1",
            [column],
            |row| row.get(0),
        )?;
        if !exists {
            conn.execute(sql, [])?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::fs;
    use std::path::PathBuf;

    #[derive(Clone, Copy)]
    enum MigrationBoundary {
        GithubPollIntervalDefaultUpdate,
        LegacyOpencodeServerColumnRemoval,
        PluginStorageScopedKeyMigration,
        AgentSessionPtyInstanceBackfill,
    }

    impl MigrationBoundary {
        fn user_version_before(self) -> i32 {
            // Fixed user_version values immediately before each target migration.
            // Keep these pinned to the migration boundary being exercised; do not
            // derive them from LATEST_USER_VERSION, or appending a migration could
            // silently move legacy-upgrade fixtures into the wrong migration window.
            match self {
                Self::GithubPollIntervalDefaultUpdate => 21,
                Self::LegacyOpencodeServerColumnRemoval => 24,
                Self::PluginStorageScopedKeyMigration => 25,
                Self::AgentSessionPtyInstanceBackfill => 26,
            }
        }
    }

    fn set_user_version_before(conn: &Connection, boundary: MigrationBoundary) {
        let user_version = boundary.user_version_before();
        conn.execute(&format!("PRAGMA user_version = {user_version}"), [])
            .expect("set pre-migration user_version");
    }

    #[test]
    fn test_migrations_validate() {
        let migrations = get_migrations();
        migrations.validate().expect("migrations should be valid");
    }

    #[test]
    fn test_latest_user_version_matches_migration_count() {
        assert_eq!(
            LATEST_USER_VERSION,
            migration_count(),
            "LATEST_USER_VERSION must stay aligned with the number of declared migrations"
        );
    }

    #[test]
    fn test_task_config_and_global_plugins_tables_exist() {
        let (db, path) = crate::db::test_helpers::make_test_db("hier_tables");
        let conn = db.conn.lock().unwrap();
        let has = |name: &str| -> bool {
            conn.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(has("task_config"), "task_config table should exist");
        assert!(has("global_plugins"), "global_plugins table should exist");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_task_config_and_global_plugins_for_upgraded_db() {
        // A database whose recorded user_version already covers these migrations but
        // which is missing the tables (e.g. it was migrated on a branch that appended
        // its own migrations before these existed, so the indexes no longer line up)
        // must heal on open rather than failing every enabled-plugins query.
        let path = std::env::temp_dir().join(format!(
            "test_recreate_hier_tables_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(path.clone()).expect("Database::new");
            let conn = db.connection();
            let conn = conn.lock().unwrap();

            conn.execute("DROP TABLE global_plugins", [])
                .expect("drop global_plugins");
            conn.execute("DROP TABLE task_config", [])
                .expect("drop task_config");

            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .expect("read user_version");
            assert_eq!(
                uv, LATEST_USER_VERSION,
                "fixture should simulate an already-upgraded schema version"
            );
        }

        let db = Database::new(path.clone()).expect("Database::new should repair schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        for table in ["global_plugins", "task_config"] {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(exists, "{table} should be recreated on open");
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_sessions_pty_instance_migration_backfills_metadata_only_checkpoint() {
        let path = std::env::temp_dir().join(format!(
            "test_agent_session_pty_instance_backfill_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            set_user_version_before(&conn, MigrationBoundary::AgentSessionPtyInstanceBackfill);
            conn.execute(
                "CREATE TABLE agent_sessions (
                    id TEXT PRIMARY KEY,
                    checkpoint_data TEXT
                )",
                [],
            )
            .expect("create legacy agent_sessions table");
            conn.execute(
                "INSERT INTO agent_sessions (id, checkpoint_data) VALUES ('metadata-only', ?1)",
                [r#"{"pty_instance_id":42}"#],
            )
            .expect("insert metadata-only row");
            conn.execute(
                "INSERT INTO agent_sessions (id, checkpoint_data) VALUES ('prompt-payload', ?1)",
                [r#"{"pty_instance_id":43,"message":"Approve?"}"#],
            )
            .expect("insert prompt row");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let metadata_only: (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT pty_instance_id, checkpoint_data FROM agent_sessions WHERE id = 'metadata-only'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("metadata-only row migrated");
        assert_eq!(metadata_only, (Some(42), None));

        let prompt_payload: (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT pty_instance_id, checkpoint_data FROM agent_sessions WHERE id = 'prompt-payload'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("prompt row migrated");
        assert_eq!(prompt_payload.0, Some(43));
        assert_eq!(
            prompt_payload.1.as_deref(),
            Some(r#"{"pty_instance_id":43,"message":"Approve?"}"#)
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn test_plugin_storage_migration_preserves_legacy_strings_that_look_like_json() {
        let path = std::env::temp_dir().join(format!(
            "test_plugin_storage_legacy_json_literal_strings_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            set_user_version_before(&conn, MigrationBoundary::PluginStorageScopedKeyMigration);
            conn.execute("CREATE TABLE plugins (id TEXT PRIMARY KEY)", [])
                .expect("create legacy plugins table");
            conn.execute("INSERT INTO plugins (id) VALUES ('legacy-plugin')", [])
                .expect("insert legacy plugin row");
            conn.execute(
                "CREATE TABLE plugin_storage (
                    plugin_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    PRIMARY KEY (plugin_id, key)
                )",
                [],
            )
            .expect("create legacy plugin_storage");
            for (key, value) in [
                ("boolean", "true"),
                ("number", "123"),
                ("nullish", "null"),
                ("plain", "dark"),
            ] {
                conn.execute(
                    "INSERT INTO plugin_storage (plugin_id, key, value) VALUES ('legacy-plugin', ?1, ?2)",
                    [key, value],
                )
                .expect("insert legacy plugin storage row");
            }
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        for (key, expected) in [
            ("boolean", "true"),
            ("number", "123"),
            ("nullish", "null"),
            ("plain", "dark"),
        ] {
            let stored: String = conn
                .query_row(
                    "SELECT value FROM plugin_storage
                     WHERE plugin_id = 'legacy-plugin' AND scope = 'global' AND scope_id = '' AND key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .expect("legacy plugin storage row should be migrated");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&stored)
                    .expect("stored value should be JSON"),
                serde_json::Value::String(expected.to_string())
            );
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_pi_session_column_exists() {
        let path = std::env::temp_dir().join(format!(
            "test_pi_session_column_exists_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_pi_session_id: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('agent_sessions') WHERE name = 'pi_session_id'",
                [],
                |row| row.get(0),
            )
            .expect("check pi_session_id column");

        assert!(
            has_pi_session_id,
            "agent_sessions must include pi_session_id column"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_database_initialization() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_openforge_mig.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        // Create database
        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Verify tables exist by querying sqlite_master
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'agent_sessions', 'pull_requests', 'pr_comments', 'config', 'projects', 'project_config', 'worktrees', 'task_workspaces', 'review_prs', 'self_review_comments', 'agent_review_comments', 'authored_prs', 'shepherd_messages', 'action_items', 'plugins', 'project_plugins', 'plugin_storage')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count tables");

        assert_eq!(table_count, 18, "All 18 tables should be created");

        let config_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))
            .expect("Failed to count config rows");

        assert_eq!(
            config_count, 8,
            "Default config values and one-time migration markers should be inserted"
        );

        let jira_columns: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name IN ('jira_key', 'jira_title', 'jira_status', 'jira_assignee', 'jira_description')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count jira columns in tasks");
        assert_eq!(
            jira_columns, 0,
            "Fresh schema must not include jira columns in tasks table"
        );

        let jira_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count jira-related config keys");
        assert_eq!(
            jira_config_count, 0,
            "Fresh schema must not seed jira-related config"
        );

        let legacy_server_column_count: i32 = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM pragma_table_info('worktrees') WHERE name IN ('opencode_port', 'opencode_pid')) +
                    (SELECT COUNT(*) FROM pragma_table_info('task_workspaces') WHERE name = 'opencode_port')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count legacy OpenCode server columns");
        assert_eq!(
            legacy_server_column_count, 0,
            "Fresh schema must not include legacy OpenCode server port/pid columns"
        );

        // Clean up
        drop(conn);
        drop(db);
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn test_upgrade_removes_legacy_opencode_server_columns() {
        let path = std::env::temp_dir().join(format!(
            "test_upgrade_removes_legacy_opencode_server_columns_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            set_user_version_before(&conn, MigrationBoundary::LegacyOpencodeServerColumnRemoval);
            conn.execute_batch(
                "CREATE TABLE worktrees (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL UNIQUE,
                    project_id TEXT NOT NULL,
                    repo_path TEXT NOT NULL,
                    worktree_path TEXT NOT NULL,
                    branch_name TEXT NOT NULL,
                    opencode_port INTEGER,
                    opencode_pid INTEGER,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE task_workspaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL UNIQUE,
                    project_id TEXT NOT NULL,
                    workspace_path TEXT NOT NULL,
                    repo_path TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    branch_name TEXT,
                    provider_name TEXT NOT NULL,
                    opencode_port INTEGER,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );",
            )
            .expect("create legacy workspace tables");
            conn.execute(
                "INSERT INTO worktrees (task_id, project_id, repo_path, worktree_path, branch_name, opencode_port, opencode_pid, status, created_at, updated_at)
                 VALUES ('T-legacy', 'P-1', '/repo', '/repo/.worktrees/T-legacy', 'legacy-branch', 4312, 9876, 'active', 11, 22)",
                [],
            )
            .expect("insert legacy worktree");
            conn.execute(
                "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, opencode_port, status, created_at, updated_at)
                 VALUES ('T-legacy', 'P-1', '/repo/.worktrees/T-legacy', '/repo', 'git_worktree', 'legacy-branch', 'opencode', 4312, 'active', 11, 22)",
                [],
            )
            .expect("insert legacy task workspace");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let legacy_server_column_count: i32 = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM pragma_table_info('worktrees') WHERE name IN ('opencode_port', 'opencode_pid')) +
                    (SELECT COUNT(*) FROM pragma_table_info('task_workspaces') WHERE name = 'opencode_port')",
                [],
                |row| row.get(0),
            )
            .expect("count legacy OpenCode server columns");
        assert_eq!(
            legacy_server_column_count, 0,
            "Upgrade must remove legacy OpenCode server port/pid columns"
        );

        let preserved_worktree: (String, String, String, String, String, i64, i64) = conn
            .query_row(
                "SELECT task_id, project_id, repo_path, worktree_path, branch_name, created_at, updated_at FROM worktrees WHERE task_id = 'T-legacy'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
            )
            .expect("legacy worktree data should be preserved");
        assert_eq!(
            preserved_worktree,
            (
                "T-legacy".to_string(),
                "P-1".to_string(),
                "/repo".to_string(),
                "/repo/.worktrees/T-legacy".to_string(),
                "legacy-branch".to_string(),
                11,
                22,
            )
        );

        let preserved_workspace: (String, String, String, String, String, Option<String>, String, i64, i64) = conn
            .query_row(
                "SELECT task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, created_at, updated_at FROM task_workspaces WHERE task_id = 'T-legacy'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?)),
            )
            .expect("legacy task workspace data should be preserved");
        assert_eq!(
            preserved_workspace,
            (
                "T-legacy".to_string(),
                "P-1".to_string(),
                "/repo/.worktrees/T-legacy".to_string(),
                "/repo".to_string(),
                "git_worktree".to_string(),
                Some("legacy-branch".to_string()),
                "opencode".to_string(),
                11,
                22,
            )
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_copies_github_token_to_global() {
        let path = format!("/tmp/test_migration_copy_mig_{}.db", std::process::id());
        let _ = fs::remove_file(&path);

        // Simulate an existing database with project_config data (pre-migration)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            // Create minimal schema to simulate old database
            conn.execute(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            ).expect("create projects table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            ).expect("create project_config table");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            // Insert a project with credentials
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params!["proj-1", "Test Project", "/tmp/test", 1000, 1000],
            ).expect("insert project");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "github_token", "ghp_testtoken"],
            )
            .expect("insert github_token");
        }

        // Now open with Database::new() which will run the migration hook
        let db = Database::new(PathBuf::from(&path)).expect("Failed to open DB");

        assert_eq!(
            db.get_config("github_token").unwrap(),
            Some("ghp_testtoken".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_does_not_overwrite_existing_global() {
        let path = format!(
            "/tmp/test_migration_idempotent_mig_{}.db",
            std::process::id()
        );
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
            db.set_config("github_token", "existing-token")
                .expect("set");
            let project = db
                .create_project("Test Project", "/tmp/test")
                .expect("Failed to create project");
            db.set_project_config(&project.id, "github_token", "project-token")
                .expect("set");
        }

        let db = Database::new(PathBuf::from(&path)).expect("Failed to reopen DB");
        assert_eq!(
            db.get_config("github_token").unwrap(),
            Some("existing-token".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_indexes_created_on_migration() {
        let path = format!("/tmp/test_indexes_mig_{}.db", std::process::id());
        let _ = fs::remove_file(&path);

        let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Verify all 4 indexes exist in sqlite_master
        let index_names = vec![
            "idx_self_review_comments_task_archived",
            "idx_self_review_comments_task_round",
            "idx_review_prs_updated_at",
            "idx_review_prs_repo",
        ];

        for index_name in index_names {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    rusqlite::params![index_name],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to query sqlite_master");

            assert!(exists, "Index {} should exist", index_name);
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_bootstrap_existing_db() {
        let path =
            std::env::temp_dir().join(format!("test_bootstrap_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        // Create a raw database with the tasks table (simulating existing DB)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            ).expect("create tasks table");
            conn.execute(
                "CREATE TABLE pull_requests (
                    id INTEGER PRIMARY KEY,
                    ticket_id TEXT NOT NULL,
                    repo_owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    head_sha TEXT NOT NULL DEFAULT '',
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    last_polled_at INTEGER DEFAULT 0,
                    review_status TEXT,
                    merged_at INTEGER,
                    FOREIGN KEY (ticket_id) REFERENCES tasks(id)
                )",
                [],
            )
            .expect("create pull_requests table");
            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(uv, 0, "user_version should be 0 before bootstrap");
        }

        // Now open with Database::new() which should bootstrap
        let db = Database::new(path.clone()).expect("Database::new on existing db");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert!(
            uv >= 1,
            "user_version should be >= 1 after bootstrap, got {}",
            uv
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    /// The board moved to the external com.openforge.issues plugin, which keeps its
    /// own state in project-scoped plugin storage. A freshly migrated database must
    /// carry no trace of the tables it used to keep here.
    #[test]
    fn test_fresh_db_has_no_legacy_roadmap_tables() {
        let path = std::env::temp_dir().join(format!(
            "test_no_roadmap_tables_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        for table in ["roadmap_item_value", "roadmap_repo_config"] {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .expect("query sqlite_master");
            assert!(!exists, "fresh database should not carry {table}");
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_new_db_user_version() {
        let path = std::env::temp_dir().join(format!("test_uv_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            uv, LATEST_USER_VERSION,
            "Fresh DB should have user_version={} after migrations, got {}",
            LATEST_USER_VERSION, uv
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_pull_request_readiness_columns_backfilled_for_upgraded_db() {
        let path = std::env::temp_dir().join(format!(
            "test_pr_readiness_backfill_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open legacy db");
            conn.execute_batch(
                r#"
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    initial_prompt TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE pull_requests (
                    id INTEGER PRIMARY KEY,
                    pr_number INTEGER NOT NULL DEFAULT 0,
                    ticket_id TEXT NOT NULL,
                    repo_owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    head_sha TEXT NOT NULL DEFAULT '',
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    last_polled_at INTEGER DEFAULT 0,
                    review_status TEXT,
                    mergeable INTEGER,
                    mergeable_state TEXT,
                    merged_at INTEGER,
                    draft INTEGER NOT NULL DEFAULT 0,
                    is_queued INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO tasks (id, title, status, created_at, updated_at)
                VALUES ('T-100', 'Legacy task', 'doing', 1, 1);
                INSERT INTO pull_requests (id, pr_number, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at)
                VALUES (42, 42, 'T-100', 'acme', 'repo', 'Legacy PR', 'https://github.com/acme/repo/pull/42', 'open', 1, 1);
                "#,
            )
            .expect("create legacy schema");
            conn.execute(&format!("PRAGMA user_version = {LATEST_USER_VERSION}"), [])
                .expect("pin user_version past migration");
        }

        let db = Database::new(path.clone()).expect("reopen upgraded DB");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        for (column, _) in pull_request_readiness_columns() {
            let exists: bool = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = '{column}'"
                    ),
                    [],
                    |row| row.get(0),
                )
                .expect("query readiness column");
            assert!(exists, "{column} should be backfilled");
        }

        let preserved_title: String = conn
            .query_row("SELECT title FROM pull_requests WHERE id = 42", [], |row| {
                row.get(0)
            })
            .expect("legacy PR row should remain");
        assert_eq!(preserved_title, "Legacy PR");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_is_queued_columns_backfilled_for_upgraded_db() {
        // Reproduces the real-world bug: the is_queued column-adding migration was
        // inserted mid-list, so databases whose user_version is already past it
        // (e.g. the seeded dev DB at v28) never had the column added. A fully
        // migrated DB that predates the fix is missing is_queued on both PR tables.
        let path =
            std::env::temp_dir().join(format!("test_is_queued_backfill_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(&format!("PRAGMA user_version = {LATEST_USER_VERSION}"), [])
                .expect("set user_version");
            conn.execute("CREATE TABLE pull_requests (id INTEGER PRIMARY KEY)", [])
                .expect("create legacy pull_requests table");
            conn.execute("CREATE TABLE authored_prs (id INTEGER PRIMARY KEY)", [])
                .expect("create legacy authored_prs table");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        for table in ["pull_requests", "authored_prs"] {
            let has_is_queued: bool = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = 'is_queued'"
                    ),
                    [],
                    |r| r.get(0),
                )
                .expect("query is_queued column");
            assert!(
                has_is_queued,
                "{table} should have an is_queued column after upgrading an existing DB"
            );
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_handoff_notes_workflow_backfill_is_one_time_for_legacy_tasks() {
        let path = std::env::temp_dir().join(format!(
            "test_handoff_notes_workflow_backfill_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(&format!("PRAGMA user_version = {LATEST_USER_VERSION}"), [])
                .expect("set user_version");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            )
            .expect("create project_config table");
            conn.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, initial_prompt TEXT NOT NULL, project_id TEXT, handoff_notes_enabled INTEGER NOT NULL DEFAULT 1)",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "INSERT INTO tasks (id, initial_prompt, project_id, handoff_notes_enabled) VALUES ('T-legacy', 'Legacy task', 'P-legacy', 1)",
                [],
            )
            .expect("insert legacy task");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('handoff_notes_workflow_backfill_applied', 'true')",
                [],
            )
            .expect("insert legacy marker from old backfill");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let legacy_enabled: String = conn
            .query_row(
                "SELECT value FROM project_config WHERE project_id = 'P-legacy' AND key = 'start_prompt_contributions'",
                [],
                |row| row.get(0),
            )
            .expect("legacy project should be backfilled");
        assert!(legacy_enabled.contains("handoff-notes-workflow"));

        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, project_id, handoff_notes_enabled) VALUES ('T-new', 'New task', 'P-new', 1)",
            [],
        )
        .expect("insert post-backfill task");
        ensure_handoff_notes_workflow_backfill(&conn).expect("rerun backfill");
        let new_project_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_config WHERE project_id = 'P-new' AND key = 'start_prompt_contributions'",
                [],
                |row| row.get(0),
            )
            .expect("query new project config");
        assert_eq!(new_project_count, 0, "backfill should only run once");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_handoff_notes_workflow_refreshes_legacy_current_summary_copy() {
        let path = std::env::temp_dir().join(format!(
            "test_handoff_notes_workflow_refresh_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let old_content = crate::agent_lifecycle::legacy_handoff_notes_start_prompt_content(None)
            .replace(
                "## Summary\nBrief accumulated summary of what changed and whether the task is ready for review.",
                "## Current summary\nBrief status of what changed and whether the task is ready for review.",
            )
            .replace(
                "Good: \"## Summary\\nScoped JWT refresh token rotation in auth middleware\\n\\n## Decisions made\\nKept rotation inside existing auth middleware.\"",
                "Good: \"## Current summary\\nScoped JWT refresh token rotation in auth middleware\\n\\n## Decisions made\\nKept rotation inside existing auth middleware.\"",
            )
            .replace(
                "Update the task's Handoff Notes with an accurate, up-to-date reviewer brief using the active template. Preserve useful existing Summary context while adding new information, decisions, open questions, and follow-up tasks; do not discard earlier relevant work just to make the note \"current\".",
                "Replace the task's Handoff Notes with an accurate, up-to-date reviewer brief using the active template. Cover the active template's requested sections, including current status, decisions made, open questions, and follow-up tasks when applicable. Keep it current rather than appending run history.",
            );
        let old_contribution = crate::agent_lifecycle::StartPromptContribution {
            id: crate::agent_lifecycle::HANDOFF_NOTES_WORKFLOW_CONTRIBUTION_ID.to_string(),
            enabled: true,
            content: old_content,
            order: 0,
        };
        let old_json =
            serde_json::to_string(&vec![old_contribution]).expect("serialize legacy contribution");

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(&format!("PRAGMA user_version = {LATEST_USER_VERSION}"), [])
                .expect("set user_version");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            )
            .expect("create project_config table");
            conn.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, initial_prompt TEXT NOT NULL, project_id TEXT, handoff_notes_enabled INTEGER NOT NULL DEFAULT 1)",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('start_prompt_contributions_backfill_applied', 'true')",
                [],
            )
            .expect("insert applied marker");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES ('P-legacy', 'start_prompt_contributions', ?1)",
                [old_json],
            )
            .expect("insert old contribution copy");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let refreshed: String = conn
            .query_row(
                "SELECT value FROM project_config WHERE project_id = 'P-legacy' AND key = 'start_prompt_contributions'",
                [],
                |row| row.get(0),
            )
            .expect("query refreshed contribution");
        assert!(refreshed.contains("## Summary"));
        assert!(refreshed.contains("Brief accumulated summary"));
        assert!(refreshed.contains("Preserve useful existing Summary context"));
        assert!(!refreshed.contains("## Current summary"));
        assert!(!refreshed.contains("Keep it current rather than appending run history"));

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_plugin_tables_for_upgraded_db() {
        let path = std::env::temp_dir().join(format!(
            "test_recreate_plugin_tables_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(path.clone()).expect("Database::new");
            let conn = db.connection();
            let conn = conn.lock().unwrap();

            conn.execute("DROP TABLE project_plugins", [])
                .expect("drop project_plugins");
            conn.execute("DROP TABLE plugins", [])
                .expect("drop plugins");

            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .expect("read user_version");
            assert_eq!(
                uv, LATEST_USER_VERSION,
                "fixture should simulate an upgraded schema version"
            );
        }

        let db = Database::new(path.clone()).expect("Database::new should repair schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_plugins: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='plugins'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for plugins");
        assert!(
            has_plugins,
            "Database::new should recreate missing plugins table for upgraded databases"
        );

        let has_project_plugins: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_plugins'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for project_plugins");
        assert!(
            has_project_plugins,
            "Database::new should recreate missing project_plugins table for upgraded databases"
        );

        let has_plugin_storage: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='plugin_storage'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for plugin_storage");
        assert!(
            has_plugin_storage,
            "Database::new should preserve plugin_storage when repairing plugin tables"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_action_items_table_for_upgraded_db() {
        let path = std::env::temp_dir().join(format!(
            "test_recreate_action_items_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(path.clone()).expect("Database::new");
            let conn = db.connection();
            let conn = conn.lock().unwrap();

            conn.execute("DROP TABLE action_items", [])
                .expect("drop action_items");
            conn.execute("PRAGMA user_version = 14", [])
                .expect("set pre-repair user_version");

            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .expect("read user_version");
            assert_eq!(
                uv, 14,
                "fixture should simulate the pre-repair schema version"
            );
        }

        let db = Database::new(path.clone()).expect("Database::new should repair schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_action_items: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='action_items'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master");

        assert!(
            has_action_items,
            "Database::new should recreate missing action_items table for upgraded databases"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_action_items_table_from_v13_upgrade() {
        let path = std::env::temp_dir().join(format!(
            "test_recreate_action_items_v13_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute("PRAGMA user_version = 13", [])
                .expect("set v13 user_version");

            conn.execute(
                "CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )",
                [],
            )
            .expect("create projects table");

            conn.execute(
                "CREATE TABLE pull_requests (
                    id INTEGER PRIMARY KEY,
                    ticket_id TEXT NOT NULL,
                    repo_owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    head_sha TEXT NOT NULL DEFAULT '',
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    last_polled_at INTEGER DEFAULT 0,
                    review_status TEXT,
                    merged_at INTEGER
                )",
                [],
            )
            .expect("create pull_requests table");

            conn.execute(
                "CREATE TABLE authored_prs (
                    id INTEGER PRIMARY KEY,
                    number INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT,
                    state TEXT NOT NULL,
                    draft INTEGER NOT NULL DEFAULT 0,
                    html_url TEXT NOT NULL,
                    user_login TEXT NOT NULL,
                    user_avatar_url TEXT,
                    repo_owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    head_ref TEXT NOT NULL,
                    base_ref TEXT NOT NULL,
                    head_sha TEXT NOT NULL,
                    additions INTEGER NOT NULL DEFAULT 0,
                    deletions INTEGER NOT NULL DEFAULT 0,
                    changed_files INTEGER NOT NULL DEFAULT 0,
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    review_status TEXT,
                    merged_at INTEGER,
                    task_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )",
                [],
            )
            .expect("create authored_prs table");
        }

        let db = Database::new(path.clone()).expect("Database::new should repair v13 schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_action_items: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='action_items'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for action_items");
        assert!(
            has_action_items,
            "V15 repair should create action_items from a v13 database"
        );

        let has_is_queued_pull_requests: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'is_queued'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests columns");
        assert!(
            has_is_queued_pull_requests,
            "V14 migration should still run before the action_items repair"
        );

        let has_is_queued_authored_prs: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'is_queued'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs columns");
        assert!(
            has_is_queued_authored_prs,
            "V14 migration should add is_queued to authored_prs on the upgrade path"
        );

        let has_pull_request_mergeable: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'mergeable'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests mergeable column");
        assert!(
            has_pull_request_mergeable,
            "latest migration should add mergeable to pull_requests on the upgrade path"
        );
        let has_pull_request_mergeable_state: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'mergeable_state'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests mergeable_state column");
        assert!(
            has_pull_request_mergeable_state,
            "latest migration should add mergeable_state to pull_requests on the upgrade path"
        );

        let has_review_prs: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='review_prs'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for review_prs");
        if has_review_prs {
            let has_review_pr_mergeable: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('review_prs') WHERE name = 'mergeable'",
                    [],
                    |r| r.get(0),
                )
                .expect("query review_prs mergeable column");
            assert!(
                has_review_pr_mergeable,
                "latest migration should add mergeable to review_prs on the upgrade path"
            );
            let has_review_pr_mergeable_state: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('review_prs') WHERE name = 'mergeable_state'",
                    [],
                    |r| r.get(0),
                )
                .expect("query review_prs mergeable_state column");
            assert!(
                has_review_pr_mergeable_state,
                "latest migration should add mergeable_state to review_prs on the upgrade path"
            );
        }

        let has_authored_pr_mergeable: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'mergeable'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs mergeable column");
        assert!(
            has_authored_pr_mergeable,
            "latest migration should add mergeable to authored_prs on the upgrade path"
        );
        let has_authored_pr_mergeable_state: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'mergeable_state'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs mergeable_state column");
        assert!(
            has_authored_pr_mergeable_state,
            "latest migration should add mergeable_state to authored_prs on the upgrade path"
        );

        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("read repaired user_version");
        assert_eq!(
            uv, LATEST_USER_VERSION,
            "V13 database should upgrade to the latest schema version"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_v6_adds_prompt_and_summary() {
        let path =
            std::env::temp_dir().join(format!("test_v6_columns_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Check that prompt and summary columns exist via PRAGMA table_info
        let prompt_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'prompt'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        assert!(prompt_exists, "Column 'prompt' should exist in tasks table");

        let summary_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'summary'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        assert!(
            summary_exists,
            "Column 'summary' should exist in tasks table"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_v6_backfill() {
        let path =
            std::env::temp_dir().join(format!("test_v6_backfill_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        // Create a V5 database (without prompt/summary columns)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            // Set user_version to 5 to simulate V5 database
            conn.execute("PRAGMA user_version = 5", [])
                .expect("set user_version");
            // Create minimal V5 schema
            conn.execute(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    jira_key TEXT,
                    jira_status TEXT,
                    jira_assignee TEXT,
                    plan_text TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    project_id TEXT,
                    jira_title TEXT,
                    jira_description TEXT
                )",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "CREATE TABLE pull_requests (
                    id INTEGER PRIMARY KEY,
                    ticket_id TEXT NOT NULL,
                    repo_owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    head_sha TEXT NOT NULL DEFAULT '',
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    last_polled_at INTEGER DEFAULT 0,
                    review_status TEXT,
                    merged_at INTEGER,
                    FOREIGN KEY (ticket_id) REFERENCES tasks(id)
                )",
                [],
            )
            .expect("create pull_requests table");
            // Insert a test task (V5 schema — no prompt/summary columns yet)
            conn.execute(
                "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params!["T-999", "Test Task Title", "backlog", 1000, 1000],
            )
            .expect("insert test task");
        }

        // Now open with Database::new() which will run the V6 migration
        let db = Database::new(path.clone()).expect("Database::new on V5 db");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Verify the task's prompt was backfilled from title
        let prompt: String = conn
            .query_row("SELECT prompt FROM tasks WHERE id = 'T-999'", [], |r| {
                r.get(0)
            })
            .expect("Failed to query prompt");
        assert_eq!(
            prompt, "Test Task Title",
            "prompt should be backfilled from title"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_dependencies_table_created() {
        let path = std::env::temp_dir().join(format!(
            "test_task_dependencies_table_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='task_dependencies'",
                [],
                |r| r.get(0),
            )
            .expect("query task_dependencies table");
        assert!(table_exists, "task_dependencies table should exist");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_id_prefix_seeded() {
        let path =
            std::env::temp_dir().join(format!("test_task_id_prefix_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let prefix: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'task_id_prefix'",
                [],
                |row| row.get(0),
            )
            .expect("task_id_prefix should exist in config");

        assert_eq!(
            prefix.len(),
            3,
            "task_id_prefix should be exactly 3 characters"
        );
        assert!(
            prefix.chars().all(|c| c.is_ascii_uppercase()),
            "task_id_prefix should contain only uppercase letters, got: {}",
            prefix
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_github_poll_interval_seeded() {
        let path = std::env::temp_dir().join(format!(
            "test_github_poll_interval_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let poll_interval: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'github_poll_interval'",
                [],
                |row| row.get(0),
            )
            .expect("github_poll_interval should exist in config");

        assert_eq!(poll_interval, "60");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_github_poll_interval_upgrade_updates_legacy_default() {
        let path = std::env::temp_dir().join(format!(
            "test_github_poll_interval_upgrade_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            set_user_version_before(&conn, MigrationBoundary::GithubPollIntervalDefaultUpdate);
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('github_poll_interval', '15')",
                [],
            )
            .expect("insert legacy poll interval");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let poll_interval: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'github_poll_interval'",
                [],
                |row| row.get(0),
            )
            .expect("github_poll_interval should exist in config");

        assert_eq!(poll_interval, "60");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_github_poll_interval_upgrade_preserves_custom_value() {
        let path = std::env::temp_dir().join(format!(
            "test_github_poll_interval_custom_upgrade_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            set_user_version_before(&conn, MigrationBoundary::GithubPollIntervalDefaultUpdate);
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('github_poll_interval', '120')",
                [],
            )
            .expect("insert custom poll interval");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let poll_interval: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'github_poll_interval'",
                [],
                |row| row.get(0),
            )
            .expect("github_poll_interval should exist in config");

        assert_eq!(poll_interval, "120");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_github_poll_interval_user_value_persists_across_reopen() {
        let path = std::env::temp_dir().join(format!(
            "test_github_poll_interval_persist_reopen_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(path.clone()).expect("Database::new");
            let conn = db.connection();
            let conn = conn.lock().unwrap();
            conn.execute(
                "UPDATE config SET value = '15' WHERE key = 'github_poll_interval'",
                [],
            )
            .expect("set user poll interval");
        }

        let reopened = Database::new(path.clone()).expect("Database::new reopen");
        let conn = reopened.connection();
        let conn = conn.lock().unwrap();

        let poll_interval: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'github_poll_interval'",
                [],
                |row| row.get(0),
            )
            .expect("github_poll_interval should exist in config");

        assert_eq!(poll_interval, "15");

        drop(conn);
        drop(reopened);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upgrade_removes_jira_schema_and_config() {
        let path = std::env::temp_dir().join(format!(
            "test_upgrade_removes_jira_schema_and_config_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute("PRAGMA user_version = 18", [])
                .expect("set user_version");
            conn.execute(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    initial_prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    jira_key TEXT,
                    jira_title TEXT,
                    jira_status TEXT,
                    jira_assignee TEXT,
                    project_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    jira_description TEXT,
                    prompt TEXT,
                    summary TEXT,
                    agent TEXT,
                    permission_mode TEXT
                )",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            )
            .expect("create projects table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            )
            .expect("create project_config table");

            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('P-1', 'Project', '/tmp/project', 1, 1)",
                [],
            )
            .expect("insert project");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('jira_api_token', 'token')",
                [],
            )
            .expect("insert jira_api_token");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('jira_base_url', 'https://example.atlassian.net')",
                [],
            )
            .expect("insert jira_base_url");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES ('P-1', 'jira_username', 'dev@example.com')",
                [],
            )
            .expect("insert project jira_username");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES ('P-1', 'jira_board_id', '123')",
                [],
            )
            .expect("insert project jira_board_id");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let jira_columns: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name IN ('jira_key', 'jira_title', 'jira_status', 'jira_assignee', 'jira_description')",
                [],
                |row| row.get(0),
            )
            .expect("count jira columns");
        assert_eq!(jira_columns, 0, "upgrade must remove jira columns");

        let jira_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("count jira config");
        assert_eq!(jira_config_count, 0, "upgrade must remove jira config keys");

        let jira_project_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("count jira project config");
        assert_eq!(
            jira_project_config_count, 0,
            "upgrade must remove jira project config keys"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }
}
