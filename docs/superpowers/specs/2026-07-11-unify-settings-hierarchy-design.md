# Unify Settings Hierarchy — Design

**Date:** 2026-07-11
**Status:** Approved (design), proceeding to implementation plan
**Task:** AVIV-68
**Issue:** koenvg/openforge#1280

## Problem

OpenForge's settings are scattered across three unrelated storage mechanisms with no
consistent inheritance. A user cannot set a default once and let projects and tasks
override it. Concretely, of the settings the issue targets:

- **Cleanup** (`code_cleanup_tasks_enabled`) is **global-only** — no project or task override.
- **Task title auto-update** (`task_display_title_metadata_updates_enabled`, the issue's
  "task dashboard toggle") is **global-only**.
- **Plugin enablement** (`project_plugins`) is **project-only** — no global default.

The goal is one coherent global → project → task override hierarchy: set defaults globally,
override per project, override per task, with a consistent and visually uniform experience.

## Goals / acceptance criteria

From the issue:
- Global settings are reconciled and set as defaults.
- Project settings can override global settings.
- Task settings can override project settings (for task-applicable settings).
- The settings hierarchy is consistent throughout the app.

Additionally (confirmed with the requester during design):
- The hierarchy settings are **grouped together** on both the global and project settings
  pages and render with the **same visuals** in both places, via one shared component, so
  the inheritance model is easy to understand.

## Decisions locked (design Q&A)

1. **"Task dashboard toggle" = the existing "Task Display Title Updates" setting**
   (`task_display_title_metadata_updates_enabled`), which gates auto-generation of a task's
   display title from agent activity metadata. Label unchanged.
2. **Plugin enablement** gains a global-default layer + keeps per-project override.
   **No per-task** plugin toggling.
3. **Override UX** is plain on/off (or the setting's native control) at each level, seeded
   from the parent's effective value. **No "differs from global" badges.** A single
   **"Default to global settings"** button per project clears that project's overrides for
   the whole group. The new-task dialog shows the task-applicable settings seeded from the
   project's effective values, with no inheritance chrome.
4. **Additional settings folded into the hierarchy** (beyond the original four):
   **AI provider**, **Default to worktrees**, **Task ID prefix** (project-level only), and
   **GitHub poll interval** (project-level only).
5. **Two new KV tables** (`task_config`, `global_plugins`) rather than adding task columns or
   overloading existing tables.
6. **One spec, phased implementation.**

## Settings × levels

| # | Setting | Key | Global | Project | Task | Default |
|---|---|---|:--:|:--:|:--:|---|
| 1 | Cleanup tasks | `code_cleanup_tasks_enabled` | ✅ | ✅ | ✅ | off |
| 2 | Task title auto-update | `task_display_title_metadata_updates_enabled` | ✅ | ✅ | ✅ | off |
| 4 | AI provider | `ai_provider` | ✅ | ✅ | ✅ | `claude-code` |
| 5 | Default to worktrees | `use_worktrees` | ✅ | ✅ | ✅ | on |
| 6 | Plugin enablement | (per plugin) | ✅ | ✅ | ➖ | builtins on |
| 7 | Task ID prefix | `task_id_prefix` | ✅ | ✅ | ➖ | `''` |
| 8 | GitHub poll interval | `github_poll_interval` | ✅ | ✅ | ➖ | 60s |

`➖` = intentionally not overridable at that level.

## Resolution model

`effective = task ?? project ?? global ?? hardcoded default`. `null`/absent means "inherit
from the parent level."

- **Global** = base defaults, in the existing `config` KV table. Keys 1, 2, 7, 8 already
  exist there; key 4 (`ai_provider`) already resolves globally via `resolve_ai_provider`.
- **Project** = overrides in the existing `project_config` KV table (key present = explicit
  override, absent = inherit global). Plugin overrides stay in `project_plugins`.
- **Task** = resolved-and-snapshotted **at creation time**: the new-task dialog seeds each
  task-applicable control from the project's effective value; the chosen value is persisted
  and `worktree_source` already behave, and is the correct semantics because all task-level
  settings only affect how that task runs.

### Why snapshot-at-creation for tasks
task creation. Keeping the new task-level settings on the same model preserves consistency
and keeps runtime consume-sites as simple reads. A task's behavior is fixed by what it was
created with; later project changes do not retroactively alter existing tasks.

## Storage design

| Level | Substrate | Change |
|---|---|---|
| Global (plugins) | **`global_plugins(plugin_id TEXT PK, enabled INTEGER)`** — NEW | Global plugin-default layer. |
| Project (plugins) | `project_plugins` | Unchanged. |
| Task | **`task_config(task_id TEXT, key TEXT, value TEXT, UNIQUE(task_id,key), FK→tasks ON DELETE CASCADE)`** — NEW | Snapshots for task-level cleanup, title-update, ai_provider. Mirrors `project_config`. |

Two new KV tables are added rather than three new `tasks` columns: adding a task column
touches a wide cascade (`TaskRow`, `CompactTaskRow`, `TASK_ROW_COLUMNS`, every task SELECT/
INSERT, `domain.ts`, contract + snapshot tests). A `task_config` table isolates the churn to
one migration + one resolver and is extensible for future task-level settings.

### Plugin enablement resolution
`get_enabled_plugins` / `is_plugin_enabled` change from
`project_plugins ?? is_builtin` to `project_plugins ?? global_plugins ?? is_builtin`.

### AI provider resolution
Add a task-aware resolver `resolve_ai_provider_for_task(task_id)`:
`task_config['ai_provider'] ?? project_config['ai_provider'] ?? config['ai_provider'] ??
'claude-code'`. Task-start paths use it; the existing project-level `resolve_ai_provider`
stays for callers without a task.

## Settings registry (single source of truth)

Introduce one registry describing each hierarchy setting: `key`, `label`, `description`,
`type` (`toggle` | `select` | `text` | `number` | `plugins`), which `levels` it applies to,
default value, and (for `select`) its options. Both the shared UI component and the
load/save/resolve helpers derive from this registry so the three levels never drift.

## Shared UI component (the "same visuals" requirement)

A single presentational component — `HierarchicalSettingsCard.svelte` (working name) —
renders the grouped hierarchy settings and is used **identically** on the global and project
settings pages. It renders one row per registry entry with the control appropriate to the
setting's `type` (toggles for 1/2/3/5, a select for 4, text for 7, number for 8), plus a
plugin-enablement subsection (a list of per-plugin toggles) for entry 6.

- **Global page:** the card renders the defaults. No reset button.
- **Project page:** the same card, same layout/styling, rendering effective values; it adds a
  **"Default to global settings"** button that clears this project's overrides for the group
  (deletes the group's `project_config` keys and this project's `project_plugins` rows so
  they fall back to global). No per-setting "overridden" indicators.
- **New-task dialog:** reuses the same row components for the task-applicable settings
  (1/2/3/4/5), seeded from the project's effective values, styled to fit the dialog. No
  inheritance chrome.

The card replaces/absorbs the toggles currently split across `SettingsExperimentalCard`
(cleanup, title-update) and the relevant rows of `SettingsGeneralCard`/`SettingsPreferencesCard`
(provider, worktrees, prefix, poll interval) so the flowing settings read as one group.
*template*, project identity, plugin *install*, developer logs) stay in their existing cards.

