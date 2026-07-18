# Injectables Migration — Resume Handoff

> **Purpose:** the single entry point to resume this work in a fresh (post-`/clear`) session.
> **After `/clear`, say:** *"Read `docs/superpowers/INJECTABLES_HANDOFF.md` and continue."*

## How to resume (read order)

1. This file (position, environment, gotchas).
2. The **active plan doc** — see *Current Position* below.
3. The **active plan doc** (see below) for exact task boundaries + full code/steps. Per-task
   status is in *Plan 2 — Task Status* below (authoritative + tracked). A working copy also
   lives in `.superpowers/sdd/progress-plan2.md` (gitignored SDD scratch — may be absent after
   a clean; DO NOT depend on it). Trust THIS file + `git log` over any recollection.
4. Then invoke skill **`superpowers:subagent-driven-development`** and continue the execution
   protocol below, resuming at the first TODO task.
5. Auto-loaded memories `[[injectable-picker-plugin-relocation]]` and `[[openforge-plugins-repo]]` summarize the same context.

## The goal

Relocate the injectable/skills picker out of the OpenForge app into the external
`openforge-plugins` repo as ONE opt-in plugin (`com.openforge.injectables`), keeping all
functionality, with **zero injectable-specific footprint left in OpenForge**. Design spec:
`docs/superpowers/specs/2026-07-16-injectable-picker-plugin-migration-design.md`.

Three sequential plans:
- **Plan 1** — generic `injectionPoints` extension point in OpenForge. **DONE.**
- **Plan 2** — build the plugin in `openforge-plugins`. **IN PROGRESS.**
- **Plan 3** — cutover/cleanup in OpenForge. **NOT WRITTEN YET** (author after Plan 2 verified).

## Current Position  *(update after every task)*

- **Plan 1: COMPLETE + merge-ready.** Commits `9f9e70d0..f9010d9` on branch
  `aviv/openforge/injectable-picker-design`. Final whole-branch review = READY TO MERGE.
  User smoke-tested; no regressions.
- **Task-0 prereq: DONE** — `injectionPoints` added as a declarable SDK capability
  (openforge commit `a16a12dd`), SDK rebuilt.
- **Plan 2: IN PROGRESS — Tasks 1–6 DONE, all code written + committed on the `openforge-plugins`
  branch `aviv/openforge/injectable-picker-design` (→ `koenvangeert/openforge-plugins`, pushed).**
  - Task 1 scaffold `cd29406`.
  - Task 2 (plugin-local injectable domain + `/injectables` logic) `3775e78`.
  - Task 3 (backend: verbatim skill fs + filesystem snippet store; all 7 methods) `4ad32e6`.
  - Task 4 (Injectables rail view + catalog; snippets via `api.backend.invoke`) `6a5e3f0`.
  - Task 5 (picker dialog port) `7addaf5` + reactivity fix `33ff312` (read `api` fresh in the hook).
  - Task 6 (register injection triggers at the 3 locations) `b68a19a`.
  - Final whole-branch review (opus) = **"Ready to merge: With fixes"**; fixes applied in `ae338c0`
    (backend `whenReady()` guard on catalog load, nullable `projectId` for user-level skill methods,
    stale-comment + `METHOD.*` consistency cleanup, test-double hardening).
  - **Icon refinement `becb8c5`** (post-final-review, human-requested): restored the picker's 4 Lucide
    icons via `@lucide/svelte` (Deferred finding 1 resolved → "add library"). Fresh implementer +
    reviewer, review clean (Minors only). Icons bundled into `dist/frontend.js`; **138/138**, tsc+build green.
  Full plugin suite **138/138**, `tsc --noEmit` + build clean. Each task got a fresh implementer +
  independent reviewer (all ✅ Approved).
  **Deferred-finding decisions taken (this session):** F1 icons = **add the library** (DONE, `becb8c5`);
  F2 snippet-scope-widening bug = **fix during Plan 3**; F3 unused `listSkills` = **trim during Plan 3**.
  **SMOKE TEST FAILED then ROOT-CAUSED + FIXED (2026-07-18, worktree AVIV-113).** User installed
  the plugin (global settings → local path), enabled it for a project, saw the rail icon, clicked
  it → the view was empty with `Plugin Error: Injectables` / `https://svelte.dev/e/effect_orphan`.
  - **Root cause (confirmed via systematic-debugging):** Svelte compiler/runtime **version skew**.
    The plugin bundle was compiled by Svelte **5.56.5** (plugins-repo catalog `^5.56.3` floated),
    but at runtime its externalized `svelte/internal/client` resolves — via the host renderer
    import map — to the host's shared Svelte **5.56.4** (`plugin://host-runtime/svelte`, baked into
    `/Applications/Open Forge.app`). `svelte/internal/*` is a PRIVATE, version-locked API whose
    reactivity core (`runtime.js` — `is_updating_effect`/reactive-context handling) differs between
    5.56.4↔5.56.5, so a 5.56.5-compiled component's effect setup is incompatible with the 5.56.4
    runtime → `effect_orphan` on mount. (Svelte instance IS correctly shared/single; import map,
    externalization, and host-runtime assets are all correct — it was purely the version.) Evaded
    all gates because vitest uses the plugin's OWN svelte for BOTH compile+runtime (consistent).
    The picker + injection triggers would hit the same wall.
  - **FIX APPLIED (uncommitted, pending user retest):** pinned the plugins-repo catalog
    `svelte` to **exact `5.56.4`** (was `^5.56.3`) in `pnpm-workspace.yaml` (with an explanatory
    comment) → `pnpm install` (svelte 5.56.5→5.56.4, lockfile updated, zero 5.56.5 refs) → rebuilt.
    `test` **138/138**, `tsc --noEmit` clean, `dist/frontend.js`+`dist/backend.js` recompiled
    against 5.56.4. Local installs serve `dist/` **in place** (no copy — `install_local_package_*`
    test), so no reinstall needed.
  - **NEXT (user):** fully quit + relaunch Open Forge (re-imports the rebuilt bundle), ⌘L → the
    Injectables view should render (no effect_orphan); then finish the smoke test (snippet CRUD
    persistence, the 3 injection triggers, modal-over-modal stacking). If green → commit the plugin
    fix in `openforge-plugins`, mark Plan 2 done, author Plan 3.
  - **Follow-up (SDK/host, note for Plan 1/3 or a separate host issue):** the "share host Svelte"
    design makes EVERY external Svelte plugin's compile-time version couple to the host's exact
    Svelte patch. The SDK should surface/enforce this (pin or expose the required svelte version)
    so plugin authors don't silently drift. Mirrors the existing @lucide/svelte pin concern.

