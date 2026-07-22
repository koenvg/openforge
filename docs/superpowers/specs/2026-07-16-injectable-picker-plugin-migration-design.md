# Injectable Picker → External Plugin Migration — Design

> Status: **Draft for review**
> Date: 2026-07-16
> Branch: `aviv/openforge/injectable-picker-design` · openforge PR #1286
> Supersedes the root-level `INJECTABLE_PICKER_MIGRATION_PLAN.md` (which described an
> earlier in-repo unification, now superseded by this cross-repo relocation).

## 1. Goal

Relocate the **injectable/skills product unit** out of the OpenForge app repo and into
the separate **`openforge-plugins`** repo, where plugins are meant to live. The unit is
treated as **one product** even though it is architecturally split today:

1. **The Injectables view** (⌘L rail view — today the "Skills" tab; to be renamed
   **"Injectables"**), a master-detail over skills + slash-commands + personal snippets
   with snippet CRUD. *(Already a plugin: `plugins/skills-viewer`.)*
2. **The injectable picker dialog** — the summonable master-detail used to insert an
   injectable into an agent prompt/terminal. *(Today core: the ⌘⇧I modal.)*

Both move into a single external plugin.

### Guiding principle — zero injectable footprint in OpenForge

After the migration, **OpenForge retains only *generic* plugin-platform mechanisms** (the
injection-point slots + the `commands.listCatalog()` catalog capability + generic SDK UI).
It keeps **no injectable-specific code, domain types, or database schema**. Every
injectable-specific thing — the view, the picker dialog, the picker/snippet *logic* today
in the SDK (`buildInjectables`, `facets`, `pickerLogic`, `snippetStore`), the `Snippet`/
`Injectable` types, and snippet persistence — lives in the plugin. There must be no
"snippets database in OpenForge that's only reachable via an external plugin."

The single unavoidable exception is `commands.listCatalog()`: the plugin physically cannot
enumerate builtin/plugin-provided slash-commands itself, so it stays in core — but it is a
*generic* host capability ("list the catalog"), not an injectable reference.

### Delivery model (decided)

The plugin ships as a **manually-installed, opt-in external plugin** — installed via
Settings → Plugins (local path during dev, git/npm later), like the existing `Jira`
plugin in `openforge-plugins`. It is **not** a builtin and **not** auto-installed.

**Consequence, accepted:** on a fresh app the Injectables view and injectable insertion
are **absent until the user installs + enables the plugin per project**. This is a
deliberate change from today's builtin behavior.

## 2. Current state

### What works today (must not regress)
- The Injectables/Skills view (⌘L) + snippet CRUD.
- **Scenario 2** — inserting an injectable **during an agent session** (the live-session
  pill, `AgentStatusPill.svelte:58`, writes to the agent terminal).

### Broken / absent today (verified on the user's local instance)
- **Scenario 1** — the "Open injectables" button in the Create-Task dialog
  (`AddTaskDialog.svelte:74`) does not successfully insert.
- **Scenario 3** — editing a **backlog task's initial prompt** in the info panel has **no
  dedicated trigger** at all (only the global ⌘⇧I, whose handler inserts into a terminal,
  not the prompt field).

Because 1 and 3 don't work, they are **not a regression risk** — the migration effectively
(re)builds them. Per the user's decision (**option i**), we wire all three scenarios as
part of this work, so 1 and 3 come back to life as a byproduct.

### Being dropped intentionally
- The **global ⌘⇧I-from-anywhere** hotkey. "Browse from anywhere" is served by the
  Injectables view (part 1). Injection is confined to the three editing contexts below.

### Root cause of the 1/3 breakage (informs the design)
The three surfaces share **one** App-root `InjectablePicker` driven by global
`pickerState`, with per-surface `onInsert` callbacks and text threaded back through child
state (`injectableInsertRequest`). This indirection — a single global modal + request
plumbing — is fragile. The new design removes it: each injection point is self-contained
and calls a core-provided `onInsert` directly.

## 3. Target architecture

The confinement of injection to **three enumerable editing contexts** eliminates the need
for a general-purpose "app-root overlay summonable from anywhere." Instead we add a small,
bounded **injection-point** extension point.

### 3.1 The injection-point extension point (the one new mechanism)

The host defines exactly **three named injection locations**:

| Location id        | Where it renders                                   | `onInsert` target (core-owned)          |
|--------------------|----------------------------------------------------|-----------------------------------------|
| `createTaskPrompt` | inside the Create-Task dialog, near the prompt     | the create-task prompt textarea         |
| `agentSession`     | the live-session surface (task view)               | the agent terminal (existing write path)|
| `backlogPrompt`    | the backlog task info panel, near the prompt editor| the backlog task's initial-prompt field |

