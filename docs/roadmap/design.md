# Roadmap Board — Design

- **Date:** 2026-06-22
- **Task:** AVIV-7
- **Status:** Approved design, ready for implementation planning
- **Deferred items:** see [`docs/roadmap/DEFERRED.md`](./DEFERRED.md)

## Goal

Port the standalone `github-roadmap` app (a per-repo Kanban board over GitHub Issues,
https://github.com/Avivhdr/github-roadmap) into OpenForge as a new **left-rail view**,
alongside Board, PR Review, Skills, Settings, etc.

Two hard changes from the original:

1. **No authentication.** The original signs in with GitHub via Supabase Auth. OpenForge
   has no per-user auth; it reuses its existing global GitHub token.
2. **No external database.** The original keeps app-state in Supabase (Postgres + RLS).
   Here, all app-state is persisted **locally in OpenForge's SQLite database**.

GitHub remains the source of truth for issues, labels, and PRs. Only app-layer state
(per-issue value, curated columns) is stored locally.

## Non-goals (v1)

Deferred to a later phase and tracked in `docs/roadmap/DEFERRED.md`:

- Drag-and-drop (manual card reordering within a column, and drag-to-relabel across columns)
- The orphan "PRs · no issue" column and PR-closes-issue badges on cards
- Label **color** editing / color picker / creating brand-new labels
- Card-drawer **comments** display
- AI "Refine" ticket drafting
- Free repo picker / last-opened-repo persistence

## Architecture

Modeled on the existing **GitHub PR Review** feature (`plugins/github-sync/`): a **thin
frontend plugin** over a **core-Rust backend** with **local SQLite**. The plugin registers
the rail view and the Svelte UI; all GitHub calls and persistence live in core Rust. Data
loads **on demand** (when the view opens, plus a Refresh button) — no background poller.

```
plugins/roadmap/  (Svelte 5 view + thin backend proxy)
   │  api.backend.invoke(method, payload)
   ▼  host callback (plugin sidecar -> core)
core Rust:
   app_invoke/roadmap.rs ──► github_client (issues/labels REST) ──► GitHub
                         └──► db: roadmap_* tables (SQLite)
```

This matches how `plugins/github-sync` proxies to `app_invoke/github_review.rs`; the host
callback wiring is copied and adapted from that template.

## Repo scoping

The board follows the **active OpenForge project's GitHub repo**. Core resolves the GitHub
`owner/name` from the active project's git remote (`origin`). Switching the active project
switches the board.

**Explicitly removed from the original:** there is **no repo dropdown / picker**. The
original `github-roadmap` shows a top-left dropdown listing *all* of the user's repositories;
that control is **not** ported. The Roadmap view is bound entirely to whichever OpenForge
project is currently active — it shows that project's repo (as a non-interactive header
label, not a selector) and nothing else. Adding another OpenForge project gives that project
its own independent, repo-scoped Roadmap (its own columns/values via `project_id`-keyed
rows). A user never picks a repo inside this view.

- All app-state tables are keyed by **`project_id`** (stable, cascades with project delete),
  not by the repo string. The resolved `owner/name` is used only for live GitHub calls and
  for display.
- **Open detail:** confirm whether an existing helper already maps a project to its GitHub
  `owner/name` (the PR-review features are repo-aware). Reuse it; otherwise add a small
  `git remote get-url origin` parse in core.

## Data model (new local SQLite tables)

Mirrors the original's Supabase tables, minus `user_id`/RLS, re-keyed to `project_id`.
Added via a new migration in `src-tauri/src/db/migrations.rs` (timestamps are unix-epoch
`INTEGER`, JSON stored as `TEXT`, matching existing conventions).

