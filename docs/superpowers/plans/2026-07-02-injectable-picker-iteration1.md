# Injectable Picker — Iteration 1 (Picker: browse · read · insert)

> Supersedes the scope of `2026-06-30-injectable-picker.md` for what we build **now**.
> Design authority: `docs/superpowers/specs/2026-06-29-injectable-picker-design.md` +
> the approved mock `docs/superpowers/mockups/injectable-picker-mockup.html`.
> Driven via a Babysitter run (`.a5c/processes/injectable-picker-mvp.js`) with TDD + a review gate.

## Scope

**In (iteration 1 = phases A–D):** a summonable, Claude-scoped **Injectable Picker** that lists
**skills + commands**, grouped by **Origin** (default) or **Trigger mode**, with search, origin
filtering, collapsible groups, a **closable master-detail reading pane** that shows a skill's full
`SKILL.md`, and **insert into the prompt / live PTY** (no auto-submit). Summon via a button and
**⌘⇧I** in the Create Task dialog and the live task view.

**Out (later):**
- **Snippets** and the **category overlay** → iteration 2.
- **Analyze / audit** feature → iteration 1b (next, right after this).
- **MCP "Connected service" origin** → deferred until we confirm the command scan surfaces MCP
  prompts; iteration 1 ships four origins.
- Other provider adapters, the "/" autocomplete convergence, Skills-tab create/delete/rename.

## Origins (iteration 1)

Rust emits raw origin keys; the UI maps them to friendly labels.

| origin key (Rust/TS) | label (UI) | source |
|---|---|---|
| `personal` | Personal | user level (`~/.claude/...`) |
| `project`  | Project  | project level (`.claude/...`, committed) |
| `plugin`   | Plugin   | installed plugin commands/skills |
| `builtin`  | Claude Code | built-in commands + bundled skills shipped with the CLI |

Group order (by origin): Personal → Project → Plugin → Claude Code. Trigger labels:
`auto+manual` → "auto + manual", `manual-only` → "manual only".

## Data contracts

**`CommandInfo`** (shared, `packages/plugin-sdk/src/domain.ts`) — extend with:
```typescript
export interface CommandInfo {
  name: string;
  description: string | null;
  source: string | null;          // "skill" | "command" | "builtin" | "plugin" | ...
  agent: string | null;
  origin: string | null;          // "personal" | "project" | "plugin" | "builtin"
  triggerMode: string | null;     // "auto+manual" | "manual-only"
  userInvocable: boolean | null;  // false => hidden background skill (picker drops it)
  sourceDir: string | null;       // ".claude" | ".agents" | null
  sourcePath: string | null;      // absolute path to SKILL.md / command .md; null for builtin
}
```

**`Injectable`** (iteration 1, `src/lib/types.ts`) — **no categories, no snippets**:
```typescript
export type InjectableKind = 'skill' | 'command';
export type InjectableOrigin = 'personal' | 'project' | 'plugin' | 'builtin';
export type InjectableTriggerMode = 'auto+manual' | 'manual-only';
export type InjectableGroupBy = 'origin' | 'trigger';

export interface Injectable {
  id: string;                    // `${origin}:${kind}:${name}` — unique, safe for keyed {#each}
  kind: InjectableKind;
  name: string;
  description: string | null;
  origin: InjectableOrigin;
  triggerMode: InjectableTriggerMode;
  sourcePath: string | null;     // for lazy content fetch + the detail "source" line
  invocationText: string;        // `/${name} `
}
```
Content for the reading pane is fetched **lazily** on select (see Task C2), not carried on every list item.

---

## Phase A — Backend catalog enrichment (Rust, TDD)

Backend structs `SkillInfo` (`opencode_client.rs:54`) already carry `level` / `source_dir` /
`source_path` / `template`; `CommandInfo` (`opencode_client.rs:40`) carries
`name/description/source/agent` + a flattened `extra`.

### Task A1 — Parse trigger flags from SKILL.md frontmatter
As committed plan **Task 1**: add `parse_skill_frontmatter_flags()` +
`SkillFrontmatterFlags { disable_model_invocation, user_invocable }` to `command_discovery.rs`
(reuse the `---` block detection from `parse_skill_frontmatter`). TDD: `parses_trigger_flags_from_frontmatter`,
`missing_trigger_flags_are_none`, `no_frontmatter_returns_none_flags`.
> **Verify first:** confirm the real Claude frontmatter keys are `disable-model-invocation` /
> `user-invocable` (checked earlier: used nowhere in-repo, so validate against Claude Code docs before finalizing).

### Task A2 — Carry flags onto SkillInfo during scanning
As committed plan **Task 2**: add `disable_model_invocation` / `user_invocable` to `SkillInfo`
(serde camelCase), populate in `scan_skills_directory` + `scan_pi_skills_directory` (and every other
`SkillInfo` literal). TDD: `scan_skills_directory_populates_trigger_flags`.

### Task A3 — Enrich CommandInfo (origin, triggerMode, userInvocable, sourceDir, sourcePath) for claude-code
Extend `CommandInfo` (Rust + `packages/plugin-sdk/src/domain.ts`) per the Data contract. Populate in
`providers/claude_code.rs::list_commands`:
- `origin`: user-level skills → `"personal"`, project-level → `"project"`, plugin → `"plugin"`, builtin → `"builtin"`.
- `triggerMode`: `disable_model_invocation == Some(true)` → `"manual-only"`, else `"auto+manual"`; **commands → `"manual-only"`**.
- `userInvocable`: from the skill flag; `None` for commands/builtin/plugin.
- `sourceDir`: from `SkillInfo.source_dir`; `None` for builtin/plugin.
- `sourcePath`: from `SkillInfo.source_path` (skills) / the command `.md` path; `None` for builtin.