A frontend plugin registers a component for one or more locations via a new API on
`FrontendOpenForgeAPI` (added to the existing `@openforge-app/plugin-sdk/frontend`
surface — **no new SDK subpath**, to avoid subpath-wiring overhead):

```ts
// SDK shape (illustrative)
openforge.injectionPoints.register({
  location: 'createTaskPrompt' | 'agentSession' | 'backlogPrompt',
  component: PluginComponent, // rendered by the host at that location
})
```

The host mounts the registered component in a `PluginSlot` at each location and passes:

```ts
{ location, projectId: string | null, taskId: string | null, onInsert: (text: string) => void }
```

The plugin component renders a trigger (e.g. an "Insert injectable" button) that opens the
plugin's **own** picker (using `@openforge-app/plugin-sdk/ui/Modal.svelte`). On selection
it calls `onInsert(chosenText)`. **Insertion targets stay fully core-owned** — the plugin
never touches the textarea/terminal directly, so it needs no `shell` capability.

**Graceful degradation is local and automatic:** if no plugin registers for a location,
the host renders nothing there. No plugin installed → the three triggers simply don't
appear; the rest of the app is unaffected.

### 3.2 What stays in openforge (Bucket A — generic platform only)

Only generic, non-injectable mechanisms:
- `commands.listCatalog()` host capability (`src/lib/plugin/*` + the generic `CommandInfo`
  catalog type in the SDK). Stays because the plugin can't compute the catalog alone.
- **New:** the `injectionPoints` extension point (generic SDK types + host `PluginSlot`
  mounts at the three locations) and the rewired trigger surfaces + their core-owned
  `onInsert` targets.
- Generic SDK UI (`Modal`, `MarkdownContent`, `ResizablePanel`), `defineFrontendPlugin`,
  and the generic plugin-storage mechanism (used by other plugins; **not** used for
  snippets anymore — see §3.4).

These must **merge into openforge** so the external plugin has a stable generic SDK to link
against.

### 3.3 What moves to the plugin (Bucket B + C-plugin) — everything injectable

- The dialog UI: today `src/components/injectables/InjectablePicker.svelte` (~990 lines)
  becomes the plugin's picker component, rendered from the injection-point slots.
- `pickerState`, `useInjectableCatalog` logic → plugin-internal.
- **The injectable-specific SDK logic moves *out* of the SDK into the plugin:**
  `buildInjectables`, `facets`, `pickerLogic`, `snippetStore` (today
  `packages/plugin-sdk/src/injectables/*`), plus the `Snippet`/`Injectable`/`InjectableKind`
  /`Origin`/`TriggerMode`/`Section` domain types. Core drops its
  `export * from '@openforge-app/plugin-sdk/domain'` re-exports of these.
- Snippet persistence → **plugin-owned filesystem** (§3.4). The hardcoded
  `com.openforge.skills-viewer` storage coupling in core **disappears**.
- The existing `plugins/skills-viewer` view (renamed display "Injectables").
- All of the above are **deleted from openforge** and recreated in `openforge-plugins`.

### 3.4 Snippet persistence — plugin-owned filesystem (decided: option B)

Snippets no longer touch OpenForge's database in any form.
- **New snippets** are persisted by the **plugin's backend** to the filesystem (exact
  location/format TBD in the plan — e.g. a JSON file alongside skills under `~/.claude`, or
  a dedicated plugin data file). This parallels how **skills already live as files** the
  plugin backend reads; the backend already has fs access.
- The SDK `snippetStore` (today a `PluginStorageScope`-backed store) is replaced by a
  filesystem-backed store inside the plugin backend.
- **Legacy Rust `snippets` tables are dropped** via a *forward* migration that `DROP`s
  `snippets` + `snippet_projects`. We do **not** delete the historical migration entries
  (that would lower `LATEST_USER_VERSION` → `DatabaseTooFarAhead`). Net: the live schema has
  zero snippet tables; the append-only migration ledger keeps the historical `CREATE` as an
  unavoidable artifact.
- **Data migration:** any snippets a dev already has in `storage.global['snippets']` (from
  the interim commit-1 state) are read once and rewritten to the filesystem on first plugin
  run, then the storage key is cleared. (Dev data; cheap, optional.)

## 4. Per-scenario wiring

For each of the three locations, core:
1. Mounts a `PluginSlot` for that injection location at the right spot in the surface.
2. Provides `onInsert(text)` wired to that surface's target:
   - `createTaskPrompt` → insert into the create-task prompt textarea (replacing the old
     `injectableInsertRequest` plumbing with a direct insert).
   - `agentSession` → the existing agent-terminal write path.
   - `backlogPrompt` → insert into the backlog task's initial-prompt field (new; this is
     what makes scenario 3 work for the first time).