## Plan 2 — Task Status (authoritative)

- Task 0: **DONE** — env resolved (worktree SDK link) + `injectionPoints` capability added to SDK schema (openforge commit `a16a12dd`).
- Task 1: **DONE + pushed** — plugins branch `aviv/openforge/injectable-picker-design` @ `cd29406` on `koenvangeert/openforge-plugins` (scaffold, sibling SDK link). Machine B checks it out; no re-run needed.
- Task 2: **DONE + pushed** — `3775e78`. Plugin-local injectable domain (`src/lib/injectableDomain.ts`) + `/injectables` logic (`src/lib/injectables/`), byte-identical port, only `CommandInfo` imported from SDK. 53 tests.
- Task 3: **DONE + pushed** — `4ad32e6`. Backend: verbatim skill fs backend + `skillDomain` + filesystem snippet store (`src/backend/snippetFileStore.ts`, persists to `~/.openforge/injectables/snippets.json`, env override `OPENFORGE_INJECTABLES_DIR`); `src/lib/protocol.ts` METHOD constants; all 7 methods registered. 40/40. NOTE: the copied `skillDomain.test.ts` Rust-parity test (read `src-tauri/.../command_discovery.rs`) was replaced with a standalone `SKILL_SOURCE_DIRS` literal assertion — that cross-repo coupling can't exist in the standalone plugin (controller decision).
- Task 4: **DONE + pushed** — `6a5e3f0`. Ported `InjectablesView.svelte` + `src/lib/injectableCatalog.ts`; snippet reads/writes via `api.backend.invoke(METHOD.*)`; view registered id=`injectables`, title=`Injectables`, ⌘L. 101/101, tsc + build clean.
- Task 5: **DONE + pushed** — `7addaf5` (picker `src/InjectablePicker.svelte` + `src/lib/useInjectableCatalog.svelte.ts`, import-remap applied, new `api` prop; picker test adapted to `api.backend.invoke` assertions) + `33ff312` (reviewer fix: the hook now takes `getApi: () => api` and reads it fresh in `reload()`, removing a stale-reference/reactivity warning). 131 tests at the time. Reviewer ✅ Approved. **ICONS RESTORED (`becb8c5`, human decision = add library):** the picker's 4 Lucide icons (Sparkles/skill, SquareTerminal/command, NotebookText/snippet, Plus/new-snippet) are back at exact parity with the app via `@lucide/svelte` (bundled, not externalized). `KIND_MARK` emoji record replaced with `KIND_ICON`/`KIND_ICON_CLASS` component+class records. Fresh implementer + reviewer, clean. See *Deferred findings* F1.
- Task 6: **DONE + pushed** — `b68a19a`. `src/InjectionTrigger.svelte` (Props = `PluginInjectionPointProps`; opens the picker, maps `onSelect`→`onInsert(inj.invocationText)`+close) registered at all three locations (`picker-createTaskPrompt`/`picker-agentSession`/`picker-backlogPrompt`) via a loop in `src/index.ts`. Test mocks the picker child (`InjectablePickerTestDouble`). 136 tests. Reviewer ✅ Approved.
- Task 7: **IN PROGRESS — Steps 1–2 DONE; Step 3 smoke test FOUND + FIXED an `effect_orphan` bug, PENDING user retest.** Automated verify green: `build` + `test` = **138/138**, `tsc --noEmit` clean, `dist/frontend.js` + `dist/backend.js` present (now compiled against svelte **5.56.4**). Final-review fixes committed `ae338c0`. **Smoke-test finding (2026-07-18):** clicking the ⌘L rail icon threw `effect_orphan` — root-caused to a Svelte compiler(5.56.5)/host-runtime(5.56.4) version skew; **fixed by pinning the plugins catalog `svelte` to exact 5.56.4 + rebuild (uncommitted)**. See *Current Position* for the full write-up + the version-lock gotcha. **Remaining (requires the human):** quit + relaunch the app, re-run: ⌘L Injectables view (skills+commands+snippets; snippet create/edit/delete persists to `~/.openforge/injectables/snippets.json`); the injection trigger in the create-task dialog (validate **modal-over-modal stacking**), agent session, and backlog prompt. If green → commit the plugin fix, then Step 5 tags Plan 2 complete.
- **Plan 3:** not written yet — author it after Plan 2's user smoke test passes.

