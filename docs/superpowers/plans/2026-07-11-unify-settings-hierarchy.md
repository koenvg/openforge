# Unify Settings Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give OpenForge one consistent global → project → task settings cascade so a user sets defaults once and overrides them per project and per task.

**Architecture:** `effective = task ?? project ?? global ?? hardcoded default` (null = inherit). Global defaults live in the `config` KV table; project overrides in `project_config`; task-level values are snapshotted onto the task at creation (existing columns for handoff/worktree, a new `task_config` KV table for cleanup/title-update/provider). Plugin enablement gains a global-default layer (`global_plugins` table). One shared `HierarchicalSettingsCard`, driven by a settings registry, renders the grouped settings identically on the global and project pages.

**Tech Stack:** Rust sidecar (`rusqlite` + `rusqlite_migration`), Svelte 5 (runes) + TypeScript renderer, Vitest, SQLite. IPC via typed wrappers in `src/lib/ipc.ts` over the HTTP bridge to the sidecar.

**Spec:** `docs/superpowers/specs/2026-07-11-unify-settings-hierarchy-design.md`

## Global Constraints

- **TDD**: write the failing test first, watch it fail, implement, watch it pass, commit. Business logic only — no assertions on CSS classes/Tailwind/visual styling.
- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface. `on`-prefixed callback props; no legacy event dispatcher.
- **All renderer→sidecar calls go through `src/lib/ipc.ts`** typed wrappers. Svelte must not call raw transport APIs.
- **IPC payloads use camelCase** property names matching the generated frontend API shape, even though Rust handler params are snake_case (e.g. `projectId`, `taskId`, `pluginId`).
- **Rust command boundaries** return `Result<T, String>` via `.map_err(|e| format!(...))`; DB domain files use `impl super::Database`. Booleans in `config`/`project_config`/`task_config` are stored as the strings `'true'`/`'false'`.
- **Styling**: daisyUI v5 + Tailwind v4 utilities/semantic classes. No hardcoded hex colors. `ring-2 ring-primary rounded` for focus.
- **Rust tests** filter with a single `cargo test <filter>` from `src-tauri/`. Focused Vitest: `pnpm test <path>` (never the `--` separator forms).
- **Verification gates**: `pnpm exec tsc --noEmit` + `pnpm test` for frontend/type changes; `cargo test` from `src-tauri/` for sidecar changes.

## Naming contract (used across tasks)

Config / project_config / task_config **keys** (strings):
- `code_cleanup_tasks_enabled` — cleanup (bool)
- `task_display_title_metadata_updates_enabled` — title auto-update (bool)
- `handoff_notes_enabled` — handoff enablement (bool)
- `ai_provider` — provider (string)
- `use_worktrees` — default-to-worktrees (bool)
- `task_id_prefix` — task ID prefix (string; project + global only)
- `github_poll_interval` — poll interval seconds (string int; project + global only)

New Rust `Database` methods (Task IDs where defined):
- `get_task_config(&self, task_id, key) -> Result<Option<String>>` (1.2)
- `set_task_config(&self, task_id, key, value) -> Result<()>` (1.2)
- `get_all_task_config(&self, task_id) -> Result<HashMap<String,String>>` (1.2)
- `set_global_plugin_enabled(&self, plugin_id, enabled) -> Result<()>` (1.3)
- `get_global_plugin_defaults(&self) -> Result<Vec<(String,bool)>>` (1.3)
- `get_task_project_id(&self, task_id) -> Result<Option<String>>` (1.4)
- `resolve_task_bool(&self, task_id, key, default) -> bool` (1.4)
- `resolve_ai_provider_for_task(&self, task_id) -> String` (1.4)

New IPC commands + `ipc.ts` wrappers (1.7):
- `get_task_config` / `getTaskConfig(taskId, key)`
- `set_task_config` / `setTaskConfig(taskId, key, value)`
- `set_global_plugin_default` / `setGlobalPluginDefault(pluginId, enabled)`
- `get_global_plugin_defaults` / `getGlobalPluginDefaults()`
- `reset_project_settings_to_global` / `resetProjectSettingsToGlobal(projectId)`

Frontend registry module (3.1): `src/lib/hierarchicalSettings.ts` exporting `HIERARCHICAL_SETTINGS`, `SettingLevel`, `HierarchicalSettingDef`, `computeEffectiveProjectSettings(...)`.

Shared component (3.2): `src/components/settings/HierarchicalSettingsCard.svelte`.

---

# Phase 1 — Backend storage + resolvers (Rust)

### Task 1.1: Migration — `task_config` and `global_plugins` tables

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (append one migration before the closing `);` of `define_migrations!` at line ~1283)
- Test: `src-tauri/src/db/migrations.rs` (existing `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: two tables — `task_config(task_id TEXT, key TEXT, value TEXT, UNIQUE(task_id,key), FK→tasks ON DELETE CASCADE)` and `global_plugins(plugin_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1)`. `LATEST_USER_VERSION` increases by 1 (derived automatically from the macro).

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `migrations.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_task_config_and_global_plugins_tables_exist` (from `src-tauri/`)
Expected: FAIL — tables do not exist.

- [ ] **Step 3: Append the migration**

Immediately before the closing `);` at `migrations.rs:1283` (after the last `M::up_with_hook(...)` entry and its trailing comma), add:

```rust
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_task_config_and_global_plugins_tables_exist`
Expected: PASS. Also run `cargo test migration` to confirm the migration-count/version tests still pass (they derive from the macro, so they should).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): add task_config and global_plugins tables"
```

---

### Task 1.2: `task_config` DB methods

**Files:**
- Create: `src-tauri/src/db/task_config.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `mod task_config;` next to the other `mod` lines)
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/task_config.rs`

**Interfaces:**
- Produces: `get_task_config`, `set_task_config`, `get_all_task_config` on `impl super::Database`, mirroring `project_config` semantics.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/db/task_config.rs`:

```rust
use rusqlite::Result;
use std::collections::HashMap;

