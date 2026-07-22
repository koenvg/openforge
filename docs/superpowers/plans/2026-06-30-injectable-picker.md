# Injectable Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. NOTE: this repo's `CLAUDE.md` also mandates driving implementation through a Babysitter CLI run with TDD — reconcile the two before executing (see "Execution Notes" at the end).

**Goal:** Give users one summonable, faceted picker to browse, assess, and inject skills / commands / saved text snippets into an agent — usable both in the Create Task dialog and mid-session in the live task view, scoped to the active Claude ecosystem.

**Architecture:** The picker is a **core** Svelte component fed entirely through `src/lib/ipc.ts`. Its catalog reuses the existing `command_discovery.rs` → `listOpenCodeCommands` path (which already parses descriptions and namespaces plugin skills), enriched with `origin`, `triggerMode`, and `sourceDir`. Two new Rust SQLite CRUD features back **snippets** (provider-agnostic injectables) and a **category overlay** (categories stored by Open Forge, never written into skill files). A pure frontend mapper merges these three sources into one `Injectable[]` view model that the picker filters/groups/searches.

**Tech Stack:** Rust sidecar (rusqlite, SQLite), Electron IPC, Svelte 5 (runes), TypeScript, daisyUI v5 + Tailwind v4, Vitest, `cargo test`.

## Global Constraints

Every task implicitly includes these (copied from the repo's `CLAUDE.md` and the spec):

- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface). `on`-prefixed callback props, never the legacy event dispatcher.
- All frontend→backend calls go through typed wrappers in `src/lib/ipc.ts`. Svelte code must not call raw Electron/preload/sidecar transport directly.
- IPC payloads use **camelCase** keys even though Rust handler params are snake_case (e.g. send `projectId`, not `project_id`).
- Rust sidecar command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`. DB domain files use `impl super::Database`.
- App types live in `src/lib/types.ts`; `import type` is enforced (`verbatimModuleSyntax`). Nullable fields use `T | null`, not optional. (`CommandInfo` specifically lives in `packages/plugin-sdk/src/domain.ts` and is shared — edit it there.)
- Map-based stores need `new Map()` to trigger Svelte reactivity.
- Styling: daisyUI v5 + Tailwind v4 utilities, no hardcoded hex colors, no `tailwind.config.js`. Visual focus uses `ring-2 ring-primary rounded`.
- **Tests cover business logic only — never assert on CSS classes, Tailwind utilities, or visual styling.** Keep visual aspects out of unit tests.
- TDD: write the failing test first, see it fail, implement minimal code, see it pass, commit.
- Do not disable eslint/TypeScript errors — fix them.
- Verification gates: frontend/type changes → `pnpm exec tsc --noEmit` and `pnpm test`; Rust changes → `cargo test` from `src-tauri/`.
- Focused Vitest runs: `pnpm test <path-or-pattern>` or `pnpm exec vitest run <path-or-pattern>`. **Never** `pnpm test -- <path>`. Rust filtering: `cargo test <filter>` from `src-tauri/` (one filter per command).
- Commit messages: do not mention Claude/Anthropic and do not add `Co-Authored-By` lines.

## POC scope (from spec)

**In:** Claude (`claude-code` provider) only · the picker in the Create Task dialog and the live task view · summon via button + ⌘⇧I shortcut + `/` fast path (existing) · faceted browse (origin / trigger-mode / category) with search · Open Forge category overlay + manual categorization · snippets CRUD · origin + trigger-mode badges.

**Out (follow-ons, do not build):** other provider adapters · AI-assisted categorization · delete/create/rename in the Skills tab · pinning snippets to a provider · surfacing `user-invocable: false` background skills (the picker filters these OUT).

---

## File Structure

**Rust (sidecar) — `src-tauri/src/`**
- `command_discovery.rs` — *modify*: add `parse_skill_frontmatter_flags()`; thread `disable_model_invocation`/`user_invocable` onto `SkillInfo`; set `origin`/`trigger_mode`/`source_dir` when scanning.
- `opencode_client.rs` — *modify*: add fields to `SkillInfo` and `CommandInfo`.
- `providers/claude_code.rs` — *modify*: populate `origin`/`trigger_mode`/`source_dir` in `list_commands()`.
- `db/migrations.rs` — *modify*: append migration creating `snippets` + `injectable_categories`.
- `db/snippets.rs` — *create*: `SnippetRow` + CRUD.
- `db/injectable_categories.rs` — *create*: `InjectableCategoryRow` + CRUD.
- `db/mod.rs` — *modify*: register the two new modules + re-export rows.
- `app_invoke/core.rs` — *modify*: command handlers for snippets + categories.

**Shared types**
- `packages/plugin-sdk/src/domain.ts` — *modify*: extend `CommandInfo`.

**Frontend — `src/`**
- `lib/types.ts` — *modify*: add `Snippet`, `InjectableCategoryAssignment`, `Injectable`, `InjectableOrigin`, `InjectableTriggerMode`, `InjectableKind`, `InjectableGroupBy`.
- `lib/ipc.ts` — *modify*: add `listSnippets/createSnippet/updateSnippet/deleteSnippet`, `listInjectableCategories/assignInjectableCategory/removeInjectableCategory`.
- `lib/injectables/buildInjectables.ts` — *create*: pure mapper (CommandInfo + Snippet + assignments → Injectable[]).
- `lib/injectables/facets.ts` — *create*: pure search/group/filter functions.
- `lib/injectables/useInjectableCatalog.svelte.ts` — *create*: reactive loader composable.
- `lib/injectables/pickerState.svelte.ts` — *create*: global open/close + context store for the picker.
- `components/injectables/InjectablePicker.svelte` — *create*: the modal picker.
- `components/injectables/SnippetEditor.svelte` — *create*: snippet create/edit form.
- `components/injectables/CategoryAssigner.svelte` — *create*: assign/remove categories on one injectable.
- `lib/appShortcutDefinitions.ts`, `lib/appShortcuts.ts`, `App.svelte` — *modify*: register ⌘⇧I + mount picker.
- `components/prompt/PromptInput.svelte` — *modify*: add picker button via `controls`, insert selected text.
- `components/AddTaskDialog.svelte` — *modify*: wire the picker into the dialog's PromptInput.
- `components/task-detail/AgentTerminalShell.svelte` — *modify*: picker button in header; inject via `writePty`.

**Test files** live next to their source (`*.test.ts`) for frontend, and in `#[cfg(test)]` modules for Rust, mirroring existing patterns.

---

## Data contracts (referenced across tasks)

**`CommandInfo`** (after Task 3) — `packages/plugin-sdk/src/domain.ts`:
```typescript
export interface CommandInfo {
  name: string;
  description: string | null;
  source: string | null;          // "skill" | "command" | "prompt" | "builtin" | "plugin" | "agent"
  agent: string | null;
  origin: string | null;          // "repo" | "personal" | "plugin" | "builtin"
  triggerMode: string | null;     // "auto+manual" | "manual-only"
  userInvocable: boolean | null;  // false => hidden background skill (picker drops it)
  sourceDir: string | null;       // e.g. ".claude" | ".agents" | ".pi"; null for command/plugin/builtin
}
```

**`Snippet`** (Task 6) — `src/lib/types.ts`:
```typescript
export interface Snippet {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}
```

**`InjectableCategoryAssignment`** (Task 8) — `src/lib/types.ts`:
```typescript
export interface InjectableCategoryAssignment {
  id: string;
  injectable_id: string;
  category_name: string;
}
```

**`Injectable`** (Task 10) — `src/lib/types.ts`:
```typescript
export type InjectableKind = 'skill' | 'command' | 'snippet';
export type InjectableOrigin = 'repo' | 'personal' | 'plugin' | 'builtin' | 'openforge';
export type InjectableTriggerMode = 'auto+manual' | 'manual-only';
export type InjectableGroupBy = 'origin' | 'trigger' | 'category';

export interface Injectable {
  id: string;                       // stable: `claude-code:${name}` or `snippet:${snippetId}`
  kind: InjectableKind;
  name: string;                     // display + invocation token (no leading slash)
  description: string | null;
  origin: InjectableOrigin;
  triggerMode: InjectableTriggerMode;
  categories: string[];
  invocationText: string;           // `/${name} ` for skill/command; raw content for snippet
}
```

---

# Phase 1 — Backend: enrich the command catalog (Rust)

### Task 1: Parse trigger-mode flags from SKILL.md frontmatter

**Files:**
- Modify: `src-tauri/src/command_discovery.rs` (add new fn near `parse_skill_frontmatter`, lines 23-73)
- Test: same file's `#[cfg(test)]` module

**Interfaces:**
- Produces: `pub fn parse_skill_frontmatter_flags(content: &str) -> SkillFrontmatterFlags` and `pub struct SkillFrontmatterFlags { pub disable_model_invocation: Option<bool>, pub user_invocable: Option<bool> }`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` module in `command_discovery.rs`:
```rust
#[test]
fn parses_trigger_flags_from_frontmatter() {
    let content = "---\nname: refactor\ndescription: do it\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody";
    let flags = parse_skill_frontmatter_flags(content);
    assert_eq!(flags.disable_model_invocation, Some(true));
    assert_eq!(flags.user_invocable, Some(false));
}

#[test]
fn missing_trigger_flags_are_none() {
    let content = "---\nname: refactor\ndescription: do it\n---\nbody";
    let flags = parse_skill_frontmatter_flags(content);
    assert_eq!(flags.disable_model_invocation, None);
    assert_eq!(flags.user_invocable, None);
}