### Deferred findings (whole-branch review — human decisions)

1. **Lucide icons dropped in the picker (Task 5).** ✅ **RESOLVED — human chose "add the library for parity."**
   Restored in `becb8c5`: `@lucide/svelte@^1.25.0` added to the plugin (bundled, not externalized), the 4
   icons back at exact app parity. Done.
2. **⌘L view widens a snippet's project scope to "all projects" on edit (`InjectablesView.svelte`, Task 4).** ➡️
   **DECIDED — fix during Plan 3.** Editing a snippet's body resets its scope. PRE-EXISTING faithful-port
   behavior (source `plugins/skills-viewer/src/InjectablesView.svelte` line 71 discards `result.snippets`,
   line 123 forces `snippetAllProjects = true`) — NOT a Plan-2 regression; the picker preserves scope
   correctly. **Plan 3 fix:** keep raw `snippets` in view state and seed the edit form from the selected
   snippet's real scope, mirroring the picker.
3. **Unused `listSkills` skill-discovery subsystem (Task 3).** ➡️ **DECIDED — trim during Plan 3.** The frontend
   sources skills via `api.commands.listCatalog`, so the ported `listSkills` handler + most of `skillDomain.ts`
   are unreferenced in production (was a plan-mandated verbatim copy). Remove in the Plan-3 cleanup pass.

### Open Minors (from the icon refinement `becb8c5` review — triage at pre-merge / Plan 3)

- `@lucide/svelte` pinned at `^1.25.0` (pnpm-normalized) vs the app's `^1.23.0`. Functionally inert (app range
  allows it; plugin bundles its own copy). Optional: pin to `^1.23.0` for exact declared parity.
- `pnpm add` reformatted `peerDependencies` + the `requires` array in `plugins/injectables/package.json` to
  multi-line — benign diff noise (could be tidied on a future package.json touch).
- ~~**Picker uses Lucide icons but the rail view `InjectablesView.svelte` uses text markers.**~~ ✅ **RESOLVED
  2026-07-18 by investigation — no action.** The ORIGINAL app rail view (`plugins/skills-viewer/src/InjectablesView.svelte`,
  lines 241–244 + 304) uses **text markers only** (`All`/`Snippets`/`ORIGIN_LABELS[section]`, `{selected.kind}` text)
  with **zero Lucide icons** — byte-identical to the plugin's rail view. So the plugin rail view is **already at exact
  parity**; the picker correctly had icons (restored `becb8c5`), the rail view never did. The picker/rail-view icon
  difference faithfully mirrors the original app. Nothing to restore.

## Environment (critical)

