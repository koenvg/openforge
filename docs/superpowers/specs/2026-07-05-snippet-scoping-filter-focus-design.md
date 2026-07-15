# Snippet project-scoping · filter cycling · list focus

> Extends the iteration-2 snippets feature (`2026-07-03-injectable-snippets-design.md`).
> Three independent pieces: **B** (filter) and **C** (focus) are frontend-only; **A** is full-stack.

## A. Per-snippet project availability (full-stack)

Each snippet declares which projects it appears in: **All projects** (future-proof flag) or an
explicit subset.

### Data model (new migration, appended last)
- `snippets.all_projects INTEGER NOT NULL DEFAULT 1` — existing snippets stay visible everywhere.
- `snippet_projects(snippet_id TEXT, project_id TEXT, PRIMARY KEY(snippet_id, project_id),
  FOREIGN KEY(snippet_id) REFERENCES snippets(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`.
- **Visible in project P** ⟺ `all_projects = 1` OR a `(snippet_id, P)` row exists. `all_projects`
  is a true flag: a snippet left on "All" shows in projects created later, too.

### Rust (`db/snippets.rs`)
- `SnippetRow` gains `all_projects: bool`, `project_ids: Vec<String>`.
- `create_snippet(name, body, all_projects, project_ids)` / `update_snippet(id, …)` — write the flag
  and replace join rows in one transaction. `delete_snippet` cascades. `list_snippets()` returns each
  snippet with its scope.
- Validation (extends `validate_snippet`): reject `!all_projects && project_ids.is_empty()`.
- Tests: scope round-trip, `all_projects` default, join-replace on update, cascade on delete, empty-scope rejection.

### IPC / types
- `create_snippet` / `update_snippet` payloads gain `allProjects: boolean`, `projectIds: string[]`;
  `Snippet` type and `list_snippets` return gain them. Update `ipcCommandContracts` payloadKeys
  (the lock test enforces it). Bridge already lists the commands.

### Frontend
- `buildInjectables({ commands, snippets, projectId })` includes a snippet iff
  `allProjects || projectIds.includes(projectId)` (projectId null → only `allProjects`). Pure + tested.
- Editor gains an **"Available in" checklist**: `☑ All projects` + one row per project (from
  `getProjects()`). Pure state helper (tested):
  - check **All** → flag on;
  - uncheck any one → flag off + explicit list of the rest;
  - check every project individually → **All** auto-ticks;
  - saving requires ≥1 selection (All counts).

## B. Filter row: "All" chip + ⌘1/⌘2 cycle (frontend)

- Prepend an **"All"** chip; active when the section set is empty; clicking it clears the set.
- Other chips remain **multi-toggle** (mouse) — unchanged from today.
- **⌘1 / ⌘2** cycle a **single-select cursor** over `[All, Snippets, Personal, Project, Plugin,
  Claude Code]` circularly (⌘2 = right, ⌘1 = left), **overwriting** the selection to that one chip
  (or empty for All). Handled in the modal's keydown (`preventDefault`; does not move focus).
  ⌘1/⌘2 are free globally (only bare `1`/`2` cycle projects).
- Pure `cycleFilter(cursorIndex, dir, order)` helper → next cursor + resulting section set. Tested.

## C. Tab-into-list focus (frontend)

- Filter chips, group-by toggle, and group headers → `tabindex=-1` (mouse + ⌘1/⌘2 only), so **Tab
  from the search input lands on the first list row**.
- List rows use **roving tabindex**: the active/selected row is `tabindex=0` and holds DOM focus,
  others `-1`. Tab enters the list as a single stop; ↑/↓ move the active row and its focus; Tab /
  Shift+Tab exit the list. Integrates with the existing `selectedId`.
- ⌘1/⌘2 change the filter **without** moving focus; if the active row is filtered out, focus falls to
  the first still-visible row (stays in the list).

## Verification
- Rust: `cargo test snippet` + `cargo test migrations::`, then full.
- Frontend: `vitest` on `buildInjectables` / `facets` / `pickerLogic` / `InjectablePicker` + the
  contract-lock test; `tsc --noEmit`.
- Focus/keyboard assertions are behavior (allowed); no CSS/visual assertions.
- Review pass over the diff before handoff.
