# Injectables Cutover & Cleanup Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every trace of the OLD, in-app injectable/skills picker from OpenForge now that it lives as the external `com.openforge.injectables` plugin — with zero injectable-specific footprint left in OpenForge and the generic plugin/injection-point infrastructure fully intact.

**Architecture:** OpenForge already renders injectables through the GENERIC `injectionPoints` extension point (the external plugin drives every `InjectionPointSlot` + `PromptInput`'s `injectableInsertRequest`→insert path). The old built-in picker (`⌘⇧I` → `pickerState`/`InjectablePicker`), the in-repo `skills-viewer` builtin plugin, the SDK's injectable-specific logic + domain types, and the `snippets`/`snippet_projects` DB tables are now dead weight and get deleted in dependency order (consumers first, then modules, then a forward DB migration). Two small plugin-repo cleanups (deferred findings F2/F3) close out the migration.

**Tech Stack:** Svelte 5 + TypeScript renderer, `@openforge-app/plugin-sdk`, Rust sidecar (`rusqlite_migration` via a `define_migrations!` macro), vitest + cargo test.

## Global Constraints

- **KEEP the generic plugin infra — never delete it:** `src/components/plugin/InjectionPointSlot.svelte`, plugin hosting/loading/registry, `getPluginRenderProps`, the Svelte host-runtime sharing infra (`packages/plugin-sdk/src/svelteHostRuntimeContract.mjs`, `vite.config.ts` externalization, `plugin://host-runtime`), and `PromptInput`'s `injectableInsertRequest` prop + `lastInjectableInsertRequestId` + the insert `$effect` calling `insertTextAtCursor` (the external plugin drives it).
- **KEEP in the SDK:** `CommandInfo` (`packages/plugin-sdk/src/domain.ts`) and `Project` — the external plugin imports both; and the whole generic `injectionPoints` SDK surface (`InjectionPointLocation`, `PluginInjectionPointProps`, `PluginInjectionPointRegistration`, `FrontendInjectionPointRegistry`). Verified: the external plugin imports **no** `@openforge-app/plugin-sdk/injectables` and **no** `@openforge-app/plugin-sdk/domain` — only `CommandInfo`/`Project` from the bare SDK plus generic surfaces.
- **Never delete an existing DB migration** — that lowers `LATEST_USER_VERSION` and triggers `DatabaseTooFarAhead` for any DB already at the newer version. Only APPEND a new forward `DROP TABLE` migration.
- **Root `tsc --noEmit` fails locally** (a local `ignoreDeprecations` artifact); typecheck per-package (`pnpm --filter <pkg> exec tsc --noEmit`) + rely on LSP diagnostics. CI runs the real typecheck.
- **Never run `pnpm electron:dev`** — after implementation, ASK the user to run the app and confirm the external injectables plugin still installs, renders (⌘L), and inserts at all three injection points. The cutover must not break the external plugin.
- **Commands:** `pnpm test <path>` / `pnpm exec vitest run <path>` for focused frontend tests; `cargo test <filter>` from `src-tauri/` (one filter per command, never after `--`); `pnpm --filter @openforge-app/plugin-sdk build` after any SDK source change (core + plugins consume `dist/`).
- **Commits:** no Claude/Anthropic mention, no co-author line. Frequent, one per task.

---

## File Structure

Deletion/edit surface, in dependency order (consumers → modules → DB):

- **Task 1 (edit):** the built-in-picker *references* — `src/App.svelte`, `src/components/AddTaskDialog.svelte`, `src/components/task-detail/AgentStatusPill.svelte`, `src/components/prompt/PromptInput.svelte`, `src/lib/appShortcutDefinitions.ts`, `src/lib/appShortcuts.ts`, and their tests.
- **Task 2 (delete):** `src/components/injectables/` (whole dir) + `src/lib/injectables/` (whole dir).
- **Task 3 (delete + edit):** the `skills-viewer` builtin — `builtin-plugins.json`, `src/lib/plugin/builtinPluginModules.ts`, `src/lib/skillsViewerPlugin.ts`, `plugins/skills-viewer/` (whole dir), `vitest.config.ts`; plus test-fixture updates that use skills-viewer as example data.
- **Task 4 (delete + edit):** the injectable-specific SDK surface — `packages/plugin-sdk/src/injectables/` (whole dir), the injectable block in `packages/plugin-sdk/src/domain.ts` (keep `CommandInfo`), `packages/plugin-sdk/package.json` `./injectables` export, `packages/plugin-sdk/src/vite.ts` alias, `vite.test.ts` assertions.
- **Task 5 (append):** `src-tauri/src/db/migrations.rs` — one new forward DROP migration.
- **Task 6 (openforge-plugins repo):** deferred findings F2 (`InjectablesView.svelte` snippet-scope-on-edit) + F3 (unused `listSkills`).

Each task ends with: build green, the relevant test suite green, and (for the OpenForge tasks) the external injection-point path still compiling/working.

---

### Task 1: Remove the ⌘⇧I shortcut + built-in picker open-path wiring

> **STATUS: ✅ DONE** — commit `95916418` (openforge, this branch). Review clean.

Remove every *reference* to the built-in picker so its files (Task 2) can be deleted without breaking the build. Do NOT touch the `InjectionPointSlot` / `injectableInsertRequest` wiring.

**Files:**
- Modify: `src/App.svelte` — remove `:10` `import InjectablePicker`, `:11` `import { pickerState }`, the `openInjectablePicker` handler (`:489-503`), and the `<InjectablePicker … />` mount (`:636-641`).
- Modify: `src/components/AddTaskDialog.svelte` — remove `:20` `import { pickerState }`, `function openInjectables()` (`:77-85`), and `onOpenPicker={openInjectables}` (`:463`). KEEP `InjectionPointSlot` import (`:21`), `InjectionPointLocation` import (`:22`), `injectableInsertRequest`/`nextInjectableInsertRequestId` state (`:70,74`), `injectionLocation` (`:75`), and the `<InjectionPointSlot …>` block (`:444-452,462`).
- Modify: `src/components/task-detail/AgentStatusPill.svelte` — remove `:8` `import { pickerState }`, `openInjectables()` (`:53-63`), and the `<button aria-label="Open injectables" … (⌘⇧I)>` (`:79-87`). KEEP `InjectionPointSlot` import (`:10`), the `<InjectionPointSlot location="agentSession" …>` block (`:66-71`), and `injectableProjectId` (`:56`, still consumed by the slot).
- Modify: `src/components/prompt/PromptInput.svelte` — remove the `onOpenPicker?: () => void` prop decl (`:21`), its destructure (`:41`), and the `{#if onOpenPicker}` "Open injectables" button (`:335-345`). KEEP the `injectableInsertRequest` prop (`:20,40`), `lastInjectableInsertRequestId` (`:60`), and the insert `$effect` (`:152-158`).
- Modify: `src/lib/appShortcutDefinitions.ts` — remove `| 'openInjectablePicker'` from the action-type union (`:18`) and the `id: 'injectables'` definition with its `⌘⇧I` registration + help entry (`:97-99`).
- Modify: `src/lib/appShortcuts.ts` — remove `openInjectablePicker(): void` from `AppShortcutHandlers` (`:20`) and the `case 'openInjectablePicker':` (`:75-77`).
- Test: `src/lib/appShortcuts.test.ts` (remove `openInjectablePicker` handler entries `:37,78,95,130,152` and the `⌘⇧I` help-def assertion `:59`); `src/components/prompt/PromptInput.injectable.test.ts` (remove the two `onOpenPicker` button tests `:13-27`, KEEP the `injectableInsertRequest` insertion test); `src/components/task-detail/AgentStatusPill.injectionPoint.test.ts` (drop the `pickerState` mock `:50-51` + open-picker assertions, KEEP the `InjectionPointSlot` onInsert coverage `:28,112,124`).

**Interfaces:**
- Consumes: nothing (first task).
- Produces: an OpenForge tree with NO references to `InjectablePicker`, `pickerState`, `openInjectables`, `openInjectablePicker`, or `onOpenPicker`. Later tasks rely on this to delete files.

- [ ] **Step 1: Remove the references** in each file above (delete the listed imports, handlers, buttons, props, shortcut entries). Read each file first; remove exactly the injectable-picker lines and nothing generic. In `App.svelte`, after removing `openInjectablePicker`, check whether `writePty`/`isPtyActive`/`focusTerminal`/`$selectedTaskId` become unused and remove any now-dead import (only if unused elsewhere).

- [ ] **Step 2: Update the three affected tests** — delete the `onOpenPicker` button tests and the `pickerState`/⌘⇧I assertions; keep the generic (`injectableInsertRequest`, `InjectionPointSlot`) coverage.

- [ ] **Step 3: Verify no dangling references remain**

Run: `grep -rnE "InjectablePicker|pickerState|openInjectables|openInjectablePicker|onOpenPicker" src/ | grep -v "InjectionPoint"`
Expected: no matches under `src/` (the `src/components/injectables/` + `src/lib/injectables/` files still exist but are deleted in Task 2; if grep shows only those two dirs, that's expected — everything ELSE must be clean).

- [ ] **Step 4: Run the affected suites + build**

Run: `pnpm exec vitest run src/lib/appShortcuts.test.ts src/components/prompt/PromptInput.injectable.test.ts src/components/task-detail/AgentStatusPill.injectionPoint.test.ts`
Expected: PASS.
Run: `pnpm exec vite build`
Expected: builds clean (the `src/components/injectables` files are still present so imports resolve; they're removed next task).

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/components/AddTaskDialog.svelte src/components/task-detail/AgentStatusPill.svelte src/components/prompt/PromptInput.svelte src/lib/appShortcutDefinitions.ts src/lib/appShortcuts.ts src/lib/appShortcuts.test.ts src/components/prompt/PromptInput.injectable.test.ts src/components/task-detail/AgentStatusPill.injectionPoint.test.ts
git commit -m "refactor: drop the built-in injectable picker open-path (⌘⇧I) and its wiring"
```

---

### Task 2: Delete the built-in picker components + state

> **STATUS: ✅ DONE** — commit `8632d170` (openforge, this branch). Review clean.

**Files:**
- Delete: `src/components/injectables/` (entire dir) — `InjectablePicker.svelte`, `InjectablePicker.test.ts`.
- Delete: `src/lib/injectables/` (entire dir) — `pickerState.svelte.ts` (+ test), `useInjectableCatalog.svelte.ts` (+ test), `pluginSnippetStore.ts` (+ test).

**Interfaces:**
- Consumes: Task 1 removed all references to these files.
- Produces: no in-app built-in picker. Task 4 (SDK) relies on these being gone (they were the only in-`src/` consumers of `@openforge-app/plugin-sdk/injectables`).

- [ ] **Step 1: Delete both directories**

```bash
git rm -r src/components/injectables src/lib/injectables
```

- [ ] **Step 2: Verify nothing imports them**

Run: `grep -rnE "components/injectables|lib/injectables" src/ packages/ plugins/ 2>/dev/null`
Expected: no matches (the in-repo `skills-viewer` plugin has its OWN `src/lib/injectableCatalog.ts`; it does not import `src/lib/injectables`).

- [ ] **Step 3: Build + typecheck the renderer**

Run: `pnpm exec vite build`
Expected: builds clean.

- [ ] **Step 4: Run the full frontend suite**

Run: `pnpm test`
Expected: PASS (the deleted files' tests are gone; nothing else referenced them). If a test still imports a deleted module, it was missed in Task 1 — fix the reference, don't restore the file.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: delete the built-in injectable picker components and state"
```

---

### Task 3: Remove the in-repo skills-viewer builtin plugin

> **STATUS: ✅ DONE** — commit `978ac6df` (openforge, this branch). Review clean. 11 test fixtures
> repointed to real remaining builtins (roadmap/github-sync/task-schedules).

The `skills-viewer` builtin registered only a `views` "Skills" tab (no `injectionPoints`), so removing it does not touch the generic injection-point path. The builtin catalog is data-driven from `builtin-plugins.json`, so production Rust needs no change — only a test repoint.

**Files:**
- Modify: `builtin-plugins.json` — remove the `{ "id": "com.openforge.skills-viewer", "directoryName": "skills-viewer" }` object (`:10-14`).
- Modify: `src/lib/plugin/builtinPluginModules.ts` — remove `SKILLS_VIEWER_PLUGIN_ID` import (`:4`), `import skillsViewerPlugin` (`:10`), and the `[SKILLS_VIEWER_PLUGIN_ID]: skillsViewerPlugin` map entry (`:18`).
- Delete: `src/lib/skillsViewerPlugin.ts` (whole file).
- Delete: `plugins/skills-viewer/` (whole dir).
- Modify: `vitest.config.ts` — remove the `'plugins/skills-viewer/src/**/*.test.ts'` glob (`:43`).
- Verify: `pnpm-workspace.yaml` — if it globs `plugins/*`, no edit is needed; if it lists `plugins/skills-viewer` explicitly, remove that line.
- Test fixtures to UPDATE (swap the example plugin/view-key or drop the skills-viewer case; the routing/host-command infra is KEEP): `src-tauri/src/builtin_plugins.rs:169-181` (`install_path_uses_catalog_directory_name` — repoint to another builtin), `scripts/electron-package.test.mjs:358`, `src/App.test-harness.ts:34-35,102`, `src/App.navigation.test.ts:151`, `src/lib/router.svelte.test.ts:206,429,437`, `src/lib/views.test.ts:102,143`, `src/lib/iconRailNav.test.ts:15`, `src/components/shell/CommandPaletteComponent.test.ts:10`, `src/lib/plugin/pluginHostCommands.test.ts:206`, `src/lib/electronMigrationContracts.test.ts:133`, `src-tauri/src/app_invoke/tests/runtime.rs:73`.

**Interfaces:**
- Consumes: independent of Tasks 1–2.
- Produces: no `com.openforge.skills-viewer` builtin. The builtin-plugin catalog + view routing infra remains, exercised by the other builtins.

- [ ] **Step 1: Remove the registration + delete the files**

```bash
git rm src/lib/skillsViewerPlugin.ts
git rm -r plugins/skills-viewer
```
Then edit `builtin-plugins.json`, `src/lib/plugin/builtinPluginModules.ts`, and `vitest.config.ts` as listed.

- [ ] **Step 2: Update the fixture/test references** — for each file above, pick a still-present builtin plugin id/directory (inspect the remaining entries in `builtin-plugins.json`) and repoint the assertion, or delete the skills-viewer-specific case where it's just one row in a list. The behavior under test (catalog directory resolution, view-key routing, command-palette listing, migration contracts) is generic — keep it green with a different example.

- [ ] **Step 3: Verify no skills-viewer references remain in production code**

Run: `grep -rnE "skills-viewer|skillsViewerPlugin|SKILLS_VIEWER" src/ packages/ builtin-plugins.json vitest.config.ts 2>/dev/null`
Expected: no matches (test files may still be updated in Step 2; production must be clean).

- [ ] **Step 4: Build + suites**

Run: `pnpm exec vite build`
Run: `pnpm test`
Run (from `src-tauri/`): `cargo test builtin_plugins`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: remove the in-repo skills-viewer builtin plugin"
```

---

### Task 4: Remove the injectable-specific SDK surface

Delete the SDK's injectable logic + domain types. **KEEP `CommandInfo` and `Project`** (the external plugin imports both). After Tasks 2–3 there are no in-repo consumers of the deleted symbols.

**Files:**
- Delete: `packages/plugin-sdk/src/injectables/` (whole dir) — `index.ts`, `buildInjectables.ts` (+ test), `facets.ts` (+ test), `pickerLogic.ts` (+ test), `snippetStore.ts` (+ test).
- Modify: `packages/plugin-sdk/src/domain.ts` — delete the injectable block `Snippet` (`:664`), `InjectableKind`/`InjectableOrigin`/`InjectableTriggerMode`/`InjectableGroupBy` (`:678-681`), `InjectableSection` (`:685`), `Injectable` (`:687-703`). **KEEP `CommandInfo` (`:639`)** and all PR-readiness types. `index.ts:139 export type * from './domain'` keeps working with fewer symbols.
- Modify: `packages/plugin-sdk/package.json` — remove the `"./injectables"` entry from the `exports` map.
- Modify: `packages/plugin-sdk/src/vite.ts` — remove the `['@openforge-app/plugin-sdk/injectables', 'packages/plugin-sdk/src/injectables/index.ts']` alias entry (`:58`).
- Modify: `src/lib/types.ts` — remove the informational comment block (`:47-51`) describing the moved `Injectable`/`Snippet` view model. KEEP the `export * from '@openforge-app/plugin-sdk/domain'` re-export.
- Test: `packages/plugin-sdk/src/vite.test.ts` — drop the `/injectables` alias assertions (`:28,60`).

**Interfaces:**
- Consumes: Tasks 2–3 removed the only in-repo consumers.
- Produces: an SDK that still exports `CommandInfo`, `Project`, and the generic `injectionPoints` surface — exactly what the external plugin imports.

- [ ] **Step 1: Delete the module + trim domain.ts + config**

```bash
git rm -r packages/plugin-sdk/src/injectables
```
Then edit `domain.ts` (delete the injectable block, keep `CommandInfo`), `package.json` (remove `./injectables` export), `vite.ts` (remove alias), `vite.test.ts` (drop alias assertions), `src/lib/types.ts` (remove comment).

- [ ] **Step 2: Confirm KEEP symbols survive**

Run: `grep -nE "CommandInfo|InjectionPointLocation|PluginInjectionPointProps" packages/plugin-sdk/src/domain.ts packages/plugin-sdk/src/types.ts packages/plugin-sdk/src/index.ts`
Expected: `CommandInfo` still in `domain.ts`; injection-point types still in `types.ts`/`index.ts`.

- [ ] **Step 3: Rebuild the SDK + typecheck**

Run: `pnpm --filter @openforge-app/plugin-sdk build`
Run: `pnpm --filter @openforge-app/plugin-sdk exec tsc --noEmit`
Expected: builds + typechecks clean (no reference to the deleted `injectables/` module or domain types).

- [ ] **Step 4: SDK + renderer suites**

Run: `pnpm --filter @openforge-app/plugin-sdk test` (or `pnpm exec vitest run packages/plugin-sdk`)
Run: `pnpm exec vite build`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: remove injectable-specific SDK logic + domain types (keep CommandInfo)"
```

---

### Task 5: Add a forward migration dropping snippets / snippet_projects

`src-tauri/src/db/migrations.rs` builds a positional migration list via `define_migrations!`; `LATEST_USER_VERSION` is derived from the count. The `snippets` (`:1350-1360`) and `snippet_projects` (`:1366-1402`) tables are the LAST entries. **Do not delete them** — append one new forward migration that drops them (drop the FK child first).

> **Data note (confirm during execution):** the external plugin stores snippets on the filesystem (`~/.openforge/injectables/snippets.json`), NOT the DB, so these tables are legacy/orphaned. Dropping them discards any snippets a user created via the OLD built-in picker without migrating them. This matches the documented Plan 3 scope (drop, no data migration). If real users may have DB snippets, raise it before running — otherwise proceed.

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` — append inside `define_migrations!(…)`, immediately after the `snippet_projects` migration (`:1402`).

**Interfaces:**
- Consumes: nothing (DB-only).
- Produces: `LATEST_USER_VERSION` increments by 1; fresh DBs never create the tables (new migration drops them after the old ones create them — net absent), existing DBs at the prior version drop them on upgrade.

- [ ] **Step 1: Append the drop migration** — after the `snippet_projects` `M::up(...)` entry, add:

```rust
// Injectable/snippet picker moved to the external com.openforge.injectables
// plugin, which persists snippets to the filesystem. Drop the now-unused DB
// tables. New migration (never edit/delete the CREATE migrations above — that
// lowers LATEST_USER_VERSION and triggers DatabaseTooFarAhead).
M::up("DROP TABLE IF EXISTS snippet_projects; DROP TABLE IF EXISTS snippets;"),
```

- [ ] **Step 2: Verify migrations still line up**

Run (from `src-tauri/`): `cargo test migrations`
Expected: PASS — `test_latest_user_version_matches_migration_count` and `test_new_db_user_version` derive from the macro, so they stay green with the new (higher) count. The `MigrationBoundary` literals (`:2047-2068`) are unaffected — do NOT re-point them.

- [ ] **Step 3: Confirm no snippet schema remains reachable in a fresh DB**

Run (from `src-tauri/`): `cargo test` (or a targeted DB test that opens a fresh migrated DB) and confirm a fresh migrated database has no `snippets`/`snippet_projects` tables.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): forward migration dropping legacy snippets/snippet_projects tables"
```

---

### Task 6: Plugin-repo cleanups — deferred findings F2 + F3

**Repo: `openforge-plugins`** (`/Users/avivhadar/repos/openforge-plugins`, same branch). These are the two findings deferred from Plan 2. Independent of Tasks 1–5.

**Files:**
- Modify: `plugins/injectables/src/InjectablesView.svelte` — **F2**: editing a snippet's body resets its project scope to "all projects". Keep the raw `snippets` (with real scope) in view state and seed the edit form from the selected snippet's actual scope, mirroring the picker (`InjectablePicker.svelte`'s `selectedSnippetScope`). The faithful-port bug is: line ~71 discards `result.snippets`, line ~123 forces `snippetAllProjects = true`.
- Modify: `plugins/injectables/src/backend/*` + `plugins/injectables/src/lib/skillDomain.ts` — **F3**: the `listSkills` handler + most of `skillDomain.ts` are unreferenced in production (the frontend sources skills via `api.commands.listCatalog`). Remove the unused `listSkills` method registration + the dead `skillDomain` code + its standalone test, keeping only what production references.

**Interfaces:**
- Consumes: the plugin's existing snippet CRUD + catalog code.
- Produces: a plugin where the ⌘L view preserves snippet scope on edit and carries no dead skill-discovery code.

- [ ] **Step 1 (F2): Write the failing test** — in `InjectablesView.test.ts`, assert that editing a snippet scoped to a single project and saving preserves `allProjects: false` + its `projectIds` (not reset to all).

- [ ] **Step 2 (F2): Run it, confirm it fails** — `pnpm --filter @openforge-app/plugin-injectables exec vitest run src/InjectablesView.test.ts`.

- [ ] **Step 3 (F2): Fix** `InjectablesView.svelte` — keep raw `snippets` in state; seed `snippetName`/`snippetBody`/`snippetAllProjects`/scope from the selected snippet's real persisted scope on `startEditSnippet`.

- [ ] **Step 4 (F2): Run the test, confirm it passes.**

- [ ] **Step 5 (F3): Delete the unused `listSkills` handler** + dead `skillDomain.ts` code + its standalone assertion test. Confirm no production code path references them (`grep -rn "listSkills\|skillDomain" src/`).

- [ ] **Step 6: Full plugin suite + build + typecheck**

Run: `pnpm --filter @openforge-app/plugin-injectables test && pnpm --filter @openforge-app/plugin-injectables typecheck && pnpm --filter @openforge-app/plugin-injectables build`
Expected: all green.

- [ ] **Step 7: Commit (in openforge-plugins)** — stage only source + tests; do NOT stage the machine-local `package.json` SDK link.

```bash
git add plugins/injectables/src/InjectablesView.svelte plugins/injectables/src/InjectablesView.test.ts plugins/injectables/src/backend plugins/injectables/src/lib/skillDomain.ts
git commit -m "fix(injectables): preserve snippet scope on edit (F2); drop unused listSkills (F3)"
```

---

## Final verification (after all tasks)

- [ ] **Full OpenForge suite green:** `pnpm test`, `pnpm exec vite build`, and (from `src-tauri/`) `cargo test`.
- [ ] **Zero injectable footprint check:** `grep -rniE "injectable|snippet|skills-viewer" src/ packages/plugin-sdk/src/ builtin-plugins.json` returns only (a) the GENERIC `injectionPoints`/`InjectionPointSlot`/`injectableInsertRequest` mechanism, (b) `CommandInfo`, and unrelated Svelte-`Snippet`/"code snippet" hits — no built-in-picker, no injectable domain, no skills-viewer.
- [ ] **External plugin still builds against the trimmed SDK:** rebuild the SDK, then `pnpm --filter @openforge-app/plugin-injectables build` + `typecheck` in the plugins repo.
- [ ] **USER smoke test (ask; never run `electron:dev` yourself):** install the external injectables plugin, confirm ⌘L renders, snippet CRUD persists, and the injection trigger inserts at all three points — i.e., the cutover removed the OLD picker without breaking the NEW one.

## Self-review checklist (run before executing)

1. **Spec/scope coverage:** every item in the Plan-3 scope (components, lib, SDK logic + domain, skills-viewer builtin from all 3 registration points, ⌘⇧I wiring/old triggers, forward DB migration, F2, F3) maps to a task. ✅
2. **KEEP-list intact:** no task deletes `InjectionPointSlot`, the plugin infra, `PromptInput`'s `injectableInsertRequest` mechanism, `CommandInfo`, `Project`, or the generic `injectionPoints` SDK surface. ✅
3. **DB safety:** no existing migration deleted; only a forward `DROP` appended; `MigrationBoundary` literals untouched. ✅