The plugin renders the identical picker in all three; only the `onInsert` target differs,
and that difference lives entirely in core.

## 5. Migration order (cross-repo)

1. **openforge (this branch):**
   a. Add the `injectionPoints` SDK API + host `PluginSlot` mounts at the three locations.
   b. Rewire the three trigger surfaces to use injection points + core `onInsert`.
   c. Delete Bucket B: core `src/components/injectables`, `src/lib/injectables`, ⌘⇧I
      wiring, `plugins/skills-viewer`, **and the injectable-specific SDK logic/types**
      (`packages/plugin-sdk/src/injectables/*` + `Snippet`/`Injectable` domain types +
      core re-exports).
   d. Add the forward `DROP` migration for `snippets`/`snippet_projects`; fix the
      relative-offset migration tests for the version bump.
   e. Keep Bucket A (generic only); build the SDK. Merge PR #1286.
2. **openforge-plugins:** create the plugin package (new package name, e.g.
   `@<scope>/openforge-injectables`), `link:` the openforge SDK, port the view + picker +
   the injectable logic/types (`buildInjectables`/`facets`/`pickerLogic`/`snippetStore` +
   `Snippet`/`Injectable`), and add **filesystem snippet persistence** to the backend.
   Build `dist/frontend.js` + `dist/backend.js` (skills + snippets fs), test.
3. **Install** via Settings → Plugins (local path in dev; git once pushed), enable per
   project, verify all three scenarios + the ⌘L view + snippet CRUD.

**Ordering constraint:** step 1's SDK contract must exist in the openforge checkout the
plugin links against **before** the plugin can build (develop the SDK API first, rebuild
SDK, then write the plugin).

## 6. Testing (TDD)

- **openforge:** injection-point registration + host mounting at each location; `onInsert`
  wiring per surface; graceful degradation (no registrant → nothing rendered); the three
  rewired triggers. Update contract-lock tests only if the capability/IPC surface changes.
- **plugin (`openforge-plugins`):** `@openforge-app/plugin-sdk/testing` fakes — activation
  registers the view + injection-point components; picker search/filter/group; snippet
  CRUD against `storage.global`; catalog load via `commands.listCatalog()`.
- **Import boundaries:** add the new injection-point types to the allowlist in
  `scripts/check-plugin-import-boundaries.mjs` if a new export path is introduced (prefer
  extending the existing `/frontend` surface to avoid this).
- Tests cover business logic only — no CSS/visual assertions.

## 7. Risks & mitigations

- **Modal stacking (scenario 1)** — the plugin's picker Modal renders from *inside* the
  Create-Task dialog Modal (modal-over-modal). This is a plausible cause of today's
  scenario-1 breakage. **Validate early** (a focused spike): confirm the plugin Modal
  stacks and traps focus correctly over the dialog; if not, render it via a portal to app
  root or a dedicated high-z overlay layer the host provides.
- **New SDK surface** — extend `FrontendOpenForgeAPI` in `@openforge-app/plugin-sdk/frontend`
  rather than adding a new subpath, to avoid the 6-place subpath wiring.
- **Snippet data migration** — snippets move to plugin-owned files (§3.4); a one-time
  read-`storage.global`-then-write-fs step on first run avoids orphaning interim dev data.
- **DB version bump** — the forward `DROP` migration raises `LATEST_USER_VERSION`; update
  the relative-offset migration tests, and note the drop in the PR (see memory
  `shared-prod-db-across-branch-builds` / `migration-test-relative-offsets`).
- **Opt-in absence** — accepted: fresh app has no injection until install + per-project
  enable.

## 8. Open decisions for review

1. **Plugin id / name.** With snippets now on the filesystem (not plugin storage), the
   storage-continuity reason to keep the old id is gone. Recommended: pick a clean id +
   package name for the external home (e.g. `com.<scope>.injectables` /
   `@<scope>/openforge-injectables`), display name **"Injectables"**. Confirm id + scope.
2. **Injection-point API granularity.** Recommended: a single registered component that
   receives a `location` discriminator (identical picker everywhere). Alternative: register
   per-location components. Confirm the single-component approach.
3. **Snippet file location/format** — under `~/.claude` next to skills, or a dedicated
   plugin data dir; one JSON file vs one file per snippet. (Detail; can settle in the plan.)

## 9. Out of scope

- Restoring the global ⌘⇧I-from-anywhere behavior (intentionally dropped).
- Migrating the other six builtin plugins (this is the pilot).
- Publishing the SDK to npm (still `link:`-based per ADR 0001).