- **OpenForge app repo, this branch:** `/Users/aviv.hadar/.openforge/worktrees/openforge/AVIV-124`
  (branch `aviv/openforge/injectable-picker-design`). This is the orchestration cwd.
- **Plugins repo (Plan 2 work):** `/Users/aviv.hadar/repos/openforge-plugins` (on `main`, was empty).
- **Plugin SDK link:** sibling convention `link:../../../openforge/packages/plugin-sdk`. Requires
  `openforge-plugins` to sit beside an `openforge` checkout that is on branch
  `aviv/openforge/injectable-picker-design` (has Plan 1) with its SDK built. (This is the standard
  layout on the primary dev machine; the retired machine used an absolute worktree link instead.)
- **Plugin id** `com.openforge.injectables` · pkg `@openforge-app/plugin-injectables` · view
  "Injectables" (⌘L). Snippets persist to `~/.openforge/injectables/snippets.json`.
- **NEVER run `pnpm electron:dev`** — ask the user to run the app and report.

### Cross-machine resume (IMPORTANT)

Both repos are pushed. Branch name is the SAME in both: `aviv/openforge/injectable-picker-design`.
- **openforge** → `git@github.com:koenvg/openforge.git` (Plan 1, SDK capability, spec + plan docs + this handoff).
- **openforge-plugins** → `koenvangeert/openforge-plugins` (the Task-1 scaffold @ `cd29406`, with the sibling SDK link). Push access is granted.

Machine setup:
1. In your `openforge` checkout (sibling of `openforge-plugins`):
   `git fetch && git checkout aviv/openforge/injectable-picker-design`, `pnpm install`,
   `pnpm --filter @openforge-app/plugin-sdk build`.
2. In the sibling `openforge-plugins` checkout:
   `git fetch && git checkout aviv/openforge/injectable-picker-design`, then `pnpm install` (the
   sibling link `../../../openforge/packages/plugin-sdk` now resolves + the SDK is built). Task 1 is
   already done on this branch — continue at Task 2.
3. Plugin work pushes to `origin` (`koenvangeert/openforge-plugins`) normally. Commit Plan 2 tasks
   there and push the branch as you go.

### Running via an OpenForge task (worktree mode) — READ IF STARTED AS AN OPENFORGE TASK

An OpenForge task on the `openforge` repo runs in an **isolated worktree**. That worktree HAS
Plan 1's SDK, but it is NOT the sibling that `openforge-plugins`'s committed `link:../../../openforge/...`
resolves to. So the ONE task drives both repos like this:

> **Resolved on the current dev machine (user `avivhadar`):** the `openforge-plugins` clone is at
> `/Users/avivhadar/repos/openforge-plugins`. Each OpenForge task gets a NEW worktree path
> (e.g. `/Users/avivhadar/.openforge/worktrees/openforge/AVIV-<n>`), so the machine-local SDK
> `link:` in `plugins/injectables/package.json` must be re-pointed at THIS run's worktree every
> resume (and never committed). The earlier handoff paths under `/Users/aviv.hadar/...` are a
> different, retired machine.
1. In the task worktree (openforge): `pnpm install && pnpm --filter @openforge-app/plugin-sdk build`.
   Record its path: `WT=$(git rev-parse --show-toplevel)`.
2. In the `openforge-plugins` checkout (ASK the user for its absolute path — it is a normal on-disk
   clone, not a worktree): `git fetch && git checkout aviv/openforge/injectable-picker-design`. Then
   set a LOCAL SDK link so it builds against the task worktree: edit
   `plugins/injectables/package.json` dep to `link:$WT/packages/plugin-sdk` and `pnpm install`.
   **Do NOT commit that machine-specific link** — when committing Plan 2 work, stage only your new/
   edited source files and keep the committed sibling link (`git checkout -- plugins/injectables/package.json`
   before committing if needed).
3. Resume Plan 2 at Task 2. Push plugin commits to `koenvangeert/openforge-plugins`, and doc/handoff
   updates to `koenvg/openforge`.
- Root `tsc --noEmit` fails locally (a local `ignoreDeprecations` artifact); CI passes.
  Typecheck per-package + rely on the harness LSP diagnostics.

## Gotchas (don't rediscover)

