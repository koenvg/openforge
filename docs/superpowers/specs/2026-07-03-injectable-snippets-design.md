# Injectable Snippets — Iteration 2 (Personal, DB-stored)

> Builds on `docs/superpowers/plans/2026-07-02-injectable-picker-iteration1.md` (the picker
> that browses/reads/inserts skills + commands). Adds **snippets**: personal reusable text
> blocks stored in the OpenForge SQLite DB. Category overlay remains deferred.

## Scope

**In:** Personal, machine-global **snippets** (name + body) stored in SQLite, with inline
create/edit/delete in the Injectable Picker, rendered as their own top-level "Snippets" group,
inserted as literal body text.

**Out (deferred):** category overlay, tags, project-scoped snippets, placeholders/variables,
a dedicated management surface outside the picker.

## What a snippet is

A snippet is **personal, machine-global reusable text** stored in the OpenForge SQLite DB — not
per-project, not on the filesystem (unlike skills/commands, which are file-scanned). It has a
**name** (title) and a **body** (the text). Picking it inserts the **literal body verbatim** into
the prompt or live PTY — no slash reference, no auto-Enter, no placeholders.

This makes snippets structurally different from skills/commands: they have no slash identity and
no trigger mode. The design slots them in as their own section rather than forcing a fake
origin/trigger.

## Data model & storage

### Migration #32 — `snippets` table
```sql
CREATE TABLE snippets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```
Backend generates `id` (uuid) + timestamps, following the `create_project` convention.

> ⚠️ Appending migration #32 shifts any migration test using `LATEST_USER_VERSION - N`; bump
> those offsets by 1 (known gotcha).

### `src-tauri/src/db/snippets.rs`
`SnippetRow { id, name, body, created_at, updated_at }` (serde camelCase) + `impl super::Database`:
- `list_snippets() -> Result<Vec<SnippetRow>>` (ordered by `updated_at` desc, or `name`)
- `create_snippet(name, body) -> Result<SnippetRow>`
- `update_snippet(id, name, body) -> Result<SnippetRow>` (bumps `updated_at`)
- `delete_snippet(id) -> Result<()>`

Validation: reject empty/whitespace-only **name** and **body** (`Result<_, String>`). Store the
body **raw** (preserve leading/trailing whitespace + newlines); trim only for the emptiness check.

## IPC

New `app_invoke` command cases (camelCase payloads), errors mapped: validation → `BAD_REQUEST`,
DB failure → `INTERNAL_SERVER_ERROR`.

| command | payload | returns |
|---|---|---|
| `list_snippets` | — | `SnippetRow[]` |
| `create_snippet` | `{ name, body }` | `SnippetRow` |
| `update_snippet` | `{ id, name, body }` | `SnippetRow` |
| `delete_snippet` | `{ id }` | `null` |

- `src/lib/ipc.ts` wrappers: `listSnippets()`, `createSnippet(name, body)`, `updateSnippet(id, name, body)`, `deleteSnippet(id)`.
- **4 new entries in `src/lib/electronMigrationContracts.ts`** (the locked IPC inventory — the contract test enforces this).

## Frontend model & picker integration

- `src/lib/types.ts`: add `'snippet'` to `InjectableKind`; add `Snippet { id, name, body, createdAt, updatedAt }`.
- A snippet maps to an `Injectable`:
  - `kind: 'snippet'`
  - `id: 'snippet:' + dbId` — stable across a rename, so the selection stays put after an edit.
  - `content: body` — drives the char count + preview pane.
  - `invocationText: body` — the **existing** insert path inserts the literal body with zero changes.
  - `origin: 'personal'`, `triggerMode: 'manual-only'` — unused sentinels; snippet rows render **neither** badge.
- **Section-aware grouping/filtering** (localized to `src/lib/injectables/facets.ts`): a
  `sectionOf(item)` helper returns `'snippet'` for snippets, else `item.origin`. Snippets always
  form a **first-position "Snippets" group in both group-by modes**, and a **"Snippets" filter
  chip** toggles them alongside the origin chips.
- `buildInjectables({ commands, snippets })` maps snippets too.
- `useInjectableCatalog.reload()` fetches `listSnippets()` in parallel with `listOpenCodeCommands()`.
  **Snippets load even when `projectId` is null** (they're personal) — the picker is no longer empty
  without an active project.

## Inline authoring (reuses iteration-1 edit UI)

- The Snippets group renders **even when empty**, with a **"+ New snippet"** affordance.
- New/Edit open the inline editor, extended to **name input + body textarea** (iteration-1's editor
  was body-only for skills). Save → `create/updateSnippet` → reload → keep/select the snippet.
- Delete → the existing confirm-delete `Modal` → `deleteSnippet` → reload.
- Reuses the iteration-1 `busy` / `actionError` state pattern.

## Testing (TDD, business-logic only — no CSS/visual assertions)

- **Rust** (`snippets.rs`): CRUD round-trips; empty-name/body rejection; `updated_at` bump on update;
  migration `LATEST_USER_VERSION` bump.
- **Pure TS**: `buildInjectables` snippet mapping (id / content / invocationText); `facets` `sectionOf`
  + snippets-first grouping in both modes + Snippets-chip filtering; `pickerLogic` `isEditableSnippet`.
- **Component (behavior)**: new → create + reload + select; edit → update + keep selection; delete →
  confirm + `deleteSnippet`; selecting a snippet fires `onSelect` with the body. ipc wrapper shapes +
  `electronMigrationContracts` entries.

## Known behavior (not blocking)

Multi-line snippet bodies insert **as-is**, including newlines. In the prompt textarea that's plain
multi-line text; in a **live PTY**, embedded newlines act as Enters (line-by-line entry), consistent
with pasting. Matches the "literal body" decision — no special handling.

## Verification gates

- Rust: `cargo test snippet` then full `cargo test` from `src-tauri/`.
- Frontend: `pnpm exec vitest run` on the new `src/lib/injectables/*` + `src/components/injectables/*`
  tests; `pnpm exec tsc --noEmit`.
- Diff hygiene: `git diff --check`.
- Review gate: an `agent`/`review` pass over the diff before handoff; resolve blocking findings.