## Runtime consume-site changes

| Setting | Current read | New read |
|---|---|---|
| Cleanup | `lifecycle.rs` reads global `code_cleanup_tasks_enabled` | reads the task's `task_config` snapshot |
| Title-update | gate in `http_server.rs` reads global config | reads the task's `task_config` snapshot |
| AI provider | `resolve_ai_provider(project)` at task-start | `resolve_ai_provider_for_task(task_id)` |
| Worktrees | dialog seeds `worktree_source` from project `use_worktrees` | unchanged behavior; global default now feeds the project effective value |

**Legacy tasks:** tasks created before this feature have no `task_config` rows. The cleanup
and title-update consume-sites read `task_config ?? project ?? global`, so an absent snapshot
falls back to the resolved effective value (preserving today's behavior). `resolve_ai_provider_for_task`
has the same fallback chain, so pre-existing tasks keep resolving their provider from the
project/global level exactly as they do today.

## Load / save / reset flow (frontend)

- **Global:** extend `loadGlobalSettings`/`saveGlobalSettings` (`settingsConfig.ts`/
  defaults load/save. Provider, prefix, poll-interval already flow globally or are added.
- **Project effective:** a helper resolves each hierarchy setting as
  `project_config ?? global`. The project page and the new-task dialog both use it.
- **Reset:** `resetProjectToGlobalDefaults(projectId)` deletes the group's `project_config`
  keys and the project's `project_plugins` rows.
- **Task snapshot at create:** the dialog passes the chosen task-level values into
  worktree). All IPC payloads use camelCase matching the generated API shape.

## Non-goals / scope boundaries (YAGNI)

- No per-task plugin, prefix, or poll-interval overrides.
- The "Default to global settings" reset covers only the unified hierarchy settings, not
  unrelated project config (name, path, color, labels, actions, focus filters, instructions/
  **enablement** flag joins the hierarchy.
- Credentials (GitHub token, secret), theme/dark mode, Whisper model management, plugin
  *install* (app-wide by nature), and developer logs are excluded — not meaningful to cascade.
- Task ID prefix becoming per-project changes task-ID numbering to per-project counters; this
  is in scope for the project override but has no task level.

## Test surface

- **Rust:** `task_config` + `global_plugins` DB CRUD; plugin resolution with the new global
  layer; `resolve_ai_provider_for_task` precedence; cleanup/title-update consume-sites reading
  task snapshots; task-creation writing task_config; migration applies cleanly. Contract/
  snapshot tests for the create-task payload (new task-level fields).
- **Frontend (vitest):** registry-driven effective-value resolution (`task ?? project ??
  global ?? default`) per setting; reset clears overrides; global/project load+save round-trip;
  new-task dialog seeds from project-effective and persists overrides. Business logic only —
  no assertions on CSS/Tailwind/visual styling.

## Phasing (for the implementation plan)

1. **Storage + resolver core** — `task_config` + `global_plugins` tables/migrations, DB
   methods, plugin + provider resolvers, settings registry, effective-value helpers. (TDD)
2. **Global settings UI** — shared `HierarchicalSettingsCard` in global mode; global defaults
   for the new keys + plugin defaults.
3. **Project settings UI** — same card in project mode + "Default to global settings" reset.
4. **New-task dialog + runtime consume-sites** — task-level toggles seeded from project
   effective; snapshot on create; switch cleanup/title-update/provider reads to the task
   snapshot.

Each phase is independently testable. A post-implementation review effect runs after