- **External Svelte plugins are version-locked to the host's Svelte.** A plugin's frontend bundle
  externalizes `svelte/internal/*` and, at runtime, resolves it (via the renderer import map) to the
  host's ONE shared Svelte instance (`plugin://host-runtime/svelte`). That internal API is private
  and changes between patch releases, so the plugin MUST **compile** against the EXACT Svelte version
  the host **ships**, or mounting a plugin component throws `effect_orphan` (host tree + plugin
  disagree on effect-context setup). vitest can NOT catch this — it compiles AND runs against the
  plugin's own Svelte, so it's always self-consistent. Keep `svelte` in the plugins-repo catalog
  (`pnpm-workspace.yaml`) an EXACT pin equal to `svelte` in `openforge/package.json` (currently
  **5.56.4**). This bit Plan 2 Task 7 (a `^` range floated to 5.56.5 vs a 5.56.4 host).
- **`import type` is invisible to vitest** (esbuild strips it) — only tsc/LSP catch a missing
  barrel export. After adding an SDK type, export it from BOTH the specific barrel
  (`frontend.ts`) AND the main `index.ts` barrel, then rebuild the SDK. This bit Plan 1 twice.
- After ANY SDK source change: `pnpm --filter @openforge-app/plugin-sdk build` (core + plugins
  consume `dist/`).
- The subagent-driven helper scripts (`sdd-workspace`/`task-brief`/`review-package`) **hang** in
  this env (a shell-hook interaction). Generate review diffs manually with `git diff -U10 BASE..HEAD`
  redirected to a file under `.superpowers/sdd/`.
- **Modal-over-modal stacking** (the plugin picker over the create-task dialog) is an untested
  risk — validate in Plan 2 Task 7's user smoke test.
- Snippets = plugin filesystem only (NOT `storage.global`, NOT any DB). The plugin keeps its OWN
  copy of the `/injectables` logic + `Injectable`/`Snippet` types, importing only the GENERIC SDK
  surface (`CommandInfo`, `injectionPoints`, `ui/*`, `defineFrontendPlugin`).

## Documents & ledgers

- Spec: `docs/superpowers/specs/2026-07-16-injectable-picker-plugin-migration-design.md`
- Plan 1 (DONE): `docs/superpowers/plans/2026-07-16-injection-point-extension-point.md`
- Plan 2 (ACTIVE): `docs/superpowers/plans/2026-07-17-injectables-plugin-package.md`
- Plan 3 (TODO): write after Plan 2. Scope: delete OpenForge `src/components/injectables/` +
  `src/lib/injectables/`, the SDK `/injectables` logic + injectable domain types, the
  `skills-viewer` builtin (from `builtin-plugins.json` + `builtinPluginModules.ts` +
  `builtin_plugins.rs`), the ⌘⇧I wiring/old triggers; add a FORWARD migration dropping
  `snippets`/`snippet_projects` (never delete old migrations → `DatabaseTooFarAhead`; fix
  relative-offset migration tests).
- Ledgers: `.superpowers/sdd/progress.md` (Plan 1), `.superpowers/sdd/progress-plan2.md` (Plan 2).

## Execution protocol

- Subagent-driven: one fresh implementer per task (model `sonnet`), a task reviewer after each
  (spec compliance + quality), fix-loop on Critical/Important, final whole-branch review on `opus`.
- Hand each implementer its task by pointing at the plan doc's specific `## Task N` section
  (not the whole plan). Plan 2 tasks run in `/Users/aviv.hadar/repos/openforge-plugins`.
- **After each task:** update the ledger AND this file's *Current Position*, so `/clear` is safe
  at any point.
- Commits: no Claude/Anthropic mention, no co-author line; commit in the repo the task touches
  (Plan 2 commits land in `openforge-plugins`). Commit/push only when the user asks.

## End-of-session protocol (do this before you stop)

When context gets high or you reach a natural checkpoint, BEFORE ending the session:
1. Update *Current Position* and *Plan 2 — Task Status* above to reflect completed tasks (with
   commit hashes). If you finish Plan 2, mark it DONE and note that Plan 3 must be authored next.
2. Commit the resume docs in the **openforge** repo (this is a documentation update; do it without
   asking):
   `git add docs/superpowers/INJECTABLES_HANDOFF.md docs/superpowers/plans/ && git commit -m "docs: update injectables migration handoff"`
   (Plan 2 code commits are in the separate `openforge-plugins` repo — record their hashes here;
   the user pushes that repo when ready.)
3. As your FINAL message, give the user the exact prompt to paste into the next session — reproduce
   this verbatim (it is stable because this file self-updates):

   > Read `docs/superpowers/INJECTABLES_HANDOFF.md` in full, then continue the Injectables
   > migration from its Current Position. Invoke `superpowers:subagent-driven-development`, resume
   > Plan 2 (or Plan 3 if Plan 2 is done) at the first TODO task, complete a few tasks, then run the
   > End-of-session protocol in the handoff and give me the prompt for the next session.
