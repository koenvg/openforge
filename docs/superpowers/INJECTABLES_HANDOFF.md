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
- **Plan 2: IN PROGRESS.** Task 1 (scaffold) **DONE** — openforge-plugins commit `4f95539`;
  `plugins/injectables/` installs, tests (1), and builds; SDK link + `requires:
  ['injectionPoints']` confirmed. **NEXT: Task 2** (port injectable domain + `/injectables`
  logic, plugin-local).

## Plan 2 — Task Status (authoritative)

- Task 0: **DONE** — env resolved (worktree SDK link) + `injectionPoints` capability added to SDK schema (openforge commit `a16a12dd`).
- Task 1: **DONE on retired machine, NOT pushed** (no write access to the plugins remote). On the primary machine, **re-run Task 1** from the plan (deterministic; uses the sibling SDK link) before Task 2 — see *Cross-machine resume*.
- Task 2: **TODO** — port injectable domain types + `/injectables` logic into `src/lib/` (plugin-local; import only generic `CommandInfo` from SDK).
- Task 3: **TODO** — backend: skill fs methods + filesystem snippet store (`~/.openforge/injectables/snippets.json`).
- Task 4: **TODO** — port the Injectables rail view (⌘L).
- Task 5: **TODO** — port the injectable picker dialog (import-remap per the plan's table).
- Task 6: **TODO** — register injection-point components at the 3 locations.
- Task 7: **TODO** — full verify + user install + smoke test (incl. modal-stacking check).
- **Plan 3:** not written yet — author it after Plan 2 is verified.

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

Everything needed to resume is pushed in the **openforge** repo — branch
`aviv/openforge/injectable-picker-design` on `git@github.com:koenvg/openforge.git` (Plan 1, the
SDK capability, the spec + plan docs + this handoff). The **plugins scaffold was NOT pushed**:
`Avivhdr` lacks write access to `koenvangeert/openforge-plugins` (403). Nothing is lost — Plan 2
Task 1 (scaffold) is deterministic from this committed plan, so the primary machine just recreates
it. Machine setup:

1. In your `openforge` checkout: `git fetch && git checkout aviv/openforge/injectable-picker-design`,
   `pnpm install`, `pnpm --filter @openforge-app/plugin-sdk build`.
2. In the sibling `openforge-plugins` checkout: **re-run Plan 2 Task 1** (scaffold) from the plan —
   it writes `plugins/injectables/` with the sibling link `../../../openforge/packages/plugin-sdk`,
   then `pnpm install`. (Ledger will then show Task 1 done; continue at Task 2.)
3. **To push plugin work in future:** you can't push to `koenvangeert/openforge-plugins`. Fork it to
   your account and add your fork as a remote (e.g. `git remote add mine <your-fork>`), then push the
   plugin branch there. Not required to continue locally, but needed for the next cross-machine hop.
- Root `tsc --noEmit` fails locally (a local `ignoreDeprecations` artifact); CI passes.
  Typecheck per-package + rely on the harness LSP diagnostics.

## Gotchas (don't rediscover)

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