TDD (in `claude_code.rs`): a temp `.claude/skills/manual/SKILL.md` with `disable-model-invocation: true`
→ assert `origin=="project"`, `trigger_mode=="manual-only"`, `source_dir==".claude"`, `source_path` set.
Then full `cargo test` + `pnpm exec tsc --noEmit` (existing autocomplete only reads name/description/source/agent → additive change is safe).

---

## Phase B — Frontend catalog logic (pure TS, TDD)

### Task B1 — `buildInjectables` mapper (`src/lib/injectables/buildInjectables.ts`)
`buildInjectables({ commands }): Injectable[]`. Rules:
1. Claude-relevance: keep if `source ∈ {command, builtin, plugin}` OR `sourceDir ∈ {.claude, .agents}`; drop `.pi/.codex/.opencode`.
2. Drop `userInvocable === false`.
3. `kind = source === 'skill' ? 'skill' : 'command'`.
4. `origin` normalized to the union (fallback `'project'`); `triggerMode` normalized (fallback `'auto+manual'`).
5. `id = `${origin}:${kind}:${name}``; `invocationText = `/${name} ``; carry `sourcePath`.

Tests: drops `.pi`; keeps `.agents`/plugin/builtin; drops `userInvocable:false`; id/kind/invocation mapping; origin/trigger normalization.

### Task B2 — facets (`src/lib/injectables/facets.ts`)
- `searchInjectables(items, q)` — case-insensitive name+description; empty → all.
- `filterInjectables(items, { origins?, triggers? })` — AND across facets, OR within; empty facet = no constraint.
- `groupInjectables(items, by)` — group by `origin` (ordered Personal→Project→Plugin→Claude Code) or `trigger`; returns `{ key, label, items }[]`.

Tests mirror the mock behavior.

### Task B3 — catalog loader (`src/lib/injectables/useInjectableCatalog.svelte.ts`)
`useInjectableCatalog(getProjectId)` → `{ injectables, loading, error, reload() }`. `reload()` calls
`listOpenCodeCommands(projectId)` (null projectId → `[]`) then `buildInjectables`. Tests with mocked ipc.

---

## Phase C — Picker UI (master-detail)

### Task C1 — `InjectablePicker.svelte` (`src/components/injectables/`)
Props: `{ projectId: string|null, open: boolean, onClose, onSelect(injectable) }`. Behavior mirrors the
approved mock: search input (placeholder `Search injectables…`), Group-by segmented (Origin/Trigger),
origin **Filter by** chips, **collapsible groups** (+ collapse/expand all), a **closable preview pane**
(when closed the list spans full width), row descriptions **never truncated**, origin + trigger badges,
`/name` display, 90%×90% dialog. Selecting inserts `invocationText` (button / double-click / Enter).
Uses `useInjectableCatalog`, `searchInjectables`/`filterInjectables`/`groupInjectables`, and `Modal.svelte`.
`$effect` uses explicit prev-value comparison (no return-cleanup) per repo rule.
Tests (behavior only, no CSS): onSelect fires + closes; search filters; group toggle collapses.

### Task C2 — Lazy content reading pane
On row select, fetch the skill's full source for the reading pane. **Decision to make in-task:** reuse the
skills-viewer content path if one exists; otherwise add a minimal guarded IPC
`readInjectableSource(sourcePath)` (Rust command that reads a file under a known skills/commands dir only).
`sourcePath == null` (builtin/bundled) → show description + a "provided by Claude Code — no source file" note.
Test the ipc wrapper shape + the null-source fallback branch.

---

## Phase D — Integration

### Task D1 — Global ⌘⇧I + picker mount (`appShortcutDefinitions.ts`, `appShortcuts.ts`, `App.svelte`, `pickerState.svelte.ts`)
`pickerState` singleton `{ open, projectId, openPicker({projectId,onInsert}), close(), handleSelect(inj) }`;
`handleSelect` calls stored `onInsert(inj.invocationText)` then closes. Register `openInjectablePicker`
handler + ⌘⇧I; mount `InjectablePicker` once at app root. Test `pickerState` routing.

### Task D2 — Create Task dialog (`PromptInput.svelte`, `AddTaskDialog.svelte`)
Add an "Open injectables" button (aria-labelled) to `PromptInput` controls; `AddTaskDialog` wires
`openPicker` with an `onInsert` that inserts into the prompt via the existing value path. Test the button calls `onOpenPicker`.

### Task D3 — Live session (`AgentTerminalShell.svelte`)
Header button → `openPicker({ projectId, onInsert })` where `onInsert` does `writePty(taskId, text)` +
`focusTerminal(taskId)` when `isPtyActive(taskId)`, **no auto-Enter**. Test the injection handler in isolation
(extract it — do not mount the whole terminal shell).

---

## Verification gates
- Rust: `cargo test` (focused on new command_discovery / claude_code tests, then full) from `src-tauri/`.
- Frontend: `pnpm exec vitest run` on the new `src/lib/injectables/*` + `src/components/injectables/*` tests; `pnpm exec tsc --noEmit`.
- Diff hygiene: `git diff --check`.
- **Review gate (mandated):** an `agent` review pass over the diff before handoff; resolve blocking findings.

## Notes / carried decisions
- Frontmatter key names are load-bearing and unverified in-repo → confirm in A1.
- `id` includes origin+kind+name to avoid the same-name collision + duplicate-`{#each}`-key bug flagged in review of the prior plan.
- Snippets/categories tables + IPC intentionally absent (iteration 2).