impl super::Database {
    /// Get a task-scoped config value.
    pub fn get_task_config(&self, task_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT value FROM task_config WHERE task_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([task_id, key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a task-scoped config value (upsert).
    pub fn set_task_config(&self, task_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
            [task_id, key, value],
        )?;
        Ok(())
    }

    /// Get all task-scoped config values for a task.
    pub fn get_all_task_config(&self, task_id: &str) -> Result<HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM task_config WHERE task_id = ?1")?;
        let rows = stmt.query_map([task_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut result = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            result.insert(k, v);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_task_config_roundtrip() {
        let (db, path) = make_test_db("task_config_rt");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                handoff_notes_enabled: true,
            })
            .unwrap();

        assert_eq!(db.get_task_config(&task.id, "code_cleanup_tasks_enabled").unwrap(), None);
        db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "true").unwrap();
        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled").unwrap(),
            Some("true".to_string())
        );
        db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "false").unwrap();
        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled").unwrap(),
            Some("false".to_string())
        );

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
```

- [ ] **Step 2: Register the module + verify it fails**

Add `mod task_config;` to `src-tauri/src/db/mod.rs` (alongside `mod config;`, `mod projects;`, etc.).
Run: `cargo test test_task_config_roundtrip`
Expected: PASS once the module compiles (the test creates a task, sets/gets config). If the module isn't registered, compilation fails — register it first, then the test passes. (This task's "failing" state is the missing methods; confirm by temporarily expecting `None` after a set, or simply proceed — the roundtrip asserts real behavior.)

- [ ] **Step 3: (implementation already written in Step 1)**

No additional code — the methods and test were added together. Ensure `NewTaskOptions` fields match the current struct (Task 1.5 extends it later; here use the fields as they exist today).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_task_config_roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/task_config.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): task_config KV methods"
```

---

### Task 1.3: `global_plugins` defaults + layered plugin resolution

**Files:**
- Modify: `src-tauri/src/db/plugins.rs` (add methods; update `get_enabled_plugins` at `:129` and `is_plugin_enabled` at `:149`)
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/plugins.rs`

**Interfaces:**
- Produces: `set_global_plugin_enabled(plugin_id, enabled)`, `get_global_plugin_defaults() -> Vec<(String,bool)>`. Resolution becomes `project_plugins.enabled ?? global_plugins.enabled ?? is_builtin`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plugins.rs` (use the existing plugin test helpers in that file for inserting a plugin; match their signature):

```rust
#[test]
fn test_global_plugin_default_layers_under_project() {
    let (db, path) = crate::db::test_helpers::make_test_db("global_plugin_defaults");
    let project = db.create_project("P", "/tmp/p").unwrap();
    // Insert a NON-builtin plugin (is_builtin = 0) via the existing test insert helper.
    insert_test_plugin(&db, "acme.tool", /* is_builtin */ false);

    // No project row, no global default, not builtin -> disabled.
    assert!(!db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

    // Global default ON -> project with no override inherits enabled.
    db.set_global_plugin_enabled("acme.tool", true).unwrap();
    assert!(db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

    // Project override OFF beats global default ON.
    db.set_plugin_enabled(&project.id, "acme.tool", false).unwrap();
    assert!(!db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

    drop(db);
    let _ = std::fs::remove_file(&path);
}
```