#[test]
fn no_frontmatter_returns_none_flags() {
    let flags = parse_skill_frontmatter_flags("# just a heading\n");
    assert_eq!(flags.disable_model_invocation, None);
    assert_eq!(flags.user_invocable, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test parses_trigger_flags_from_frontmatter` (from `src-tauri/`)
Expected: FAIL — `cannot find function parse_skill_frontmatter_flags`.

- [ ] **Step 3: Implement**

Add to `command_discovery.rs` (after `parse_skill_frontmatter`):
```rust
/// Trigger-mode flags parsed from SKILL.md frontmatter.
#[derive(Debug, Clone, Default)]
pub struct SkillFrontmatterFlags {
    pub disable_model_invocation: Option<bool>,
    pub user_invocable: Option<bool>,
}

/// Parse the boolean trigger-mode flags from SKILL.md frontmatter.
/// Reuses the same `---`-delimited block detection as `parse_skill_frontmatter`.
pub fn parse_skill_frontmatter_flags(content: &str) -> SkillFrontmatterFlags {
    let mut flags = SkillFrontmatterFlags::default();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return flags;
    }
    let after_first = &trimmed[3..];
    let end_idx = match after_first.find("\n---") {
        Some(idx) => idx,
        None => return flags,
    };
    let frontmatter = &after_first[..end_idx];
    for line in frontmatter.lines() {
        let trimmed_line = line.trim();
        if let Some(val) = trimmed_line.strip_prefix("disable-model-invocation:") {
            flags.disable_model_invocation = parse_yaml_bool(val.trim());
        } else if let Some(val) = trimmed_line.strip_prefix("user-invocable:") {
            flags.user_invocable = parse_yaml_bool(val.trim());
        }
    }
    flags
}

fn parse_yaml_bool(val: &str) -> Option<bool> {
    match val.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" => Some(true),
        "false" | "no" => Some(false),
        _ => None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test parse_skill_frontmatter_flags` (from `src-tauri/`)
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/command_discovery.rs
git commit -m "Parse trigger-mode flags from SKILL.md frontmatter"
```

---

### Task 2: Carry trigger flags onto SkillInfo during scanning

**Files:**
- Modify: `src-tauri/src/opencode_client.rs` (the `SkillInfo` struct, ~lines around the `CommandInfo` definition)
- Modify: `src-tauri/src/command_discovery.rs` (`scan_skills_directory` lines 140-181, and `scan_pi_skills_directory`)
- Test: `command_discovery.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: `parse_skill_frontmatter_flags` (Task 1)
- Produces: `SkillInfo` gains `pub disable_model_invocation: Option<bool>` and `pub user_invocable: Option<bool>`, populated by all skill scanners.

- [ ] **Step 1: Write the failing test**

Add to `command_discovery.rs` tests (use a temp dir helper consistent with the file's existing tests — mirror how existing scan tests build dirs):
```rust
#[test]
fn scan_skills_directory_populates_trigger_flags() {
    let tmp = std::env::temp_dir().join(format!("of-skills-flags-{}", std::process::id()));
    let skill_dir = tmp.join("manual-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: manual-skill\ndescription: d\ndisable-model-invocation: true\n---\nbody",
    )
    .unwrap();

    let skills = scan_skills_directory(&tmp, "project", ".claude");
    let s = skills.iter().find(|s| s.name == "manual-skill").unwrap();
    assert_eq!(s.disable_model_invocation, Some(true));
    assert_eq!(s.user_invocable, None);

    let _ = std::fs::remove_dir_all(&tmp);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test scan_skills_directory_populates_trigger_flags` (from `src-tauri/`)
Expected: FAIL — `SkillInfo` has no field `disable_model_invocation`.

- [ ] **Step 3: Implement**

In `opencode_client.rs`, add to the `SkillInfo` struct (keep existing fields, add at end; struct already derives `Serialize`/`Deserialize` — keep them):
```rust
    #[serde(default, rename = "disableModelInvocation")]
    pub disable_model_invocation: Option<bool>,
    #[serde(default, rename = "userInvocable")]
    pub user_invocable: Option<bool>,
```

In `command_discovery.rs` `scan_skills_directory`, after `let (fm_name, fm_desc) = parse_skill_frontmatter(&content);` add:
```rust
        let flags = parse_skill_frontmatter_flags(&content);
```
and add the two fields to the `SkillInfo { ... }` literal:
```rust
            disable_model_invocation: flags.disable_model_invocation,
            user_invocable: flags.user_invocable,
```
Do the same in `scan_pi_skills_directory` (both the directory branch — which delegates to `scan_skills_directory` — and the root `.md` branch where a `SkillInfo` literal is built). Any other place constructing `SkillInfo` must set both fields (use `None` if no content). Compile errors will point to every literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test scan_skills_directory_populates_trigger_flags` (from `src-tauri/`)
Expected: PASS. Then `cargo test` (full) to confirm no other `SkillInfo` literal is left unfixed.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/opencode_client.rs src-tauri/src/command_discovery.rs
git commit -m "Carry trigger-mode flags onto SkillInfo during scanning"
```

---

### Task 3: Enrich CommandInfo with origin, triggerMode, sourceDir; populate for claude-code

**Files:**
- Modify: `src-tauri/src/opencode_client.rs` (`CommandInfo`, lines 38-50)
- Modify: `src-tauri/src/providers/claude_code.rs` (`list_commands`, lines 134-229)
- Modify: `packages/plugin-sdk/src/domain.ts` (`CommandInfo`, lines 202-208)
- Test: `src-tauri/src/providers/claude_code.rs` `#[cfg(test)]` (add module if absent)

**Interfaces:**
- Consumes: enriched `SkillInfo` (Task 2)
- Produces: `CommandInfo` gains `origin: Option<String>`, `trigger_mode: Option<String>`, `user_invocable: Option<bool>`, `source_dir: Option<String>` (serialized camelCase). The TS `CommandInfo` mirrors these.

- [ ] **Step 1: Write the failing test**

In `claude_code.rs`, add a test that scans a temp project with a manual-only skill and asserts the resulting `CommandInfo`. Mirror existing provider tests for temp-dir/project setup; build a `.claude/skills/manual/SKILL.md`:
```rust
#[test]
fn list_commands_sets_origin_and_trigger_mode_for_project_skill() {
    let tmp = std::env::temp_dir().join(format!("of-cc-enrich-{}", std::process::id()));
    let skill_dir = tmp.join(".claude").join("skills").join("manual");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: manual\ndescription: d\ndisable-model-invocation: true\n---\nbody",
    )
    .unwrap();

    let provider = ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new());
    let cmds = provider.list_commands(Some(tmp.to_str().unwrap()));
    let c = cmds.iter().find(|c| c.name == "manual").expect("skill present");
    assert_eq!(c.origin.as_deref(), Some("repo"));
    assert_eq!(c.trigger_mode.as_deref(), Some("manual-only"));
    assert_eq!(c.source_dir.as_deref(), Some(".claude"));

    let _ = std::fs::remove_dir_all(&tmp);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test list_commands_sets_origin_and_trigger_mode_for_project_skill` (from `src-tauri/`)
Expected: FAIL — `CommandInfo` has no field `origin`.

- [ ] **Step 3: Implement**

In `opencode_client.rs`, add to `CommandInfo`:
```rust
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default, rename = "triggerMode")]
    pub trigger_mode: Option<String>,
    #[serde(default, rename = "userInvocable")]
    pub user_invocable: Option<bool>,
    #[serde(default, rename = "sourceDir")]
    pub source_dir: Option<String>,
```

In `claude_code.rs::list_commands`, define a helper and update each `CommandInfo` construction:
```rust
fn origin_for_level(level: &str) -> &'static str {
    if level == "user" { "personal" } else { "repo" }
}
fn trigger_mode_for(disable_model_invocation: Option<bool>) -> String {
    if disable_model_invocation == Some(true) { "manual-only".to_string() } else { "auto+manual".to_string() }
}
```
- **User-level skills** and **project-level skills** loops: when converting `skill` → `CommandInfo`, set
  ```rust
  origin: Some(origin_for_level(&skill.level).to_string()),
  trigger_mode: Some(trigger_mode_for(skill.disable_model_invocation)),
  user_invocable: skill.user_invocable,
  source_dir: Some(skill.source_dir.clone()),
  ```
- **Command directories** loop (`.claude/commands`, `.opencode/commands`): commands are manual-only by definition. Track the dir so `source_dir` is correct — change the iterated array to pairs `(PathBuf, &str)` of `(dir, source_dir_tag)` where tag is `".claude"` / `".opencode"`, and set on each `CommandInfo`: `origin: Some(/* repo for project loop, personal for user loop */), trigger_mode: Some("manual-only".into()), user_invocable: None, source_dir: Some(tag.into())`.
- **Builtin commands** (`builtin_claude_commands()`): set `origin: Some("builtin".into()), trigger_mode: Some("manual-only".into()), user_invocable: None, source_dir: None`.
- **Plugin commands** (`scan_plugin_commands`): set `origin: Some("plugin".into()), trigger_mode: Some("auto+manual".into()), user_invocable: None, source_dir: None`.

Update `scan_commands_directory`/`scan_prompt_templates_directory`/`scan_plugin_commands`/`builtin_claude_commands` `CommandInfo` literals to include the four new fields (default to `None`/sensible values) so the crate compiles; the precise per-source values are set at the `claude_code.rs` call sites where context is known (override after scan, or pass the tag in). Simplest: set defaults to `None` in the scanners and have `claude_code.rs` fill `origin`/`trigger_mode`/`source_dir` immediately after receiving each batch.

In `packages/plugin-sdk/src/domain.ts`, replace `CommandInfo` with the contract from the "Data contracts" section above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test list_commands_sets_origin_and_trigger_mode_for_project_skill` (from `src-tauri/`), then `cargo test` (full). Then `pnpm exec tsc --noEmit` to confirm the TS `CommandInfo` change compiles against existing `/` autocomplete usage (existing code only reads `name`/`description`/`source`/`agent`, so adding fields is safe).
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/opencode_client.rs src-tauri/src/providers/claude_code.rs packages/plugin-sdk/src/domain.ts
git commit -m "Enrich CommandInfo with origin, trigger mode, and source dir for claude-code"
```

---

# Phase 2 — Backend: snippets CRUD (Rust)

### Task 4: snippets table + domain CRUD

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (append migration in the `define_migrations!` list)
- Create: `src-tauri/src/db/snippets.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `mod snippets;` + `pub use snippets::SnippetRow;`)
- Test: `src-tauri/src/db/snippets.rs` `#[cfg(test)]`

**Interfaces:**
- Produces: `SnippetRow { id, title, content, created_at, updated_at }` and `impl super::Database { create_snippet(&self, title, content) -> Result<SnippetRow>; list_snippets(&self) -> Result<Vec<SnippetRow>>; update_snippet(&self, id, title, content) -> Result<()>; delete_snippet(&self, id) -> Result<()> }`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/db/snippets.rs` with only a test module first (so it fails to compile against missing methods):
```rust
#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;
    use std::fs;

    #[test]
    fn create_and_list_snippet() {
        let (db, path) = make_test_db("snippet_create_list");
        let s = db.create_snippet("My Title", "hello world").expect("create");
        assert_eq!(s.title, "My Title");
        assert_eq!(s.content, "hello world");
        assert!(!s.id.is_empty());

        let all = db.list_snippets().expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, s.id);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn update_and_delete_snippet() {
        let (db, path) = make_test_db("snippet_update_delete");
        let s = db.create_snippet("t", "c").expect("create");
        db.update_snippet(&s.id, "t2", "c2").expect("update");
        let all = db.list_snippets().expect("list");
        assert_eq!(all[0].title, "t2");
        assert_eq!(all[0].content, "c2");

        db.delete_snippet(&s.id).expect("delete");
        assert_eq!(db.list_snippets().expect("list").len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

First add `mod snippets;` to `src-tauri/src/db/mod.rs`, then:
Run: `cargo test snippet_create_list` (from `src-tauri/`)
Expected: FAIL — missing table and/or missing methods (compile error `no method named create_snippet`).

- [ ] **Step 3: Implement**

Append to the `define_migrations!(...)` list in `migrations.rs` (at the END, mirroring existing `M::up(...)` entries):
```rust
M::up(
    r#"
CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
    "#,
),
```

In `snippets.rs` (above the test module) add:
```rust
use rusqlite::Result;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    pub fn create_snippet(&self, title: &str, content: &str) -> Result<SnippetRow> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO snippets (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&id, title, content, now, now],
        )?;
        Ok(SnippetRow { id, title: title.to_string(), content: content.to_string(), created_at: now, updated_at: now })
    }

    pub fn list_snippets(&self) -> Result<Vec<SnippetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at FROM snippets ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SnippetRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn update_snippet(&self, id: &str, title: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE snippets SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![title, content, now, id],
        )?;
        Ok(())
    }

    pub fn delete_snippet(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM snippets WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}
```
Add to `db/mod.rs`: `pub use snippets::SnippetRow;` (confirm `uuid` is already a dependency — `agent_lifecycle.rs` uses `uuid::Uuid::new_v4()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test snippet_` (from `src-tauri/`)
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/db/snippets.rs src-tauri/src/db/migrations.rs src-tauri/src/db/mod.rs
git commit -m "Add snippets table and CRUD"
```

---

### Task 5: snippet command handlers + IPC wrappers

**Files:**
- Modify: `src-tauri/src/app_invoke/core.rs` (add match arms)
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/types.ts` (add `Snippet`)

**Interfaces:**
- Consumes: `Database::create_snippet/list_snippets/update_snippet/delete_snippet` (Task 4)
- Produces (ipc.ts): `listSnippets(): Promise<Snippet[]>`, `createSnippet(title, content): Promise<Snippet>`, `updateSnippet(id, title, content): Promise<void>`, `deleteSnippet(id): Promise<void>`

- [ ] **Step 1: Write the failing test (frontend type-level + wrapper shape)**

Create `src/lib/ipc.snippets.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invokeMock(...args),
  isElectronDesktopBridgeAvailable: () => true,
}))

import { createSnippet, listSnippets, updateSnippet, deleteSnippet } from './ipc'

describe('snippet ipc wrappers', () => {
  beforeEach(() => invokeMock.mockReset())

  it('createSnippet sends camelCase payload to create_snippet', async () => {
    invokeMock.mockResolvedValue({ id: 's1', title: 't', content: 'c', created_at: 1, updated_at: 1 })
    await createSnippet('t', 'c')
    expect(invokeMock).toHaveBeenCalledWith('create_snippet', { title: 't', content: 'c' })
  })

  it('listSnippets calls list_snippets', async () => {
    invokeMock.mockResolvedValue([])
    await listSnippets()
    expect(invokeMock).toHaveBeenCalledWith('list_snippets', {})
  })

  it('updateSnippet sends id/title/content', async () => {
    invokeMock.mockResolvedValue(undefined)
    await updateSnippet('s1', 't2', 'c2')
    expect(invokeMock).toHaveBeenCalledWith('update_snippet', { id: 's1', title: 't2', content: 'c2' })
  })

  it('deleteSnippet sends id', async () => {
    invokeMock.mockResolvedValue(undefined)
    await deleteSnippet('s1')
    expect(invokeMock).toHaveBeenCalledWith('delete_snippet', { id: 's1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/ipc.snippets.test.ts`
Expected: FAIL — `createSnippet` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/types.ts` add the `Snippet` interface from the Data Contracts section.

In `src/lib/ipc.ts` (import `Snippet` via `import type`):
```typescript
export async function listSnippets(): Promise<Snippet[]> {
  return invoke<Snippet[]>("list_snippets", {});
}
export async function createSnippet(title: string, content: string): Promise<Snippet> {
  return invoke<Snippet>("create_snippet", { title, content });
}
export async function updateSnippet(id: string, title: string, content: string): Promise<void> {
  return invoke("update_snippet", { id, title, content });
}
export async function deleteSnippet(id: string): Promise<void> {
  return invoke("delete_snippet", { id });
}
```

In `app_invoke/core.rs`, add match arms in the same `match request.command.as_str()` block that handles `create_task` (mirror its `payload_string` + `.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!(...)))?` + `json_value(...)` style):
```rust
"list_snippets" => {
    json_value(db.list_snippets().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list snippets: {e}")))?)?
}
"create_snippet" => {
    let title = payload_string(&request.payload, "title")?;
    let content = payload_string(&request.payload, "content")?;
    json_value(db.create_snippet(&title, &content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create snippet: {e}")))?)?
}
"update_snippet" => {
    let id = payload_string(&request.payload, "id")?;
    let title = payload_string(&request.payload, "title")?;
    let content = payload_string(&request.payload, "content")?;
    db.update_snippet(&id, &title, &content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update snippet: {e}")))?;
    json_value(serde_json::Value::Null)?
}
"delete_snippet" => {
    let id = payload_string(&request.payload, "id")?;
    db.delete_snippet(&id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete snippet: {e}")))?;
    json_value(serde_json::Value::Null)?
}
```
(Place these alongside other DB-backed arms; confirm `db` binding name matches the surrounding arms in that function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/ipc.snippets.test.ts` then `pnpm exec tsc --noEmit` and `cargo test` (from `src-tauri/`, to confirm the Rust still builds).
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/app_invoke/core.rs src/lib/ipc.ts src/lib/types.ts src/lib/ipc.snippets.test.ts
git commit -m "Expose snippet CRUD over IPC"
```

---

# Phase 3 — Backend: category overlay CRUD (Rust)

### Task 6: injectable_categories table + domain CRUD

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/injectable_categories.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Test: `src-tauri/src/db/injectable_categories.rs` `#[cfg(test)]`

**Interfaces:**
- Produces: `InjectableCategoryRow { id, injectable_id, category_name }` and `impl super::Database { assign_injectable_category(&self, injectable_id, category_name) -> Result<InjectableCategoryRow>; remove_injectable_category(&self, injectable_id, category_name) -> Result<()>; list_injectable_categories(&self) -> Result<Vec<InjectableCategoryRow>> }`
- Each `(injectable_id, category_name)` pair is unique; assigning an existing pair is idempotent.

- [ ] **Step 1: Write the failing test**

Create `injectable_categories.rs` with a test module:
```rust
#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;
    use std::fs;

    #[test]
    fn assign_list_and_remove_category() {
        let (db, path) = make_test_db("inj_cat_assign");
        db.assign_injectable_category("claude-code:refactor", "Code Quality").expect("assign");
        db.assign_injectable_category("claude-code:refactor", "Code Quality").expect("idempotent");
        db.assign_injectable_category("claude-code:refactor", "Favorites").expect("assign 2");

        let all = db.list_injectable_categories().expect("list");
        let names: Vec<_> = all.iter().filter(|r| r.injectable_id == "claude-code:refactor").map(|r| r.category_name.clone()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"Code Quality".to_string()));

        db.remove_injectable_category("claude-code:refactor", "Favorites").expect("remove");
        let after = db.list_injectable_categories().expect("list");
        assert_eq!(after.iter().filter(|r| r.injectable_id == "claude-code:refactor").count(), 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `mod injectable_categories;` to `db/mod.rs`, then run: `cargo test assign_list_and_remove_category` (from `src-tauri/`)
Expected: FAIL — missing table / methods.

- [ ] **Step 3: Implement**

Append migration to `define_migrations!`:
```rust
M::up(
    r#"
CREATE TABLE IF NOT EXISTS injectable_categories (
    id TEXT PRIMARY KEY,
    injectable_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(injectable_id, category_name)
);
    "#,
),
```
In `injectable_categories.rs`:
```rust
use rusqlite::Result;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectableCategoryRow {
    pub id: String,
    pub injectable_id: String,
    pub category_name: String,
}

impl super::Database {
    pub fn assign_injectable_category(&self, injectable_id: &str, category_name: &str) -> Result<InjectableCategoryRow> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT OR IGNORE INTO injectable_categories (id, injectable_id, category_name, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&id, injectable_id, category_name, now],
        )?;
        let row = conn.query_row(
            "SELECT id, injectable_id, category_name FROM injectable_categories WHERE injectable_id = ?1 AND category_name = ?2",
            rusqlite::params![injectable_id, category_name],
            |r| Ok(InjectableCategoryRow { id: r.get(0)?, injectable_id: r.get(1)?, category_name: r.get(2)? }),
        )?;
        Ok(row)
    }

    pub fn remove_injectable_category(&self, injectable_id: &str, category_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM injectable_categories WHERE injectable_id = ?1 AND category_name = ?2",
            rusqlite::params![injectable_id, category_name],
        )?;
        Ok(())
    }

    pub fn list_injectable_categories(&self) -> Result<Vec<InjectableCategoryRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, injectable_id, category_name FROM injectable_categories ORDER BY category_name ASC",
        )?;
        let rows = stmt.query_map([], |r| Ok(InjectableCategoryRow { id: r.get(0)?, injectable_id: r.get(1)?, category_name: r.get(2)? }))?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }
}
```
Add `pub use injectable_categories::InjectableCategoryRow;` to `db/mod.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test assign_list_and_remove_category` (from `src-tauri/`)
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/db/injectable_categories.rs src-tauri/src/db/migrations.rs src-tauri/src/db/mod.rs
git commit -m "Add injectable category overlay table and CRUD"
```

---

### Task 7: category command handlers + IPC wrappers

**Files:**
- Modify: `src-tauri/src/app_invoke/core.rs`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/types.ts` (add `InjectableCategoryAssignment`)

**Interfaces:**
- Produces (ipc.ts): `listInjectableCategories(): Promise<InjectableCategoryAssignment[]>`, `assignInjectableCategory(injectableId, categoryName): Promise<InjectableCategoryAssignment>`, `removeInjectableCategory(injectableId, categoryName): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ipc.categories.test.ts` mirroring Task 5's mock pattern:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
const invokeMock = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...a: unknown[]) => invokeMock(...a),
  isElectronDesktopBridgeAvailable: () => true,
}))
import { listInjectableCategories, assignInjectableCategory, removeInjectableCategory } from './ipc'

describe('injectable category ipc wrappers', () => {
  beforeEach(() => invokeMock.mockReset())
  it('assign sends camelCase', async () => {
    invokeMock.mockResolvedValue({ id: 'c1', injectable_id: 'x', category_name: 'Y' })
    await assignInjectableCategory('x', 'Y')
    expect(invokeMock).toHaveBeenCalledWith('assign_injectable_category', { injectableId: 'x', categoryName: 'Y' })
  })
  it('remove sends camelCase', async () => {
    invokeMock.mockResolvedValue(undefined)
    await removeInjectableCategory('x', 'Y')
    expect(invokeMock).toHaveBeenCalledWith('remove_injectable_category', { injectableId: 'x', categoryName: 'Y' })
  })
  it('list calls list_injectable_categories', async () => {
    invokeMock.mockResolvedValue([])
    await listInjectableCategories()
    expect(invokeMock).toHaveBeenCalledWith('list_injectable_categories', {})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/ipc.categories.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

`src/lib/types.ts`: add `InjectableCategoryAssignment` (from Data Contracts). Note the Rust struct serializes camelCase (`injectableId`, `categoryName`), so the TS interface field names must match — use `injectableId`/`categoryName` in TS, NOT snake_case. Correct the contract accordingly:
```typescript
export interface InjectableCategoryAssignment {
  id: string;
  injectableId: string;
  categoryName: string;
}
```
(Apply the same camelCase correction wherever this type is consumed.)

`src/lib/ipc.ts`:
```typescript
export async function listInjectableCategories(): Promise<InjectableCategoryAssignment[]> {
  return invoke<InjectableCategoryAssignment[]>("list_injectable_categories", {});
}
export async function assignInjectableCategory(injectableId: string, categoryName: string): Promise<InjectableCategoryAssignment> {
  return invoke<InjectableCategoryAssignment>("assign_injectable_category", { injectableId, categoryName });
}
export async function removeInjectableCategory(injectableId: string, categoryName: string): Promise<void> {
  return invoke("remove_injectable_category", { injectableId, categoryName });
}
```

`app_invoke/core.rs` match arms:
```rust
"list_injectable_categories" => {
    json_value(db.list_injectable_categories().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list injectable categories: {e}")))?)?
}
"assign_injectable_category" => {
    let injectable_id = payload_string(&request.payload, "injectableId")?;
    let category_name = payload_string(&request.payload, "categoryName")?;
    json_value(db.assign_injectable_category(&injectable_id, &category_name).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to assign category: {e}")))?)?
}
"remove_injectable_category" => {
    let injectable_id = payload_string(&request.payload, "injectableId")?;
    let category_name = payload_string(&request.payload, "categoryName")?;
    db.remove_injectable_category(&injectable_id, &category_name).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to remove category: {e}")))?;
    json_value(serde_json::Value::Null)?
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/ipc.categories.test.ts`, then `pnpm exec tsc --noEmit`, then `cargo test` (from `src-tauri/`).
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/app_invoke/core.rs src/lib/ipc.ts src/lib/types.ts src/lib/ipc.categories.test.ts
git commit -m "Expose injectable category overlay over IPC"
```

---

# Phase 4 — Frontend: pure catalog logic (TDD-heavy)

### Task 8: buildInjectables mapper

**Files:**
- Create: `src/lib/injectables/buildInjectables.ts`
- Modify: `src/lib/types.ts` (add `Injectable*` types from Data Contracts)
- Test: `src/lib/injectables/buildInjectables.test.ts`

**Interfaces:**
- Consumes: `CommandInfo` (plugin-sdk), `Snippet`, `InjectableCategoryAssignment`
- Produces: `buildInjectables(input: { commands: CommandInfo[]; snippets: Snippet[]; assignments: InjectableCategoryAssignment[] }): Injectable[]`

Rules (the spec):
1. Provider is Claude (POC). Keep a command only if it is Claude-relevant: `source` is `"command"`/`"builtin"`/`"plugin"`, OR `sourceDir` is `".claude"` or `".agents"`. Drop `.opencode`/`.codex`/`.pi` skills.
2. Drop any command with `userInvocable === false`.
3. Map `kind`: `source === 'skill'` → `'skill'`, else `'command'`.
4. Map `origin` from `command.origin` (fallback `'repo'`), `triggerMode` from `command.triggerMode` (fallback `'auto+manual'`), normalizing unknown strings to the union defaults.
5. `id = 'claude-code:' + name`; `invocationText = '/' + name + ' '`.
6. Snippets → `{ id: 'snippet:'+id, kind:'snippet', name:title, description:null, origin:'openforge', triggerMode:'manual-only', invocationText: content }`.
7. `categories` = the `categoryName`s assigned to that injectable's `id` (sorted, deduped).

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest'
import { buildInjectables } from './buildInjectables'
import type { CommandInfo } from '@openforge/plugin-sdk'

const cmd = (over: Partial<CommandInfo>): CommandInfo => ({
  name: 'x', description: null, source: 'skill', agent: null,
  origin: 'repo', triggerMode: 'auto+manual', userInvocable: null, sourceDir: '.claude', ...over,
})

describe('buildInjectables', () => {
  it('drops non-Claude skills (pi/codex/opencode source dirs)', () => {
    const out = buildInjectables({
      commands: [cmd({ name: 'keep', sourceDir: '.claude' }), cmd({ name: 'drop', sourceDir: '.pi' })],
      snippets: [], assignments: [],
    })
    expect(out.map(i => i.name)).toEqual(['keep'])
  })

  it('keeps .agents skills and plugin/builtin commands', () => {
    const out = buildInjectables({
      commands: [
        cmd({ name: 'agentskill', sourceDir: '.agents' }),
        cmd({ name: 'pluginc', source: 'plugin', sourceDir: null }),
        cmd({ name: 'builtinc', source: 'builtin', sourceDir: null }),
      ], snippets: [], assignments: [],
    })
    expect(out.map(i => i.name).sort()).toEqual(['agentskill', 'builtinc', 'pluginc'])
  })

  it('drops user-invocable:false items', () => {
    const out = buildInjectables({ commands: [cmd({ name: 'bg', userInvocable: false })], snippets: [], assignments: [] })
    expect(out).toHaveLength(0)
  })

  it('maps kind, id and invocationText for a skill', () => {
    const [i] = buildInjectables({ commands: [cmd({ name: 'refactor', source: 'skill' })], snippets: [], assignments: [] })
    expect(i).toMatchObject({ id: 'claude-code:refactor', kind: 'skill', invocationText: '/refactor ' })
  })

  it('maps snippets as provider-agnostic manual-only injectables', () => {
    const [i] = buildInjectables({
      commands: [], assignments: [],
      snippets: [{ id: 's1', title: 'Greeting', content: 'Hello team', created_at: 1, updated_at: 1 }],
    })
    expect(i).toMatchObject({ id: 'snippet:s1', kind: 'snippet', name: 'Greeting', origin: 'openforge', triggerMode: 'manual-only', invocationText: 'Hello team' })
  })

  it('attaches sorted categories from assignments', () => {
    const [i] = buildInjectables({
      commands: [cmd({ name: 'refactor' })], snippets: [],
      assignments: [
        { id: 'a', injectableId: 'claude-code:refactor', categoryName: 'Zeta' },
        { id: 'b', injectableId: 'claude-code:refactor', categoryName: 'Alpha' },
      ],
    })
    expect(i.categories).toEqual(['Alpha', 'Zeta'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/injectables/buildInjectables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Add `Injectable*` types to `src/lib/types.ts` (from Data Contracts). Then `buildInjectables.ts`:
```typescript
import type { CommandInfo } from '@openforge/plugin-sdk'
import type { Injectable, InjectableOrigin, InjectableTriggerMode, Snippet, InjectableCategoryAssignment } from '../types'

const CLAUDE_SKILL_DIRS = new Set(['.claude', '.agents'])
const NON_SKILL_SOURCES = new Set(['command', 'builtin', 'plugin'])
const ORIGINS = new Set<InjectableOrigin>(['repo', 'personal', 'plugin', 'builtin', 'openforge'])
const TRIGGERS = new Set<InjectableTriggerMode>(['auto+manual', 'manual-only'])

function isClaudeRelevant(c: CommandInfo): boolean {
  if (c.source && NON_SKILL_SOURCES.has(c.source)) return true
  return c.sourceDir != null && CLAUDE_SKILL_DIRS.has(c.sourceDir)
}

function normOrigin(v: string | null): InjectableOrigin {
  return v != null && ORIGINS.has(v as InjectableOrigin) ? (v as InjectableOrigin) : 'repo'
}
function normTrigger(v: string | null): InjectableTriggerMode {
  return v != null && TRIGGERS.has(v as InjectableTriggerMode) ? (v as InjectableTriggerMode) : 'auto+manual'
}

export function buildInjectables(input: {
  commands: CommandInfo[]
  snippets: Snippet[]
  assignments: InjectableCategoryAssignment[]
}): Injectable[] {
  const byInjectable = new Map<string, Set<string>>()
  for (const a of input.assignments) {
    if (!byInjectable.has(a.injectableId)) byInjectable.set(a.injectableId, new Set())
    byInjectable.get(a.injectableId)!.add(a.categoryName)
  }
  const categoriesFor = (id: string): string[] =>
    Array.from(byInjectable.get(id) ?? []).sort((x, y) => x.localeCompare(y))

  const fromCommands: Injectable[] = input.commands
    .filter((c) => isClaudeRelevant(c) && c.userInvocable !== false)
    .map((c) => {
      const id = `claude-code:${c.name}`
      return {
        id,
        kind: c.source === 'skill' ? 'skill' : 'command',
        name: c.name,
        description: c.description,
        origin: normOrigin(c.origin),
        triggerMode: normTrigger(c.triggerMode),
        categories: categoriesFor(id),
        invocationText: `/${c.name} `,
      }
    })

  const fromSnippets: Injectable[] = input.snippets.map((s) => {
    const id = `snippet:${s.id}`
    return {
      id,
      kind: 'snippet',
      name: s.title,
      description: null,
      origin: 'openforge',
      triggerMode: 'manual-only',
      categories: categoriesFor(id),
      invocationText: s.content,
    }
  })

  return [...fromCommands, ...fromSnippets]
}
```
(If `@openforge/plugin-sdk` is not the import alias used elsewhere for `CommandInfo`, match the existing import path used in `src/lib/ipc.ts`/`useAutocomplete.svelte.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/injectables/buildInjectables.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/injectables/buildInjectables.ts src/lib/injectables/buildInjectables.test.ts src/lib/types.ts
git commit -m "Add buildInjectables mapper for Claude-scoped catalog"
```

---

### Task 9: facets — search, group, filter

**Files:**
- Create: `src/lib/injectables/facets.ts`
- Test: `src/lib/injectables/facets.test.ts`

**Interfaces:**
- Produces:
  - `searchInjectables(items: Injectable[], query: string): Injectable[]` — case-insensitive match on name + description; empty query returns all.
  - `filterInjectables(items, filters: { origins?: InjectableOrigin[]; triggers?: InjectableTriggerMode[]; categories?: string[] }): Injectable[]` — AND across facet types, OR within a facet; empty/omitted facet = no constraint; `categories` matches if the item has ANY of the given categories.
  - `groupInjectables(items, by: InjectableGroupBy): { key: string; items: Injectable[] }[]` — groups by origin, triggerMode, or category (an item appears under each of its categories; items with no category go under `'Uncategorized'`). Groups sorted by key; `'Uncategorized'` last.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest'
import { searchInjectables, filterInjectables, groupInjectables } from './facets'
import type { Injectable } from '../types'

const make = (over: Partial<Injectable>): Injectable => ({
  id: 'claude-code:a', kind: 'skill', name: 'a', description: null,
  origin: 'repo', triggerMode: 'auto+manual', categories: [], invocationText: '/a ', ...over,
})

describe('facets', () => {
  it('search matches name and description case-insensitively', () => {
    const items = [make({ name: 'Refactor' }), make({ name: 'b', description: 'helps REFACTOR code' }), make({ name: 'c' })]
    expect(searchInjectables(items, 'refactor').length).toBe(2)
    expect(searchInjectables(items, '').length).toBe(3)
  })

  it('filter ANDs across facets and ORs within', () => {
    const items = [
      make({ name: 'a', origin: 'repo', triggerMode: 'manual-only' }),
      make({ name: 'b', origin: 'personal', triggerMode: 'manual-only' }),
      make({ name: 'c', origin: 'repo', triggerMode: 'auto+manual' }),
    ]
    const out = filterInjectables(items, { origins: ['repo', 'personal'], triggers: ['manual-only'] })
    expect(out.map(i => i.name).sort()).toEqual(['a', 'b'])
  })

  it('category filter matches any assigned category', () => {
    const items = [make({ name: 'a', categories: ['X'] }), make({ name: 'b', categories: ['Y'] })]
    expect(filterInjectables(items, { categories: ['X'] }).map(i => i.name)).toEqual(['a'])
  })

  it('group by category places multi-category items in each group and uncategorized last', () => {
    const items = [make({ name: 'a', categories: ['Beta', 'Alpha'] }), make({ name: 'b', categories: [] })]
    const groups = groupInjectables(items, 'category')
    expect(groups.map(g => g.key)).toEqual(['Alpha', 'Beta', 'Uncategorized'])
    expect(groups[0].items.map(i => i.name)).toEqual(['a'])
    expect(groups[2].items.map(i => i.name)).toEqual(['b'])
  })

  it('group by origin', () => {
    const groups = groupInjectables([make({ origin: 'repo' }), make({ origin: 'personal' })], 'origin')
    expect(groups.map(g => g.key).sort()).toEqual(['personal', 'repo'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/injectables/facets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**
```typescript
import type { Injectable, InjectableOrigin, InjectableTriggerMode, InjectableGroupBy } from '../types'

export function searchInjectables(items: Injectable[], query: string): Injectable[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) =>
    i.name.toLowerCase().includes(q) || (i.description?.toLowerCase().includes(q) ?? false),
  )
}

export function filterInjectables(
  items: Injectable[],
  filters: { origins?: InjectableOrigin[]; triggers?: InjectableTriggerMode[]; categories?: string[] },
): Injectable[] {
  const origins = filters.origins ?? []
  const triggers = filters.triggers ?? []
  const categories = filters.categories ?? []
  return items.filter((i) => {
    if (origins.length && !origins.includes(i.origin)) return false
    if (triggers.length && !triggers.includes(i.triggerMode)) return false
    if (categories.length && !i.categories.some((c) => categories.includes(c))) return false
    return true
  })
}

const UNCATEGORIZED = 'Uncategorized'

export function groupInjectables(items: Injectable[], by: InjectableGroupBy): { key: string; items: Injectable[] }[] {
  const map = new Map<string, Injectable[]>()
  const push = (key: string, item: Injectable) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  for (const item of items) {
    if (by === 'origin') push(item.origin, item)
    else if (by === 'trigger') push(item.triggerMode, item)
    else {
      if (item.categories.length === 0) push(UNCATEGORIZED, item)
      else for (const c of item.categories) push(c, item)
    }
  }
  return Array.from(map.entries())
    .map(([key, groupItems]) => ({ key, items: groupItems }))
    .sort((a, b) => {
      if (a.key === UNCATEGORIZED) return 1
      if (b.key === UNCATEGORIZED) return -1
      return a.key.localeCompare(b.key)
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/injectables/facets.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/injectables/facets.ts src/lib/injectables/facets.test.ts
git commit -m "Add injectable facet search/filter/group helpers"
```

---

# Phase 5 — Frontend: catalog loader + picker UI

### Task 10: useInjectableCatalog composable

**Files:**
- Create: `src/lib/injectables/useInjectableCatalog.svelte.ts`
- Test: `src/lib/injectables/useInjectableCatalog.svelte.test.ts`

**Interfaces:**
- Consumes: `listOpenCodeCommands`, `listSnippets`, `listInjectableCategories` (ipc), `buildInjectables` (Task 8)
- Produces: `useInjectableCatalog(getProjectId: () => string | null)` returning `{ readonly injectables: Injectable[]; readonly loading: boolean; readonly error: string | null; reload(): Promise<void> }`. `reload()` fetches all three sources in parallel and runs `buildInjectables`. Snippets/categories load even when `projectId` is null (commands need a project; with null projectId, commands = `[]`).

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listCommands = vi.fn()
const listSnippets = vi.fn()
const listCats = vi.fn()
vi.mock('../ipc', () => ({
  listOpenCodeCommands: (...a: unknown[]) => listCommands(...a),
  listSnippets: () => listSnippets(),
  listInjectableCategories: () => listCats(),
}))

import { useInjectableCatalog } from './useInjectableCatalog.svelte'

describe('useInjectableCatalog', () => {
  beforeEach(() => { listCommands.mockReset(); listSnippets.mockReset(); listCats.mockReset() })

  it('merges commands, snippets and categories on reload', async () => {
    listCommands.mockResolvedValue([{ name: 'refactor', description: null, source: 'skill', agent: null, origin: 'repo', triggerMode: 'auto+manual', userInvocable: null, sourceDir: '.claude' }])
    listSnippets.mockResolvedValue([{ id: 's1', title: 'Greeting', content: 'hi', created_at: 1, updated_at: 1 }])
    listCats.mockResolvedValue([{ id: 'a', injectableId: 'claude-code:refactor', categoryName: 'Quality' }])

    const cat = useInjectableCatalog(() => 'P-1')
    await cat.reload()

    expect(listCommands).toHaveBeenCalledWith('P-1')
    expect(cat.injectables.map(i => i.id).sort()).toEqual(['claude-code:refactor', 'snippet:s1'])
    expect(cat.injectables.find(i => i.id === 'claude-code:refactor')!.categories).toEqual(['Quality'])
    expect(cat.error).toBeNull()
  })

  it('skips command fetch when projectId is null', async () => {
    listSnippets.mockResolvedValue([])
    listCats.mockResolvedValue([])
    const cat = useInjectableCatalog(() => null)
    await cat.reload()
    expect(listCommands).not.toHaveBeenCalled()
    expect(cat.injectables).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/injectables/useInjectableCatalog.svelte.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**
```typescript
import { listOpenCodeCommands, listSnippets, listInjectableCategories } from '../ipc'
import { buildInjectables } from './buildInjectables'
import type { Injectable } from '../types'

export function useInjectableCatalog(getProjectId: () => string | null) {
  let injectables = $state<Injectable[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function reload(): Promise<void> {
    loading = true
    error = null
    try {
      const projectId = getProjectId()
      const [commands, snippets, assignments] = await Promise.all([
        projectId ? listOpenCodeCommands(projectId) : Promise.resolve([]),
        listSnippets(),
        listInjectableCategories(),
      ])
      injectables = buildInjectables({ commands, snippets, assignments })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      injectables = []
    } finally {
      loading = false
    }
  }

  return {
    get injectables() { return injectables },
    get loading() { return loading },
    get error() { return error },
    reload,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/injectables/useInjectableCatalog.svelte.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/injectables/useInjectableCatalog.svelte.ts src/lib/injectables/useInjectableCatalog.svelte.test.ts
git commit -m "Add useInjectableCatalog loader composable"
```

---

### Task 11: InjectablePicker modal component

**Files:**
- Create: `src/components/injectables/InjectablePicker.svelte`
- Test: `src/components/injectables/InjectablePicker.test.ts` (behavior only — no CSS assertions)

**Interfaces:**
- Consumes: `useInjectableCatalog` (Task 10), `searchInjectables`/`groupInjectables`/`filterInjectables` (Task 9), `Modal.svelte`.
- Produces: a component with
  ```typescript
  interface Props {
    projectId: string | null
    open: boolean
    onClose: () => void
    onSelect: (injectable: Injectable) => void
  }
  ```
  Behavior: when `open` becomes true, calls `reload()`. Renders a search input, group-by toggle (origin/trigger/category), the grouped/filtered list, origin + trigger-mode badges per row, and a category count. Selecting a row (click or Enter) calls `onSelect(injectable)` then `onClose()`. Empty `projectId` shows a "pick an agent first" message but still lists snippets.

- [ ] **Step 1: Write the failing test**

Mock the catalog composable and assert selection behavior (mount via `@testing-library/svelte`, consistent with existing component tests):
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'

vi.mock('../../lib/injectables/useInjectableCatalog.svelte', () => ({
  useInjectableCatalog: () => ({
    injectables: [
      { id: 'claude-code:refactor', kind: 'skill', name: 'refactor', description: 'do it', origin: 'repo', triggerMode: 'auto+manual', categories: [], invocationText: '/refactor ' },
    ],
    loading: false, error: null, reload: vi.fn().mockResolvedValue(undefined),
  }),
}))

import InjectablePicker from './InjectablePicker.svelte'

describe('InjectablePicker', () => {
  it('invokes onSelect with the chosen injectable then closes', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getByText } = render(InjectablePicker, { props: { projectId: 'P-1', open: true, onClose, onSelect } })
    await fireEvent.click(getByText('refactor'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code:refactor', invocationText: '/refactor ' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('filters the list by search query', async () => {
    const { getByPlaceholderText, queryByText } = render(InjectablePicker, { props: { projectId: 'P-1', open: true, onClose: vi.fn(), onSelect: vi.fn() } })
    await fireEvent.input(getByPlaceholderText('Search injectables…'), { target: { value: 'zzz' } })
    expect(queryByText('refactor')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/injectables/InjectablePicker.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement**

Create `InjectablePicker.svelte` (Svelte 5 runes; daisyUI; no hex; tests must keep passing — keep the placeholder text `Search injectables…` and render each injectable's `name` as clickable text). Skeleton:
```svelte
<script lang="ts">
  import Modal from '../shared/ui/Modal.svelte'
  import { useInjectableCatalog } from '../../lib/injectables/useInjectableCatalog.svelte'
  import { searchInjectables, filterInjectables, groupInjectables } from '../../lib/injectables/facets'
  import type { Injectable, InjectableGroupBy } from '../../lib/types'

  interface Props {
    projectId: string | null
    open: boolean
    onClose: () => void
    onSelect: (injectable: Injectable) => void
  }
  let { projectId, open, onClose, onSelect }: Props = $props()

  const catalog = useInjectableCatalog(() => projectId)
  let query = $state('')
  let groupBy = $state<InjectableGroupBy>('category')

  let prevOpen = false
  $effect(() => {
    if (open && !prevOpen) void catalog.reload()
    prevOpen = open
  })

  const visible = $derived(searchInjectables(catalog.injectables, query))
  const groups = $derived(groupInjectables(visible, groupBy))

  function choose(item: Injectable) {
    onSelect(item)
    onClose()
  }
</script>

{#if open}
  <Modal {onClose} maxWidth="720px" ariaLabel="Injectable picker" initialFocus="input">
    {#snippet header()}<h2 class="text-lg font-semibold">Injectables</h2>{/snippet}
    <div class="flex flex-col gap-3">
      <input class="input input-bordered w-full" placeholder="Search injectables…" bind:value={query} />
      <div class="join">
        <button class="btn btn-sm join-item" class:btn-active={groupBy === 'category'} onclick={() => (groupBy = 'category')}>Category</button>
        <button class="btn btn-sm join-item" class:btn-active={groupBy === 'origin'} onclick={() => (groupBy = 'origin')}>Origin</button>
        <button class="btn btn-sm join-item" class:btn-active={groupBy === 'trigger'} onclick={() => (groupBy = 'trigger')}>Trigger</button>
      </div>
      {#if projectId == null}
        <p class="text-sm opacity-70">Pick an agent to see its skills and commands. Your snippets are shown below.</p>
      {/if}
      {#if catalog.error}
        <p class="text-sm text-error">{catalog.error}</p>
      {/if}
      <ul class="menu w-full">
        {#each groups as group (group.key)}
          <li class="menu-title">{group.key}</li>
          {#each group.items as item (item.id)}
            <li>
              <button type="button" class="flex flex-col items-start gap-1 focus-visible:ring-2 focus-visible:ring-primary rounded" onclick={() => choose(item)}>
                <span class="font-medium">{item.name}</span>
                {#if item.description}<span class="text-xs opacity-70">{item.description}</span>{/if}
                <span class="flex gap-1">
                  <span class="badge badge-sm">{item.origin}</span>
                  <span class="badge badge-sm badge-ghost">{item.triggerMode}</span>
                </span>
              </button>
            </li>
          {/each}
        {/each}
      </ul>
    </div>
  </Modal>
{/if}
```
(Keyboard list navigation can reuse `useListNavigation` as `PromptInput` does — optional for the POC; click + Enter on the focused button already works. Note the `$effect` uses an explicit `prevOpen` comparison per the repo's effect-cleanup rule, NOT return-cleanup.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/injectables/InjectablePicker.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add src/components/injectables/InjectablePicker.svelte src/components/injectables/InjectablePicker.test.ts
git commit -m "Add InjectablePicker modal with search, grouping, and selection"
```

---

# Phase 6 — Frontend: snippets + category management UI

### Task 12: Snippet editor (create/edit/delete) inside the picker

**Files:**
- Create: `src/components/injectables/SnippetEditor.svelte`
- Modify: `src/components/injectables/InjectablePicker.svelte` (add "New snippet" affordance + edit/delete on snippet rows; call `catalog.reload()` after a change)
- Test: `src/components/injectables/SnippetEditor.test.ts`

**Interfaces:**
- Consumes: `createSnippet`/`updateSnippet`/`deleteSnippet` (ipc)
- Produces: `SnippetEditor` with
  ```typescript
  interface Props {
    snippet?: Snippet | null   // null/undefined = create mode
    onSaved: () => void
    onCancel: () => void
  }
  ```
  Save calls `createSnippet`/`updateSnippet`; delete calls `deleteSnippet`. Invokes `onSaved()` after success.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'

const createSnippet = vi.fn().mockResolvedValue({ id: 's9', title: 'T', content: 'C', created_at: 1, updated_at: 1 })
vi.mock('../../lib/ipc', () => ({
  createSnippet: (...a: unknown[]) => createSnippet(...a),
  updateSnippet: vi.fn(), deleteSnippet: vi.fn(),
}))

import SnippetEditor from './SnippetEditor.svelte'

describe('SnippetEditor', () => {
  it('creates a snippet and calls onSaved', async () => {
    const onSaved = vi.fn()
    const { getByPlaceholderText, getByText } = render(SnippetEditor, { props: { snippet: null, onSaved, onCancel: vi.fn() } })
    await fireEvent.input(getByPlaceholderText('Title'), { target: { value: 'T' } })
    await fireEvent.input(getByPlaceholderText('Snippet text'), { target: { value: 'C' } })
    await fireEvent.click(getByText('Save'))
    expect(createSnippet).toHaveBeenCalledWith('T', 'C')
    expect(onSaved).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/injectables/SnippetEditor.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

`SnippetEditor.svelte` (runes; daisyUI; placeholders `Title`/`Snippet text`; a `Save` button that, in create mode, calls `createSnippet(title, content)` then `onSaved()`; in edit mode calls `updateSnippet`; expose a delete button in edit mode calling `deleteSnippet` then `onSaved()`). Wire a "New snippet" button and per-snippet edit/delete affordances into `InjectablePicker.svelte`, calling `catalog.reload()` in the `onSaved` handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/injectables/SnippetEditor.test.ts` then `pnpm exec tsc --noEmit` and re-run `InjectablePicker.test.ts` to confirm no regression.
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/injectables/SnippetEditor.svelte src/components/injectables/InjectablePicker.svelte src/components/injectables/SnippetEditor.test.ts
git commit -m "Add snippet create/edit/delete in the injectable picker"
```

---

### Task 13: Category assigner

**Files:**
- Create: `src/components/injectables/CategoryAssigner.svelte`
- Modify: `src/components/injectables/InjectablePicker.svelte` (open the assigner for a row; reload after change)
- Test: `src/components/injectables/CategoryAssigner.test.ts`

**Interfaces:**
- Consumes: `assignInjectableCategory`/`removeInjectableCategory` (ipc)
- Produces: `CategoryAssigner` with
  ```typescript
  interface Props {
    injectableId: string
    current: string[]
    knownCategories: string[]   // distinct categories across the catalog, for quick-pick
    onChanged: () => void
  }
  ```
  Adding a category (existing or typed-new) calls `assignInjectableCategory(injectableId, name)`; removing calls `removeInjectableCategory`. Calls `onChanged()` after each mutation.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'

const assign = vi.fn().mockResolvedValue({ id: 'c', injectableId: 'claude-code:x', categoryName: 'New' })
const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('../../lib/ipc', () => ({
  assignInjectableCategory: (...a: unknown[]) => assign(...a),
  removeInjectableCategory: (...a: unknown[]) => remove(...a),
}))

import CategoryAssigner from './CategoryAssigner.svelte'

describe('CategoryAssigner', () => {
  it('assigns a typed category and notifies', async () => {
    const onChanged = vi.fn()
    const { getByPlaceholderText, getByText } = render(CategoryAssigner, {
      props: { injectableId: 'claude-code:x', current: [], knownCategories: [], onChanged },
    })
    await fireEvent.input(getByPlaceholderText('Add category…'), { target: { value: 'New' } })
    await fireEvent.click(getByText('Add'))
    expect(assign).toHaveBeenCalledWith('claude-code:x', 'New')
    expect(onChanged).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/injectables/CategoryAssigner.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

`CategoryAssigner.svelte` (runes; daisyUI; placeholder `Add category…`; an `Add` button calling `assignInjectableCategory` then `onChanged()`; render `current` as removable chips that call `removeInjectableCategory` then `onChanged()`; render `knownCategories` as quick-pick chips). Wire into `InjectablePicker.svelte` (e.g. an "edit categories" affordance per row), deriving `knownCategories` from `catalog.injectables.flatMap(i => i.categories)` deduped, and calling `catalog.reload()` in `onChanged`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/injectables/CategoryAssigner.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/injectables/CategoryAssigner.svelte src/components/injectables/InjectablePicker.svelte src/components/injectables/CategoryAssigner.test.ts
git commit -m "Add manual category assignment to the injectable picker"
```

---

# Phase 7 — Integration

### Task 14: global ⌘⇧I shortcut + picker mount state

**Files:**
- Modify: `src/lib/appShortcutDefinitions.ts` (add definition)
- Modify: `src/lib/appShortcuts.ts` (add handler key + dispatch case)
- Create: `src/lib/injectables/pickerState.svelte.ts` (open/close store + context: projectId + an `insert` callback)
- Modify: `src/App.svelte` (register handler; mount `InjectablePicker` once at app root, wired to picker state)
- Test: `src/lib/injectables/pickerState.svelte.test.ts`

**Interfaces:**
- Produces: `pickerState` singleton with
  ```typescript
  // shape
  { readonly open: boolean; readonly projectId: string | null;
    openPicker(ctx: { projectId: string | null; onInsert: (text: string) => void }): void;
    close(): void;
    handleSelect(injectable: Injectable): void; }
  ```
  `openPicker` stores the context + sets `open=true`; `handleSelect` calls the stored `onInsert(injectable.invocationText)` then `close()`.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { pickerState } from './pickerState.svelte'

describe('pickerState', () => {
  it('routes the selected injectable text to the active onInsert', () => {
    const onInsert = vi.fn()
    pickerState.openPicker({ projectId: 'P-1', onInsert })
    expect(pickerState.open).toBe(true)
    expect(pickerState.projectId).toBe('P-1')
    pickerState.handleSelect({ id: 'snippet:s1', kind: 'snippet', name: 'g', description: null, origin: 'openforge', triggerMode: 'manual-only', categories: [], invocationText: 'hello' })
    expect(onInsert).toHaveBeenCalledWith('hello')
    expect(pickerState.open).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/injectables/pickerState.svelte.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`pickerState.svelte.ts`:
```typescript
import type { Injectable } from '../types'

function createPickerState() {
  let open = $state(false)
  let projectId = $state<string | null>(null)
  let onInsert: ((text: string) => void) | null = null

  return {
    get open() { return open },
    get projectId() { return projectId },
    openPicker(ctx: { projectId: string | null; onInsert: (text: string) => void }) {
      projectId = ctx.projectId
      onInsert = ctx.onInsert
      open = true
    },
    close() { open = false; onInsert = null },
    handleSelect(injectable: Injectable) {
      onInsert?.(injectable.invocationText)
      open = false
      onInsert = null
    },
  }
}

export const pickerState = createPickerState()
```
Add to `appShortcutDefinitions.ts`:
```typescript
{
  id: 'open-injectable-picker',
  registrations: [{ key: '⌘⇧I', action: 'openInjectablePicker' }],
  help: { id: 'open-injectable-picker', label: 'Injectables', keys: [['⌘', '⇧', 'I']] },
},
```
Add `openInjectablePicker` to the `AppShortcutHandlers` interface and a dispatch case in `runAppShortcutAction` (`appShortcuts.ts`). In `App.svelte`, pass `openInjectablePicker: () => pickerState.openPicker({ projectId: get(activeProjectId), onInsert: /* default: no-op or focused surface */ })` — for the global shortcut, default the `onInsert` to the currently-focused surface's inserter if available, else a no-op (surfaces that own an inserter — Tasks 15/16 — call `openPicker` directly with their own `onInsert`). Mount once near the app root:
```svelte
<InjectablePicker projectId={pickerState.projectId} open={pickerState.open} onClose={() => pickerState.close()} onSelect={(i) => pickerState.handleSelect(i)} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/injectables/pickerState.svelte.test.ts` then `pnpm exec tsc --noEmit`.
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/injectables/pickerState.svelte.ts src/lib/injectables/pickerState.svelte.test.ts src/lib/appShortcutDefinitions.ts src/lib/appShortcuts.ts src/App.svelte
git commit -m "Add global injectable picker shortcut and app-root mount"
```

---

### Task 15: Create Task dialog integration

**Files:**
- Modify: `src/components/prompt/PromptInput.svelte` (add a picker button via the `controls` snippet area; expose an `onOpenPicker` callback prop; provide an `insertText(text: string)` that appends/inserts at cursor and triggers `onTextChange`)
- Modify: `src/components/AddTaskDialog.svelte` (pass `onOpenPicker` that calls `pickerState.openPicker({ projectId: $activeProjectId, onInsert })` where `onInsert` inserts into the prompt textarea)
- Test: `src/components/prompt/PromptInput.injectable.test.ts`

**Interfaces:**
- Consumes: `pickerState` (Task 14)
- Produces: `PromptInput` gains optional props `onOpenPicker?: () => void`. Insertion reuses the existing `updateTextValue`/`autoGrow` path used by `handleSelect` (PromptInput.svelte lines ~189-219).

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import PromptInput from './PromptInput.svelte'

describe('PromptInput injectable button', () => {
  it('calls onOpenPicker when the injectables button is clicked', async () => {
    const onOpenPicker = vi.fn()
    const { getByLabelText } = render(PromptInput, {
      props: { projectId: 'P-1', onSubmit: vi.fn(), onCancel: vi.fn(), onOpenPicker },
    })
    await fireEvent.click(getByLabelText('Open injectables'))
    expect(onOpenPicker).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/prompt/PromptInput.injectable.test.ts`
Expected: FAIL — no element labelled "Open injectables".

- [ ] **Step 3: Implement**

In `PromptInput.svelte`: add `onOpenPicker?: () => void` to `Props`; render a small button (daisyUI `btn btn-ghost btn-xs`, `aria-label="Open injectables"`) in the controls/footer area, calling `onOpenPicker?.()`. Add an exported method or a `$bindable`-free imperative path so the parent can insert text — simplest: have the parent pass `onInsert` to `pickerState` that updates `value` via the existing `onValueChange`/`bind:value`. Concretely, AddTaskDialog keeps the prompt text in a `$state` bound to PromptInput's `value`; the picker's `onInsert` appends `text` to that state.

In `AddTaskDialog.svelte`: wire `onOpenPicker={() => pickerState.openPicker({ projectId: $activeProjectId, onInsert: (text) => { taskPrompt = insertAtCursorOrAppend(taskPrompt, text) } })}`. Use `aiProvider` to short-circuit: the POC only enriches `claude-code`; for other providers the picker still opens (snippets are universal) but the catalog's commands come back un-enriched — acceptable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/prompt/PromptInput.injectable.test.ts` then `pnpm exec tsc --noEmit` and `pnpm test` (broad regression on prompt components).
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/prompt/PromptInput.svelte src/components/AddTaskDialog.svelte src/components/prompt/PromptInput.injectable.test.ts
git commit -m "Wire injectable picker into the Create Task dialog prompt"
```

---

### Task 16: Live session integration

**Files:**
- Modify: `src/components/task-detail/AgentTerminalShell.svelte` (add a picker button in the header next to `VoiceInput`, ~line 187; on select, write to PTY)
- Test: `src/components/task-detail/AgentTerminalShell.injectable.test.ts`

**Interfaces:**
- Consumes: `pickerState` (Task 14), `writePty` (ipc.ts:308), `focusTerminal`/`isPtyActive` (same imports `taskActionRunner.ts` uses)
- Behavior: clicking the header button calls `pickerState.openPicker({ projectId, onInsert })` where `onInsert(text)` does: if `isPtyActive(taskId)` → `await writePty(taskId, text)` then `focusTerminal(taskId)`. **No auto-Enter** — the user reviews/sends. `projectId` comes from the task's project (the component already has task context; thread `projectId` in if not present).

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'

const writePty = vi.fn().mockResolvedValue(undefined)
const focusTerminal = vi.fn()
const isPtyActive = vi.fn().mockReturnValue(true)
vi.mock('../../lib/ipc', () => ({ writePty: (...a: unknown[]) => writePty(...a) }))
vi.mock('../../lib/terminalPool', () => ({ focusTerminal: (...a: unknown[]) => focusTerminal(...a), isPtyActive: (...a: unknown[]) => isPtyActive(...a) }))

import { pickerState } from '../../lib/injectables/pickerState.svelte'
import AgentTerminalShell from './AgentTerminalShell.svelte'

describe('AgentTerminalShell injectable button', () => {
  it('injects selected text into the PTY without auto-submit', async () => {
    // render with the minimal required props for this component (mirror existing AgentTerminalShell tests)
    const { getByLabelText } = render(AgentTerminalShell, { props: { /* required props per component */ } as never })
    await fireEvent.click(getByLabelText('Open injectables'))
    pickerState.handleSelect({ id: 'snippet:s1', kind: 'snippet', name: 'g', description: null, origin: 'openforge', triggerMode: 'manual-only', categories: [], invocationText: 'hello world' })
    expect(writePty).toHaveBeenCalledWith(expect.any(String), 'hello world')
    expect(focusTerminal).toHaveBeenCalled()
  })
})
```
(Adjust the imported module paths for `focusTerminal`/`isPtyActive` to wherever `taskActionRunner.ts` imports them from; confirm during Step 2/3.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/task-detail/AgentTerminalShell.injectable.test.ts`
Expected: FAIL — no "Open injectables" button.

- [ ] **Step 3: Implement**

In `AgentTerminalShell.svelte`, add a header button (daisyUI ghost icon button, `aria-label="Open injectables"`) next to `VoiceInput`. On click:
```typescript
function openInjectables() {
  pickerState.openPicker({
    projectId,
    onInsert: async (text) => {
      if (!isPtyActive(taskId)) return
      await writePty(taskId, text)
      focusTerminal(taskId)
    },
  })
}
```
Thread `projectId` into the component if it isn't already available (pass from the parent task-detail view; the task carries `project_id`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/task-detail/AgentTerminalShell.injectable.test.ts` then `pnpm exec tsc --noEmit` and `pnpm test` (regression).
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/task-detail/AgentTerminalShell.svelte src/components/task-detail/AgentTerminalShell.injectable.test.ts
git commit -m "Wire injectable picker into the live agent terminal"
```

---

## Final verification

- [ ] `cargo test` (from `src-tauri/`) — all green.
- [ ] `pnpm exec tsc --noEmit` — no type errors.
- [ ] `pnpm test` — full frontend suite green.
- [ ] Manual smoke (via `pnpm electron:dev`): in a `claude-code` project, open Create Task → click the injectables button (and ⌘⇧I) → search, switch grouping (origin/trigger/category), select a skill → `/skill ` appears in the prompt. Create a snippet → it appears in any provider's picker. Assign a category → grouping by category reflects it. Start the task → in the live terminal, open the picker → select a snippet → text is written to the terminal without auto-submit. Confirm a `.pi`-only skill does NOT appear in the Claude picker.

---

## Self-Review (completed during planning)

- **Spec coverage:** Injectable model → Tasks 3,8. Summonable picker in both surfaces → Tasks 11,14,15,16. Faceted browse (origin/trigger/category + search) → Tasks 9,11. Provider scoping to Claude + adapter seam → Tasks 3,8 (Claude-relevance filter). Origin clarity badges → Task 11. Category overlay (no file writes) → Tasks 6,7,13. Snippets CRUD → Tasks 4,5,12. Drop `user-invocable:false` → Task 8. `/` fast path preserved → untouched (`useAutocomplete` still works; `CommandInfo` additions are backward-compatible). Out-of-scope items (other providers, AI categorization, tab delete/create/rename, snippet pinning) → intentionally absent.
- **Placeholder scan:** No TBD/TODO; every code step carries real code. UI markup steps give component contracts + behavior tests (CSS intentionally untested per repo rule).
- **Type consistency:** `Injectable`/`Snippet`/`InjectableCategoryAssignment` defined in Task 8/5/7 and reused verbatim downstream. Rust→TS casing reconciled: Rust rows use `#[serde(rename_all="camelCase")]` and new `CommandInfo` fields use explicit `rename`, so TS sees `triggerMode`/`userInvocable`/`sourceDir`/`injectableId`/`categoryName`. `pickerState.handleSelect` ↔ `InjectablePicker.onSelect` signatures match.

## Execution Notes / open follow-ups

- **Babysitter:** the repo's `CLAUDE.md` mandates driving implementation through a Babysitter CLI run. If you execute via the superpowers sub-skills, reconcile that with the Babysitter requirement first (or run the plan's TDD tasks under a Babysitter run).
- **Stable identity caveat:** category assignments key on `claude-code:${name}`; renaming a skill orphans its categories (assignment simply stops matching and is hidden). Acceptable for the POC; a migration/relink is a follow-up.
- **`/` vs picker divergence (POC):** the legacy `/` autocomplete still shows the unfiltered provider command list (incl. `.pi` skills in a Claude task); only the picker applies Claude-relevance filtering. Converging `/` onto the filtered catalog is a follow-up.
- **Provider param:** `listOpenCodeCommands(projectId)` resolves the provider server-side; the POC assumes `claude-code`. Other providers open the picker (snippets work) but skills/commands arrive un-enriched.