```sql
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
    column_labels  TEXT NOT NULL DEFAULT '[]',  -- JSON array of label names, in display order
    last_opened_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

(The original's `item_order` table is intentionally omitted — manual ordering is deferred
with drag-and-drop. `app_state.last_repo` is omitted — the repo follows the active project.)

A domain file `src-tauri/src/db/roadmap.rs` (`impl super::Database`) provides the CRUD:
`get_roadmap_values(project_id)`, `set_roadmap_value(project_id, issue_number, value)`,
`get_roadmap_column_labels(project_id)`, `set_roadmap_column_labels(project_id, labels)`.

## GitHub client additions (core Rust)

Extend the existing `src-tauri/src/github_client/` (reusing its token, rate-limit, and
ETag handling). REST only — no GraphQL needed for the MVP:

- `list_open_issues(owner, name, token)` — open issues, excluding PRs
- `list_labels(owner, name, token)` — repo labels (name + color)
- `create_issue(owner, name, title, body, labels, token)` → created issue
- `edit_issue(owner, name, number, input, token)` — title / body / state / add+remove labels

## Core commands (`app_invoke/roadmap.rs`)

Reached from the plugin via host callback. Payloads use **camelCase** (per the IPC
convention) even though Rust params are snake_case. All return `Result<_, String>`.

| Command | Payload | Returns |
| --- | --- | --- |
| `roadmap_get_board` | `{ projectId }` | `{ repo, issues, labels, values, columnLabels }` (raw; the frontend assembles columns) |
| `roadmap_set_value` | `{ projectId, issueNumber, value: number \| null }` | `null` |
| `roadmap_get_config` | `{ projectId }` | `{ columnLabels: string[], labels: { name, color, used }[] }` |
| `roadmap_set_column_labels` | `{ projectId, labels: string[] }` | `null` |
| `roadmap_create_issue` | `{ projectId, title, body, labels: string[] }` | `{ issue }` |
| `roadmap_edit_issue` | `{ projectId, number, title?, body?, state?, addLabels?, removeLabels? }` | `null` |

Each resolves the project's `owner/name`, then combines GitHub data with local DB state.

## Frontend (`plugins/roadmap/`)

- `index.ts` — registers the rail view: a Lucide icon (one-line add to core
  `src/lib/iconRailIcons.ts`, e.g. `kanban`), a `Cmd+<free-key>` shortcut (final letter TBD
  to avoid the existing ⌘H / ⌘G / ⌘L / ⌘, bindings), and the board component.
- `backend.ts` — thin proxy: each method forwards to the matching core command via host
  callback (copied from `plugins/github-sync/src/backend.ts`).
- **Board assembly + sorting are ported from the original's pure functions**
  (`buildBoard`, `placeCards`, `sortColumnCards`) into TypeScript inside the plugin. Their
  existing unit tests are carried over. Core returns raw data; the frontend builds columns
  and persists changes via the commands above. Sorting (no manual order): value descending,
  then issue number descending.
- Components (React → Svelte 5 runes; `$state`/`$derived`/`$props`, `on`-prefixed callbacks):
  - **Board** — a header showing the active project's repo as a **read-only label (no
    dropdown/picker)**, plus Create / Refresh / Columns actions; below it, curated label
    columns (in `column_labels` order) + a "No label / Other" column. Columns fill width and
    wrap. No DnD.
  - **Card** — title (click to open drawer), value badge, open-on-GitHub / copy-link.
  - **Card drawer** — edit title & body (Markdown), set value (1–10 or clear), toggle the
    issue's **existing** labels on/off (this is how a card moves between columns), and close
    the issue. No comments (deferred), no new-label creation (deferred).
  - **Create dialog** — manual create only: title, body, pick from existing labels, Create.
    The "Refine" (AI) path is deferred; for now the dialog is effectively the original's
    "Skip AI" branch.
  - **Column settings modal** — curate which labels are columns and order them with ↑/↓
    buttons (button-based, not drag), persisted to `column_labels`.
- Styling: daisyUI v5 + Tailwind v4, no hardcoded design hex. GitHub label colors are
  *data* (applied via inline style from the API), consistent with the project's color rule.

## Data flow

1. View opens with the active project → `roadmap_get_board({ projectId })`.
   Core resolves `owner/name`, fetches open issues + labels from GitHub, reads `values` and
   `columnLabels` from SQLite, returns the raw bundle.
2. Frontend assembles columns (`buildBoard`) and renders. Refresh re-runs step 1.
3. Set a card's value → optimistic update + `roadmap_set_value`.
4. Edit title/body/labels or close from the drawer → `roadmap_edit_issue`; toggling labels
   re-places the card into the matching column on the next assembly (optimistic + refetch).
5. Create issue → `roadmap_create_issue`; the new card appears optimistically.
6. Column settings → `roadmap_get_config` / `roadmap_set_column_labels`.

## Testing strategy (TDD)

Business logic only — no assertions on CSS/Tailwind/visual styling.

- **TypeScript unit tests** for the ported pure functions (`buildBoard`, `placeCards`,
  `sortColumnCards`, and optimistic create/edit helpers) — carry over the original tests,
  adjusted for the no-order sort.
- **Rust tests** (`cargo test`) for the `roadmap.rs` DB CRUD and the command handlers
  (value set/get round-trip, column-label persistence, board assembly inputs).
- **Cypress component tests** for board interactions (open drawer, set value, toggle label
  moves card to the right column, create issue) per the `cypress-accessible-tests` skill.

## File-level change list

**Core Rust**
- `src-tauri/src/db/migrations.rs` — new migration: the two `roadmap_*` tables.
- `src-tauri/src/db/roadmap.rs` *(new)* — `impl super::Database` CRUD; register in `db/mod.rs`.
- `src-tauri/src/github_client/issues.rs` *(new)* — issue list/create/edit.
- `src-tauri/src/github_client/labels.rs` *(new)* — label list. (Register in `github_client/mod.rs`.)
- `src-tauri/src/app_invoke/roadmap.rs` *(new)* — command handlers; add to the dispatcher
  in `app_invoke/mod.rs`.
- `src-tauri/src/plugin_host/callbacks.rs` — map the `roadmap_*` host commands to the
  handlers (mirroring the github-sync mapping).

**Frontend / plugin**
- `plugins/roadmap/` *(new package)* — `package.json` manifest, `src/index.ts`,
  `src/backend.ts`, Svelte components, ported pure-logic + tests.
- `src/lib/iconRailIcons.ts` — register the new Lucide icon.

## Risks & open questions

- **Project → repo resolution.** Confirm an existing project→`owner/name` helper to reuse;
  otherwise add a git-remote parse. Behavior when the active project has no GitHub remote:
  show an empty/"no GitHub repo for this project" state.
- **Shortcut letter** must avoid ⌘H/⌘G/⌘L/⌘, — pick a free one during implementation.
- **Plugin icon registry** lives in core (`iconRailIcons.ts`), so the new icon is a small
  core edit even though the view is a plugin.
- **Markdown rendering** in the drawer/body preview — pick a Svelte-friendly renderer
  (the original used `react-markdown` + `remark-gfm`); choose during implementation, keeping
  to the project's `:global()` rule for rendered HTML.