If `insert_test_plugin` does not already exist in the file, add a small helper in the `tests` module that inserts a row into `plugins` with the given `id` and `is_builtin`, reusing the columns from the existing plugin insert tests in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_global_plugin_default_layers_under_project`
Expected: FAIL — `set_global_plugin_enabled` undefined and resolution ignores `global_plugins`.

- [ ] **Step 3: Add methods and update resolution**

Add to `impl super::Database` in `plugins.rs`:

```rust
    /// Set the global default enabled flag for a plugin (upsert).
    pub fn set_global_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO global_plugins (plugin_id, enabled) VALUES (?1, ?2)
             ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled",
            rusqlite::params![plugin_id, enabled as i64],
        )?;
        Ok(())
    }

    /// Return (plugin_id, enabled) for every plugin with an explicit global default.
    pub fn get_global_plugin_defaults(&self) -> Result<Vec<(String, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT plugin_id, enabled FROM global_plugins")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
```

Update `is_plugin_enabled` (`:149`) query to layer the global default:

```rust
    pub fn is_plugin_enabled(&self, project_id: &str, plugin_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let enabled = conn
            .query_row(
                "SELECT COALESCE(
                        pp.enabled,
                        gp.enabled,
                        CASE WHEN p.is_builtin = 1 THEN 1 ELSE 0 END)
                 FROM plugins p
                 LEFT JOIN project_plugins pp ON pp.plugin_id = p.id AND pp.project_id = ?1
                 LEFT JOIN global_plugins gp ON gp.plugin_id = p.id
                 WHERE p.id = ?2",
                rusqlite::params![project_id, plugin_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        Ok(enabled)
    }
```

Update `get_enabled_plugins` (`:129`) WHERE clause to the same precedence:

```rust
            "SELECT p.id, p.name, p.version, p.api_version, p.description, p.permissions,
                    p.contributes, p.frontend_entry, p.backend_entry, p.install_path,
                    p.source_kind, p.source_spec, p.package_metadata, p.installed_at, p.is_builtin
             FROM plugins p
             LEFT JOIN project_plugins pp ON pp.plugin_id = p.id AND pp.project_id = ?1
             LEFT JOIN global_plugins gp ON gp.plugin_id = p.id
             WHERE COALESCE(pp.enabled, gp.enabled, CASE WHEN p.is_builtin = 1 THEN 1 ELSE 0 END) = 1
             ORDER BY p.name ASC",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_global_plugin_default_layers_under_project` then `cargo test plugin` (confirm existing plugin tests still pass — builtin-default behavior is unchanged when no `global_plugins` row exists).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/plugins.rs
git commit -m "feat(db): global plugin default layer under project enablement"
```

---

### Task 1.4: Task-aware resolvers (`resolve_task_bool`, `resolve_ai_provider_for_task`, `get_task_project_id`)

**Files:**
- Modify: `src-tauri/src/db/projects.rs` (add resolvers next to `resolve_ai_provider` at `:232`) or `src-tauri/src/db/task_config.rs` — keep them in `task_config.rs` to co-locate task-scoped resolution.
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/task_config.rs`

**Interfaces:**
- Consumes: `get_task_config` (1.2), `get_project_config`/`get_config`/`resolve_ai_provider` (existing).
- Produces:
  - `get_task_project_id(&self, task_id) -> Result<Option<String>>`
  - `resolve_task_bool(&self, task_id, key, default) -> bool` = `task_config[key] ?? project_config[key] ?? config[key] ?? default`
  - `resolve_ai_provider_for_task(&self, task_id) -> String` = `task_config['ai_provider'] ?? resolve_ai_provider(project)`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `task_config.rs`:

```rust
#[test]
fn test_resolve_task_bool_precedence() {
    let (db, path) = make_test_db("resolve_task_bool");
    let project = db.create_project("P", "/tmp/p").unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            handoff_notes_enabled: true,
        })
        .unwrap();
    let key = "code_cleanup_tasks_enabled";

    // Nothing set -> default.
    assert!(!db.resolve_task_bool(&task.id, key, false));
    // Global on.
    db.set_config(key, "true").unwrap();
    assert!(db.resolve_task_bool(&task.id, key, false));
    // Project off beats global.
    db.set_project_config(&project.id, key, "false").unwrap();
    assert!(!db.resolve_task_bool(&task.id, key, false));
    // Task on beats project.
    db.set_task_config(&task.id, key, "true").unwrap();
    assert!(db.resolve_task_bool(&task.id, key, false));

    drop(db);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_resolve_ai_provider_for_task_precedence() {
    let (db, path) = make_test_db("resolve_provider_task");
    let project = db.create_project("P", "/tmp/p").unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            handoff_notes_enabled: true,
        })
        .unwrap();

    // Falls back to project resolution (which defaults to claude-code).
    assert_eq!(db.resolve_ai_provider_for_task(&task.id), "claude-code");
    db.set_project_config(&project.id, "ai_provider", "opencode").unwrap();
    assert_eq!(db.resolve_ai_provider_for_task(&task.id), "opencode");
    db.set_task_config(&task.id, "ai_provider", "codex").unwrap();
    assert_eq!(db.resolve_ai_provider_for_task(&task.id), "codex");

    drop(db);
    let _ = std::fs::remove_file(&path);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test resolve_task_bool_precedence resolve_ai_provider_for_task_precedence` — note: run as two commands per repo rule (`cargo test resolve_task_bool_precedence` then `cargo test resolve_ai_provider_for_task_precedence`).
Expected: FAIL — resolvers undefined.

- [ ] **Step 3: Implement the resolvers**

Add to `impl super::Database` in `task_config.rs`:

```rust
    /// Return the project_id for a task, if any.
    pub fn get_task_project_id(&self, task_id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT project_id FROM tasks WHERE id = ?1")?;
        let mut rows = stmt.query([task_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Resolve a boolean setting for a task: task_config ?? project_config ?? config ?? default.
    pub fn resolve_task_bool(&self, task_id: &str, key: &str, default: bool) -> bool {
        if let Ok(Some(v)) = self.get_task_config(task_id, key) {
            return v == "true";
        }
        if let Ok(Some(project_id)) = self.get_task_project_id(task_id) {
            if !project_id.is_empty() {
                if let Ok(Some(v)) = self.get_project_config(&project_id, key) {
                    return v == "true";
                }
            }
        }
        if let Ok(Some(v)) = self.get_config(key) {
            return v == "true";
        }
        default
    }

    /// Resolve the AI provider for a task: task_config ?? project ?? global ?? claude-code.
    pub fn resolve_ai_provider_for_task(&self, task_id: &str) -> String {
        if let Ok(Some(v)) = self.get_task_config(task_id, "ai_provider") {
            if !v.is_empty() {
                return v;
            }
        }
        let project_id = self
            .get_task_project_id(task_id)
            .ok()
            .flatten()
            .unwrap_or_default();
        self.resolve_ai_provider(&project_id)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test resolve_task_bool_precedence` then `cargo test resolve_ai_provider_for_task_precedence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/task_config.rs
git commit -m "feat(db): task-aware setting resolvers"
```

---

### Task 1.5: Snapshot task-level settings at creation

**Files:**
- Modify: `src-tauri/src/db/tasks.rs` (`NewTaskOptions` at `:64`; `create_task_with_options` INSERT at `:545`)
- Modify: `src-tauri/src/app_invoke/core.rs` (`create_task` handler at `:261`)
- Modify: `src/lib/ipc.ts` (`CreateTaskOptions` at `:9`, `createTask` at `:19`)
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/tasks.rs`

**Interfaces:**
- Consumes: `set_task_config` (1.2).
- Produces: `NewTaskOptions` gains `code_cleanup_enabled: Option<bool>`, `task_display_title_updates_enabled: Option<bool>`, `ai_provider: Option<&'a str>`. When `Some`, `create_task_with_options` writes the matching `task_config` row. `createTask` gains optional `codeCleanupEnabled`, `taskDisplayTitleUpdatesEnabled`, `aiProvider`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `tasks.rs`:

```rust
#[test]
fn test_create_task_snapshots_task_config_when_provided() {
    let (db, path) = crate::db::test_helpers::make_test_db("task_snapshot");
    let project = db.create_project("P", "/tmp/p").unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            handoff_notes_enabled: true,
            code_cleanup_enabled: Some(true),
            task_display_title_updates_enabled: Some(false),
            ai_provider: Some("opencode"),
        })
        .unwrap();

    assert_eq!(
        db.get_task_config(&task.id, "code_cleanup_tasks_enabled").unwrap(),
        Some("true".to_string())
    );
    assert_eq!(
        db.get_task_config(&task.id, "task_display_title_metadata_updates_enabled").unwrap(),
        Some("false".to_string())
    );
    assert_eq!(db.get_task_config(&task.id, "ai_provider").unwrap(), Some("opencode".to_string()));
    // Resolver reads the snapshot.
    assert!(db.resolve_task_bool(&task.id, "code_cleanup_tasks_enabled", false));
    assert_eq!(db.resolve_ai_provider_for_task(&task.id), "opencode");

    drop(db);
    let _ = std::fs::remove_file(&path);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_create_task_snapshots_task_config_when_provided`
Expected: FAIL — the three new `NewTaskOptions` fields don't exist.

- [ ] **Step 3: Extend `NewTaskOptions` + snapshot writes**

In `tasks.rs`, extend the struct (`:64`):

```rust
pub struct NewTaskOptions<'a> {
    pub initial_prompt: &'a str,
    pub status: &'a str,
    pub project_id: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub permission_mode: Option<&'a str>,
    pub worktree_source: Option<&'a str>,
    pub worktree_branch: Option<&'a str>,
    pub title: Option<&'a str>,
    pub handoff_notes_enabled: bool,
    pub code_cleanup_enabled: Option<bool>,
    pub task_display_title_updates_enabled: Option<bool>,
    pub ai_provider: Option<&'a str>,
}
```

In `create_task_with_options`, after the `INSERT INTO tasks (...)` succeeds and before building the returned `TaskRow` (around `:566`), snapshot provided values. Do this while the `conn` lock is still held; use the same `conn`:

```rust
        let bool_str = |b: bool| if b { "true" } else { "false" };
        if let Some(v) = code_cleanup_enabled {
            conn.execute(
                "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                [&task_id, "code_cleanup_tasks_enabled", bool_str(v)],
            )?;
        }
        if let Some(v) = task_display_title_updates_enabled {
            conn.execute(
                "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                [&task_id, "task_display_title_metadata_updates_enabled", bool_str(v)],
            )?;
        }
        if let Some(v) = ai_provider {
            if !v.is_empty() {
                conn.execute(
                    "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                    [&task_id, "ai_provider", v],
                )?;
            }
        }
```

Destructure the new fields at the top of `create_task_with_options` alongside the existing ones (the function takes `NewTaskOptions`; add `code_cleanup_enabled`, `task_display_title_updates_enabled`, `ai_provider` to the `let NewTaskOptions { .. } = options;` binding — match the existing destructuring style in the function).

**Fix all other `NewTaskOptions { .. }` construction sites** (search: `rg "NewTaskOptions \{" src-tauri/src`). Each internal caller (e.g. `create_task`, `create_task_with_worktree_source`, seed/test helpers) must add `code_cleanup_enabled: None, task_display_title_updates_enabled: None, ai_provider: None,` so they keep today's behavior (no snapshot → runtime resolves from project/global).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_create_task_snapshots_task_config_when_provided` then `cargo test task` (confirm existing task tests compile/pass after the struct change).
Expected: PASS.

- [ ] **Step 5: Wire the IPC boundary + `ipc.ts`**

In `core.rs` `create_task` handler (`:261`), read the new optional fields from the payload and pass them through:

```rust
            let code_cleanup_enabled = request.payload.get("codeCleanupEnabled").and_then(|v| v.as_bool());
            let task_display_title_updates_enabled = request
                .payload
                .get("taskDisplayTitleUpdatesEnabled")
                .and_then(|v| v.as_bool());
            let ai_provider = payload_optional_string(&request.payload, "aiProvider")?;
```

and add to the `NewTaskOptions { ... }` literal:

```rust
                    code_cleanup_enabled,
                    task_display_title_updates_enabled,
                    ai_provider: ai_provider.as_deref(),
```

In `src/lib/ipc.ts`, extend `CreateTaskOptions` (`:9`) and the `createTask` destructuring + `invoke` payload (`:19-30`):

```ts
  // in CreateTaskOptions:
  codeCleanupEnabled?: boolean
  taskDisplayTitleUpdatesEnabled?: boolean
  aiProvider?: string | null
```

```ts
  const {
    dependsOn = [],
    labelNames = [],
    worktreeSource = null,
    worktreeBranch = null,
    title = null,
    handoffNotesEnabled = true,
    codeCleanupEnabled,
    taskDisplayTitleUpdatesEnabled,
    aiProvider = null,
  } = options
  const task = await invoke<RawTask>("create_task", {
    initialPrompt, status, projectId, permissionMode, dependsOn, labelNames,
    worktreeSource, worktreeBranch, title, handoffNotesEnabled,
    codeCleanupEnabled, taskDisplayTitleUpdatesEnabled, aiProvider,
  });
```

Update the IPC contract registry `src/lib/electronMigrationContracts.ts` (the `createTask`→`create_task` entry, ~`:45`) to list the three new payload fields.

- [ ] **Step 6: Verify + commit**

Run: `cargo test task` and `pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

```bash
git add src-tauri/src/db/tasks.rs src-tauri/src/app_invoke/core.rs src/lib/ipc.ts src/lib/electronMigrationContracts.ts
git commit -m "feat(tasks): snapshot cleanup/title/provider settings on create"
```

---

### Task 1.6: Per-project task ID prefix at creation

**Files:**
- Modify: `src-tauri/src/db/tasks.rs` (`create_task_with_options` prefix read at `:518-529`)
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/tasks.rs`

**Interfaces:**
- Consumes: `get_project_config` (existing).
- Produces: task IDs use `project_config['task_id_prefix'] ?? config['task_id_prefix'] ?? 'T'`. The single global `next_task_id` counter is unchanged (IDs stay globally unique; numbering stays globally sequential — per-project contiguous numbering is an explicit non-goal / follow-up to avoid ID-collision migrations).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn test_task_id_prefix_prefers_project_override() {
    let (db, path) = crate::db::test_helpers::make_test_db("prefix_override");
    let project = db.create_project("Web", "/tmp/web").unwrap();
    db.set_project_config(&project.id, "task_id_prefix", "WEB").unwrap();
    let task = db
        .create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "p",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            handoff_notes_enabled: true,
            code_cleanup_enabled: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .unwrap();
    assert!(task.id.starts_with("WEB-"), "got {}", task.id);

    drop(db);
    let _ = std::fs::remove_file(&path);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_task_id_prefix_prefers_project_override`
Expected: FAIL — prefix is read only from global `config`, so the id starts with `T-`.

- [ ] **Step 3: Resolve prefix from project first**

Replace the prefix read block in `create_task_with_options` (`:518-529`) so that, when `project_id` is `Some`, it checks `project_config` first:

```rust
        let global_prefix: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'task_id_prefix'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "T".to_string());
        let project_prefix: Option<String> = match project_id {
            Some(pid) => conn
                .query_row(
                    "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'task_id_prefix'",
                    [pid],
                    |row| row.get(0),
                )
                .ok(),
            None => None,
        };
        let prefix = project_prefix
            .filter(|p| !p.is_empty())
            .or_else(|| Some(global_prefix).filter(|p| !p.is_empty()))
            .unwrap_or_else(|| "T".to_string());
        let task_id = format!("{}-{}", prefix, next_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_task_id_prefix_prefers_project_override` then `cargo test task`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/tasks.rs
git commit -m "feat(tasks): per-project task ID prefix override"
```

---

### Task 1.7: IPC commands + `ipc.ts` wrappers for task_config, global plugin defaults, and reset

**Files:**
- Modify: `src-tauri/src/app_invoke/core.rs` (add command arms in the `match`) and `src-tauri/src/app_invoke/plugins.rs` (global plugin default commands)
- Create: `src-tauri/src/db/settings_reset.rs` (the reset method) + register in `db/mod.rs`
- Modify: `src/lib/ipc.ts` (wrappers) + `src/lib/electronMigrationContracts.ts` (contracts)
- Test: inline `#[cfg(test)]` in `src-tauri/src/db/settings_reset.rs`

**Interfaces:**
- Produces IPC commands + wrappers listed in the Naming contract. `reset_project_settings_to_global(project_id)` deletes the hierarchy keys from `project_config` and this project's rows from `project_plugins`.

- [ ] **Step 1: Write the failing test (reset behavior)**

Create `src-tauri/src/db/settings_reset.rs`:

```rust
use rusqlite::Result;

/// project_config keys that participate in the unified settings hierarchy and are
/// therefore cleared by "Default to global settings".
pub const HIERARCHY_PROJECT_CONFIG_KEYS: &[&str] = &[
    "code_cleanup_tasks_enabled",
    "task_display_title_metadata_updates_enabled",
    "handoff_notes_enabled",
    "ai_provider",
    "use_worktrees",
    "task_id_prefix",
    "github_poll_interval",
];

impl super::Database {
    /// Clear this project's overrides for the unified settings so it re-inherits global.
    pub fn reset_project_settings_to_global(&self, project_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        for key in HIERARCHY_PROJECT_CONFIG_KEYS {
            conn.execute(
                "DELETE FROM project_config WHERE project_id = ?1 AND key = ?2",
                [project_id, key],
            )?;
        }
        conn.execute(
            "DELETE FROM project_plugins WHERE project_id = ?1",
            [project_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_reset_clears_project_overrides_only() {
        let (db, path) = make_test_db("reset_settings");
        let project = db.create_project("P", "/tmp/p").unwrap();
        db.set_project_config(&project.id, "code_cleanup_tasks_enabled", "true").unwrap();
        db.set_project_config(&project.id, "additional_instructions", "keep me").unwrap();

        db.reset_project_settings_to_global(&project.id).unwrap();

        // Hierarchy key cleared -> inherits (None).
        assert_eq!(db.get_project_config(&project.id, "code_cleanup_tasks_enabled").unwrap(), None);
        // Non-hierarchy project config is untouched.
        assert_eq!(
            db.get_project_config(&project.id, "additional_instructions").unwrap(),
            Some("keep me".to_string())
        );

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
```

- [ ] **Step 2: Register module + run test**

Add `mod settings_reset;` to `db/mod.rs`.
Run: `cargo test test_reset_clears_project_overrides_only`
Expected: PASS.

- [ ] **Step 3: Add command arms**

In `core.rs` `match request.command.as_str()`, add arms (follow the existing `map_err` + `json_value` style):

```rust
        "get_task_config" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let key = payload_string(&request.payload, "key")?;
            json_value(db.get_task_config(&task_id, &key).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get task config: {e}"))
            })?)?
        }
        "set_task_config" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            db.set_task_config(&task_id, &key, &value).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to set task config: {e}"))
            })?;
            serde_json::Value::Null
        }
        "reset_project_settings_to_global" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            db.reset_project_settings_to_global(&project_id).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to reset project settings: {e}"))
            })?;
            serde_json::Value::Null
        }
```

In `plugins.rs` (mirror `set_plugin_enabled` at `:164`), add `set_global_plugin_default` and `get_global_plugin_defaults` arms:

```rust
        "set_global_plugin_default" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = request.payload.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
            db.set_global_plugin_enabled(&plugin_id, enabled).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to set global plugin default: {e}"))
            })?;
            serde_json::Value::Null
        }
        "get_global_plugin_defaults" => {
            let defaults = db.get_global_plugin_defaults().map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get global plugin defaults: {e}"))
            })?;
            json_value(defaults.into_iter().map(|(id, enabled)| {
                serde_json::json!({ "pluginId": id, "enabled": enabled })
            }).collect::<Vec<_>>())?
        }
```

- [ ] **Step 4: Add `ipc.ts` wrappers + contracts**

In `src/lib/ipc.ts`:

```ts
export async function getTaskConfig(taskId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_task_config", { taskId, key })
}
export async function setTaskConfig(taskId: string, key: string, value: string): Promise<void> {
  return invoke("set_task_config", { taskId, key, value })
}
export async function resetProjectSettingsToGlobal(projectId: string): Promise<void> {
  return invoke("reset_project_settings_to_global", { projectId })
}
export async function setGlobalPluginDefault(pluginId: string, enabled: boolean): Promise<void> {
  return invoke("set_global_plugin_default", { pluginId, enabled })
}
export async function getGlobalPluginDefaults(): Promise<{ pluginId: string; enabled: boolean }[]> {
  return invoke<{ pluginId: string; enabled: boolean }[]>("get_global_plugin_defaults", {})
}
```

Add matching entries to `src/lib/electronMigrationContracts.ts`.

- [ ] **Step 5: Verify + commit**

Run: `cargo test settings_reset` and `pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

```bash
git add src-tauri/src/db/settings_reset.rs src-tauri/src/db/mod.rs src-tauri/src/app_invoke/core.rs src-tauri/src/app_invoke/plugins.rs src/lib/ipc.ts src/lib/electronMigrationContracts.ts
git commit -m "feat(ipc): task_config, global plugin default, and reset commands"
```

---

# Phase 2 — Runtime consume-site switches (Rust)

### Task 2.1: Cleanup reads the task snapshot

**Files:**
- Modify: `src-tauri/src/app_invoke/lifecycle.rs` (`code_cleanup_enabled` read at `:178-183`)
- Test: `src-tauri/src/app_invoke/lifecycle.rs` (inline test) or the existing lifecycle test module

**Interfaces:**
- Consumes: `resolve_task_bool` (1.4). `build_task_prompt`'s `code_cleanup_enabled` param is unchanged; only its source changes.

- [ ] **Step 1: Write the failing test**

Add a test asserting the start-implementation context uses the task-resolved value. Follow the existing test setup in `lifecycle.rs` for building a `StartImplementationContext` (find the current tests with `rg "code_cleanup_enabled" src-tauri/src/app_invoke/lifecycle.rs`). The test: create a task, set `task_config['code_cleanup_tasks_enabled'] = "true"` while global is unset/false, build the context, assert `code_cleanup_enabled == true`.

```rust
#[test]
fn test_start_context_cleanup_reads_task_override() {
    // (mirror the existing lifecycle test harness for building the context)
    // 1. make_test_db; create project + task
    // 2. db.set_config("code_cleanup_tasks_enabled", "false")
    // 3. db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "true")
    // 4. build the StartImplementationContext for task.id
    // 5. assert!(context.code_cleanup_enabled)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_start_context_cleanup_reads_task_override`
Expected: FAIL — global `false` currently wins.

- [ ] **Step 3: Switch the source**

Replace the `code_cleanup_enabled` read at `lifecycle.rs:178-183` with:

```rust
    let code_cleanup_enabled = db.resolve_task_bool(&task.id, "code_cleanup_tasks_enabled", false);
```

(`task` is already in scope here — it's used to build the context. Confirm the task id field name via the surrounding code.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_start_context_cleanup_reads_task_override`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/app_invoke/lifecycle.rs
git commit -m "feat(lifecycle): cleanup flag resolves from task hierarchy"
```

---

### Task 2.2: Title auto-update reads the task snapshot

**Files:**
- Modify: `src-tauri/src/http_server.rs` (`task_display_title_metadata_updates_enabled` at `:551`, `should_start_task_display_title_refresh` at `:563`)
- Test: `src-tauri/src/http_server.rs` inline test

**Interfaces:**
- Consumes: `resolve_task_bool` (1.4). The gate becomes task-scoped using the task id on the lifecycle notification.

- [ ] **Step 1: Write the failing test**

Confirm the notification carries a task id (`rg "struct AgentLifecycleNotification" src-tauri/src` and inspect its fields — likely `task_id` or `ticket_id`). Write a test that sets global `task_display_title_metadata_updates_enabled = "false"`, sets the task's `task_config` value to `"true"`, and asserts the resolver-based gate returns `true` for that task.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test <the new test name>`
Expected: FAIL.

- [ ] **Step 3: Make the gate task-scoped**

Change `task_display_title_metadata_updates_enabled` to accept a task id and use the resolver:

```rust
fn task_display_title_metadata_updates_enabled(state: &AppState, task_id: &str) -> bool {
    state
        .db
        .lock()
        .unwrap()
        .resolve_task_bool(task_id, TASK_DISPLAY_TITLE_METADATA_UPDATES_ENABLED_CONFIG_KEY, false)
}
```

Update the caller `should_start_task_display_title_refresh` (`:567`) to pass the notification's task id:

```rust
    if !task_display_title_metadata_updates_enabled(state, &notification.task_id) {
        return false;
    }
```

(Use the actual field name found in Step 1.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test <the new test name>` then `cargo test http_server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs
git commit -m "feat(http): title auto-update resolves from task hierarchy"
```

---

# Phase 3 — Settings registry + shared component + global UI (frontend)

### Task 3.1: Hierarchical settings registry + effective-value resolution

**Files:**
- Create: `src/lib/hierarchicalSettings.ts`
- Test: `src/lib/hierarchicalSettings.test.ts`

**Interfaces:**
- Produces: `SettingLevel`, `SettingControl`, `HierarchicalSettingDef`, `HIERARCHICAL_SETTINGS: HierarchicalSettingDef[]`, and `computeEffectiveProjectSettings(global, projectRaw)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/hierarchicalSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  HIERARCHICAL_SETTINGS,
  computeEffectiveProjectSettings,
} from './hierarchicalSettings'

describe('hierarchical settings registry', () => {
  it('marks task-applicable settings correctly', () => {
    const byKey = Object.fromEntries(HIERARCHICAL_SETTINGS.map((s) => [s.key, s]))
    expect(byKey['code_cleanup_tasks_enabled'].levels).toContain('task')
    expect(byKey['ai_provider'].levels).toContain('task')
    // Project-only settings do not cascade to tasks.
    expect(byKey['task_id_prefix'].levels).not.toContain('task')
    expect(byKey['github_poll_interval'].levels).not.toContain('task')
  })

  it('project raw override wins over global, absence inherits global', () => {
    const global = { code_cleanup_tasks_enabled: 'false', ai_provider: 'claude-code' }
    const projectRaw = { code_cleanup_tasks_enabled: 'true' } // ai_provider absent
    const eff = computeEffectiveProjectSettings(global, projectRaw)
    expect(eff.code_cleanup_tasks_enabled).toBe('true')
    expect(eff.ai_provider).toBe('claude-code')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/hierarchicalSettings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the registry**

Create `src/lib/hierarchicalSettings.ts`:

```ts
export type SettingLevel = 'global' | 'project' | 'task'
export type SettingControl = 'toggle' | 'select' | 'text' | 'number' | 'plugins'

export interface HierarchicalSettingDef {
  key: string
  label: string
  description: string
  control: SettingControl
  levels: SettingLevel[]
  default: string
  options?: { value: string; label: string }[]
}

export const HIERARCHICAL_SETTINGS: HierarchicalSettingDef[] = [
  {
    key: 'code_cleanup_tasks_enabled',
    label: 'Code Cleanup Tasks',
    description: 'Agents create tasks for code that needs cleanup or splitting',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'false',
  },
  {
    key: 'task_display_title_metadata_updates_enabled',
    label: 'Task Display Title Updates',
    description: 'Generate task display titles from agent activity metadata',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'false',
  },
  {
    key: 'handoff_notes_enabled',
    label: 'Handoff Notes',
    description: 'Ask the agent to maintain reviewer handoff notes',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'true',
  },
  {
    key: 'ai_provider',
    label: 'AI Provider',
    description: 'Coding agent used to run tasks',
    control: 'select',
    levels: ['global', 'project', 'task'],
    default: 'claude-code',
    options: [
      { value: 'claude-code', label: 'Claude Code' },
      { value: 'opencode', label: 'OpenCode' },
      { value: 'pi', label: 'Pi Coding Agent' },
      { value: 'codex', label: 'Codex' },
    ],
  },
  {
    key: 'use_worktrees',
    label: 'Default new tasks to worktrees',
    description: 'New tasks default to isolated worktrees',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'true',
  },
  {
    key: 'plugins',
    label: 'Plugins',
    description: 'Which plugins are enabled',
    control: 'plugins',
    levels: ['global', 'project'],
    default: '',
  },
  {
    key: 'task_id_prefix',
    label: 'Task ID Prefix',
    description: 'Prefix for new task IDs (e.g. WEB-1)',
    control: 'text',
    levels: ['global', 'project'],
    default: '',
  },
  {
    key: 'github_poll_interval',
    label: 'GitHub Poll Interval',
    description: 'How often to check GitHub for updates (seconds)',
    control: 'number',
    levels: ['global', 'project'],
    default: '60',
  },
]

/** Effective project value per key: project override if present, else global, else default. */
export function computeEffectiveProjectSettings(
  global: Record<string, string>,
  projectRaw: Record<string, string | null>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const def of HIERARCHICAL_SETTINGS) {
    if (def.control === 'plugins') continue
    const projectValue = projectRaw[def.key]
    if (projectValue != null) {
      result[def.key] = projectValue
    } else if (global[def.key] != null) {
      result[def.key] = global[def.key]
    } else {
      result[def.key] = def.default
    }
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/hierarchicalSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hierarchicalSettings.ts src/lib/hierarchicalSettings.test.ts
git commit -m "feat(settings): hierarchical settings registry + effective resolution"
```

---

### Task 3.2: Shared `HierarchicalSettingsCard` component

**Files:**
- Create: `src/components/settings/HierarchicalSettingsCard.svelte`
- (No unit test — this is presentational; business logic lives in the registry/3.1 and load-save/3.3–4.1. Per project rules, do not assert on styling.)

**Interfaces:**
- Consumes: `HIERARCHICAL_SETTINGS` (3.1).
- Produces (Props):
  ```ts
  interface Props {
    mode: 'global' | 'project'
    values: Record<string, string>          // effective string values, keyed by setting key
    pluginRows: { id: string; name: string; enabled: boolean }[]
    onChange: (key: string, value: string) => void
    onPluginToggle: (pluginId: string, enabled: boolean) => void
    onResetToGlobal?: () => void             // shown only in project mode
    disabled?: boolean
  }
  ```

- [ ] **Step 1: Create the component**

Render one grouped card titled "Configuration". Iterate `HIERARCHICAL_SETTINGS.filter(s => s.levels.includes(mode))`. For each def, render by `control`:
- `toggle`: a daisyUI `toggle toggle-primary toggle-sm`, `checked={values[key] === 'true'}`, `onchange` → `onChange(key, checked ? 'true' : 'false')`.
- `select`: a `select select-bordered select-sm` over `def.options`, `value={values[key]}`, `onchange` → `onChange(key, value)`.
- `text`: an `input input-bordered input-sm`, `value={values[key]}`, `oninput` → `onChange(key, value)`.
- `number`: an `input type=number`, `value={values[key]}`, `oninput` → `onChange(key, value)`.
- `plugins`: a list of `pluginRows`, each a toggle → `onPluginToggle(id, enabled)`.

In `mode === 'project'`, render a "Default to global settings" button (`btn btn-sm btn-ghost`) wired to `onResetToGlobal`. Use `$props()` with the local `Props` interface, `on`-prefixed callbacks, daisyUI classes only, no hex. Keep the exact same markup/classes for both modes so global and project look identical (the only differences: the reset button, and which settings render based on `levels`).

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/HierarchicalSettingsCard.svelte
git commit -m "feat(settings): shared HierarchicalSettingsCard component"
```

---

### Task 3.3: Global settings — load/save new keys + mount the card

**Files:**
- Modify: `src/lib/settingsConfig.ts` (`GlobalSettingsConfig`, `DEFAULT_GLOBAL_SETTINGS`, `loadGlobalSettings`)
- Modify: `src/lib/settingsSaver.ts` (`GlobalSettingsSavePayload`, `saveGlobalSettings`)
- Modify: `src/components/settings/SettingsView.svelte` (global branch: build `values`, mount `HierarchicalSettingsCard mode="global"`, load global plugin defaults)
- Test: `src/lib/settingsConfig.test.ts` (create if absent) / `src/lib/settingsSaver.test.ts`

**Interfaces:**
- Consumes: `getConfig`/`setConfig` (existing), `getGlobalPluginDefaults`/`setGlobalPluginDefault` (1.7).
- Produces: `GlobalSettingsConfig` gains `handoffNotesEnabled: boolean` and `useWorktrees: boolean` (provider/prefix/poll already present or added). Booleans still serialize as `'true'`/`'false'`.

- [ ] **Step 1: Write the failing test**

Create/extend `src/lib/settingsConfig.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ipc from './ipc'
import { loadGlobalSettings } from './settingsConfig'

describe('loadGlobalSettings hierarchy keys', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('loads handoff + worktrees globals with correct defaults', async () => {
    vi.spyOn(ipc, 'getConfig').mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        handoff_notes_enabled: 'true',
        use_worktrees: 'false',
      }
      return map[key] ?? null
    })
    const s = await loadGlobalSettings()
    expect(s.handoffNotesEnabled).toBe(true)
    expect(s.useWorktrees).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/settingsConfig.test.ts`
Expected: FAIL — fields absent.

- [ ] **Step 3: Extend config load/save**

In `settingsConfig.ts`: add `handoffNotesEnabled: boolean` and `useWorktrees: boolean` to `GlobalSettingsConfig`; add defaults (`handoffNotesEnabled: true`, `useWorktrees: true`) to `DEFAULT_GLOBAL_SETTINGS`; add `getConfig('handoff_notes_enabled')` and `getConfig('use_worktrees')` to the `Promise.all` in `loadGlobalSettings` and map them (`=== 'true'`, but handoff defaults true when null: `handoffNotesEnabled: v == null ? true : v === 'true'`).

In `settingsSaver.ts`: add both to `GlobalSettingsSavePayload` and `setConfig('handoff_notes_enabled', ...)` / `setConfig('use_worktrees', ...)` in `saveGlobalSettings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/settingsConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount the card in the global branch**

In `SettingsView.svelte` global branch, build a `values: Record<string,string>` from the loaded `GlobalSettingsConfig` (map each hierarchy key to its string form) and render `<HierarchicalSettingsCard mode="global" {values} pluginRows={globalPluginRows} onChange={handleGlobalSettingChange} onPluginToggle={handleGlobalPluginToggle} />`. `handleGlobalSettingChange(key, value)` updates the corresponding global state field and triggers the existing debounced save. `globalPluginRows` comes from `getGlobalPluginDefaults()` merged with the installed-plugins list; `handleGlobalPluginToggle` calls `setGlobalPluginDefault`. Replace the two toggles in `SettingsExperimentalCard` usage with the grouped card (or leave the Experimental card for non-hierarchy items and move cleanup/title-update into the new card — move them, so the flowing settings are grouped).

- [ ] **Step 6: Verify + commit**

Run: `pnpm exec tsc --noEmit` and `pnpm test src/lib`
Expected: PASS.

```bash
git add src/lib/settingsConfig.ts src/lib/settingsSaver.ts src/lib/settingsConfig.test.ts src/components/settings/SettingsView.svelte
git commit -m "feat(settings): global defaults for handoff/worktrees + grouped card"
```

---

# Phase 4 — Project UI + reset + task dialog (frontend)

### Task 4.1: Project settings — mount the card with effective values + save overrides

**Files:**
- Modify: `src/lib/settingsConfig.ts` (`loadProjectSettings` — load raw project overrides for the hierarchy keys)
- Modify: `src/lib/settingsSaver.ts` (`saveProjectSettings` — persist the hierarchy keys)
- Modify: `src/components/settings/SettingsView.svelte` (project branch: compute effective via `computeEffectiveProjectSettings`, mount `HierarchicalSettingsCard mode="project"`)
- Test: `src/lib/settingsConfig.test.ts`

**Interfaces:**
- Consumes: `computeEffectiveProjectSettings` (3.1), `getProjectConfig`/`setProjectConfig` (existing), `getEnabledPlugins`/`setPluginEnabled` (existing).

- [ ] **Step 1: Write the failing test**

```ts
import { computeEffectiveProjectSettings } from './hierarchicalSettings'

it('project effective merges raw overrides over globals', () => {
  const eff = computeEffectiveProjectSettings(
    { use_worktrees: 'true', task_id_prefix: 'T' },
    { use_worktrees: 'false' }, // task_id_prefix absent -> inherits 'T'
  )
  expect(eff.use_worktrees).toBe('false')
  expect(eff.task_id_prefix).toBe('T')
})
```

(This exercises the merge the project UI relies on; add it to `hierarchicalSettings.test.ts`.)

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `pnpm test src/lib/hierarchicalSettings.test.ts`
Expected: PASS if 3.1 is complete (this locks the contract the UI uses).

- [ ] **Step 3: Wire project load/save + card**

In the project branch of `SettingsView.svelte`:
- Load global settings (for inheritance) and the raw project overrides for each hierarchy key (`getProjectConfig(projectId, key)` → `null` when unset).
- `const effective = computeEffectiveProjectSettings(globalStrings, projectRawStrings)`.
- Render `<HierarchicalSettingsCard mode="project" values={effective} pluginRows={projectPluginRows} onChange={handleProjectSettingChange} onPluginToggle={handleProjectPluginToggle} onResetToGlobal={handleResetToGlobal} />`.
- `handleProjectSettingChange(key, value)` calls `setProjectConfig(projectId, key, value)` (writes an explicit override) and updates local state so the toggle reflects immediately. `handleProjectPluginToggle` uses the existing `setPluginEnabled`.
- Extend `loadProjectSettings`/`saveProjectSettings` for `code_cleanup_tasks_enabled`, `task_display_title_metadata_updates_enabled`, `handoff_notes_enabled`, `github_poll_interval` (provider, worktrees, prefix already partially present — align them).

- [ ] **Step 4: Verify + commit**

Run: `pnpm exec tsc --noEmit` and `pnpm test src/lib`
Expected: PASS.

```bash
git add src/lib/settingsConfig.ts src/lib/settingsSaver.ts src/components/settings/SettingsView.svelte src/lib/hierarchicalSettings.test.ts
git commit -m "feat(settings): project overrides via shared card"
```

---

### Task 4.2: "Default to global settings" reset

**Files:**
- Modify: `src/components/settings/SettingsView.svelte` (`handleResetToGlobal`)
- Test: `src/lib/settingsSaver.test.ts` (if a thin wrapper is added) — otherwise rely on the Rust reset test (1.7) + a frontend test of the handler’s post-state reload.

**Interfaces:**
- Consumes: `resetProjectSettingsToGlobal` (1.7), then reloads project settings so the card shows re-inherited effective values.

- [ ] **Step 1: Write the failing test (handler contract)**

Add a focused test for a small extracted helper `resetProjectAndReload(projectId, reload)` in a testable module (e.g. `src/lib/settingsProjectSync.ts`), asserting it calls `resetProjectSettingsToGlobal` then the reload callback:

```ts
import { vi, it, expect } from 'vitest'
import * as ipc from './ipc'
import { resetProjectAndReload } from './settingsProjectSync'

it('resets then reloads', async () => {
  const spy = vi.spyOn(ipc, 'resetProjectSettingsToGlobal').mockResolvedValue()
  const reload = vi.fn().mockResolvedValue(undefined)
  await resetProjectAndReload('P-1', reload)
  expect(spy).toHaveBeenCalledWith('P-1')
  expect(reload).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/settingsProjectSync.test.ts`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement helper + wire the button**

Add to `src/lib/settingsProjectSync.ts`:

```ts
import { resetProjectSettingsToGlobal } from './ipc'

export async function resetProjectAndReload(
  projectId: string,
  reload: () => Promise<void>,
): Promise<void> {
  await resetProjectSettingsToGlobal(projectId)
  await reload()
}
```

Wire `handleResetToGlobal` in `SettingsView.svelte` to `resetProjectAndReload(activeProjectId, reloadProjectSettings)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/settingsProjectSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settingsProjectSync.ts src/lib/settingsProjectSync.test.ts src/components/settings/SettingsView.svelte
git commit -m "feat(settings): default-to-global reset for project overrides"
```

---

### Task 4.3: New-task dialog — task-level toggles seeded from project effective

**Files:**
- Modify: `src/components/AddTaskDialog.svelte` (`initializeDialog` seeding ~`:137`; the create call ~`:413`; add the grouped task-level controls near the existing handoff/worktree toggles ~`:709`)
- Test: `src/components/AddTaskDialog.*.test.ts` if one exists, else a small logic helper test

**Interfaces:**
- Consumes: `getProjectConfig`/`getConfig` (or a shared `loadTaskDefaults(projectId)` helper) to seed each task-level setting from the project's effective value; `createTask` new options (1.5).
- Produces: on create, passes `codeCleanupEnabled`, `taskDisplayTitleUpdatesEnabled`, `aiProvider`, plus existing `handoffNotesEnabled` and worktree source.

- [ ] **Step 1: Write the failing test (seeding logic)**

Extract the seeding into a testable helper `loadTaskLevelDefaults(projectId)` in `src/lib/taskDefaults.ts` returning `{ codeCleanupEnabled, taskDisplayTitleUpdatesEnabled, handoffNotesEnabled, aiProvider, useWorktrees }`, each resolved as project ?? global ?? default. Test it with mocked ipc:

```ts
import { vi, it, expect, beforeEach } from 'vitest'
import * as ipc from './ipc'
import { loadTaskLevelDefaults } from './taskDefaults'

beforeEach(() => vi.restoreAllMocks())

it('seeds cleanup from project override over global', async () => {
  vi.spyOn(ipc, 'getConfig').mockImplementation(async (k) =>
    k === 'code_cleanup_tasks_enabled' ? 'false' : null)
  vi.spyOn(ipc, 'getProjectConfig').mockImplementation(async (_p, k) =>
    k === 'code_cleanup_tasks_enabled' ? 'true' : null)
  const d = await loadTaskLevelDefaults('P-1')
  expect(d.codeCleanupEnabled).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/taskDefaults.test.ts`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement helper + wire dialog**

Create `src/lib/taskDefaults.ts` resolving each task-level key `project ?? global ?? default` (reuse `computeEffectiveProjectSettings` where convenient; for provider use `getResolvedAiProvider`). In `AddTaskDialog.svelte`, call it in `initializeDialog`, store `$state` for each toggle (cleanup, title-update, handoff already exists, provider already exists), render the grouped toggles beside the existing handoff/worktree toggles reusing the same daisyUI toggle markup, and include the values in the `createTask(...)` options object.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/taskDefaults.test.ts` then `pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskDefaults.ts src/lib/taskDefaults.test.ts src/components/AddTaskDialog.svelte
git commit -m "feat(tasks): new-task dialog seeds task-level settings from project"
```

---

# Final verification + review

- [ ] **Full backend suite:** `cargo test` from `src-tauri/` — all pass.
- [ ] **Frontend:** `pnpm exec tsc --noEmit` and `pnpm test` — all pass. Fix any migration/contract snapshot tests that assert on command lists or schema (expected to need updates for the new commands/tables).
- [ ] **Manual smoke (verify skill):** set a global default → open a project, confirm the grouped card shows it, override it, confirm "Default to global settings" clears the override → create a task, confirm the dialog seeds from the project and the override persists (check `task_config`) and drives the start prompt.
- [ ] **Post-implementation review** (Babysitter review effect / `superpowers:requesting-code-review`): resolve blocking findings before handoff.
- [ ] **Update OpenForge handoff notes** (`openforge task update --task-id AVIV-68 --summary ...`) with final status.

## Self-review notes (coverage against spec)

- Spec settings 1–8 → Tasks 1.x (storage/resolvers) + 2.x (consume-sites) + 3.x/4.x (UI). ✅
- `task_config` + `global_plugins` tables → 1.1. ✅
- Snapshot-at-creation → 1.5; legacy fallback via `resolve_task_bool`/`resolve_ai_provider_for_task` → 1.4/2.x. ✅
- Shared identical component + registry → 3.1/3.2, mounted in global (3.3) and project (4.1). ✅
- "Default to global settings" scoped to hierarchy keys only → 1.7 (`HIERARCHY_PROJECT_CONFIG_KEYS`) + 4.2. ✅
- No per-task plugin/prefix/poll (registry `levels`) → 3.1. ✅
- Per-project prefix trade-off (global counter retained) documented → 1.6. ✅
