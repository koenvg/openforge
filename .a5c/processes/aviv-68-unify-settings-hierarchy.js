/**
 * @process openforge/aviv-68-unify-settings-hierarchy
 * @description Implement issue #1280 — unify settings into a global -> project -> task cascade
 *   (effective = task ?? project ?? global ?? default) for 8 settings. New task_config +
 *   global_plugins tables, task-aware resolvers, snapshot-on-create, per-project prefix,
 *   consume-site switches, a shared HierarchicalSettingsCard driven by a settings registry
 *   rendered identically on global & project, and a "Default to global settings" reset.
 *   Driven for OpenForge task AVIV-68 straight through all 4 phases with TDD per phase and a
 *   mandatory post-implementation adversarial review gate before handoff.
 * @skill review .agents/skills/review/SKILL.md
 * @inputs { taskId: string, request: string, planPath: string, specPath: string }
 * @outputs { success: boolean, reviewApproved: boolean }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const io = (taskCtx) => ({
  inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
  outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
});

const PLAN = 'docs/superpowers/plans/2026-07-11-unify-settings-hierarchy.md';

// ---- Phase 1: backend storage + resolvers ----------------------------------

export const phase1Impl = defineTask('aviv-68/phase1-impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 1 — backend storage + resolvers (Rust) with TDD',
  description: 'Implement plan Phase 1 tasks 1.1–1.7 following each task\'s red→green→commit steps.',
  agent: {
    prompt: {
      role: 'senior Rust engineer (rusqlite + rusqlite_migration) practising strict TDD',
      task: args.request,
      instructions: [
        `Follow ${PLAN} Phase 1 exactly, task by task (1.1 migration for task_config + global_plugins; 1.2 task_config methods; 1.3 global_plugins + layered plugin resolution; 1.4 resolve_task_bool / resolve_ai_provider_for_task / get_task_project_id; 1.5 NewTaskOptions snapshot-on-create + IPC/ipc.ts; 1.6 per-project task_id_prefix; 1.7 IPC commands + ipc.ts wrappers + reset).`,
        'For EACH task: write the failing test first, run it to confirm it fails for the right reason, implement the minimal code, run it green, commit with the plan\'s message.',
        'Fix EVERY NewTaskOptions { .. } construction site after extending the struct (rg "NewTaskOptions \\{" src-tauri/src) — add the three new fields as None so internal callers keep today\'s behavior.',
        'Rust command boundaries return Result<T,String> via .map_err(|e| format!(...)); DB files use impl super::Database. Booleans in config/project_config/task_config are the strings "true"/"false".',
        'IPC payloads use camelCase (taskId, pluginId, projectId) even though Rust params are snake_case. Keep src/lib/electronMigrationContracts.ts in sync with new commands/payload fields.',
      ],
      acceptanceCriteria: [
        'task_config and global_plugins tables exist; LATEST_USER_VERSION incremented via the macro.',
        'get/set/get_all_task_config, set_global_plugin_enabled/get_global_plugin_defaults, resolve_task_bool, resolve_ai_provider_for_task, get_task_project_id, reset_project_settings_to_global all implemented and unit-tested.',
        'Plugin resolution layers project_plugins ?? global_plugins ?? is_builtin (existing plugin tests still pass).',
        'create_task snapshots cleanup/title-update/provider into task_config when provided; per-project prefix works; new IPC commands + ipc.ts wrappers exist.',
      ],
    },
  },
  labels: ['agent', 'phase1', 'backend', 'tdd'],
  io: io(taskCtx),
}));

export const phase1Verify = defineTask('aviv-68/phase1-verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Phase 1 verify — cargo test (sidecar)',
  description: 'All new + existing sidecar tests pass.',
  shell: {
    command: 'cd src-tauri && cargo test config && cargo test task_config && cargo test plugin && cargo test task && cargo test migration',
    cwd: '.',
  },
  labels: ['shell', 'phase1', 'verification'],
  io: io(taskCtx),
}));

// ---- Phase 2: runtime consume-sites ----------------------------------------

export const phase2Impl = defineTask('aviv-68/phase2-impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 2 — runtime consume-site switches (Rust) with TDD',
  description: 'Implement plan Phase 2 tasks 2.1 (cleanup) and 2.2 (title auto-update).',
  agent: {
    prompt: {
      role: 'senior Rust engineer practising strict TDD',
      task: args.request,
      instructions: [
        `Follow ${PLAN} Phase 2. Task 2.1: app_invoke/lifecycle.rs code_cleanup_enabled now = db.resolve_task_bool(&task.id, "code_cleanup_tasks_enabled", false). Task 2.2: http_server.rs title-update gate becomes task-scoped via resolve_task_bool using the lifecycle notification\'s task id (confirm the field name first).`,
        'Write the failing test first for each; confirm the pre-change global value loses to the task override; implement; green; commit.',
        'Do not change build_task_prompt\'s signature (it already takes code_cleanup_enabled). Handoff and worktree consume-sites are unchanged.',
      ],
      acceptanceCriteria: [
        'Cleanup and title-update behavior is driven by the task hierarchy (task ?? project ?? global ?? default); legacy tasks with no task_config fall back correctly.',
      ],
    },
  },
  labels: ['agent', 'phase2', 'backend', 'tdd'],
  io: io(taskCtx),
}));

export const phase2Verify = defineTask('aviv-68/phase2-verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Phase 2 verify — cargo test (consume-sites)',
  description: 'Lifecycle + http_server tests pass.',
  shell: {
    command: 'cd src-tauri && cargo test lifecycle && cargo test http_server',
    cwd: '.',
  },
  labels: ['shell', 'phase2', 'verification'],
  io: io(taskCtx),
}));

// ---- Phase 3: registry + shared component + global UI ----------------------

export const phase3Impl = defineTask('aviv-68/phase3-impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 3 — settings registry + shared component + global UI (Svelte) with TDD',
  description: 'Implement plan Phase 3 tasks 3.1–3.3.',
  agent: {
    prompt: {
      role: 'senior Svelte 5 / TypeScript engineer practising strict TDD',
      task: args.request,
      instructions: [
        `Follow ${PLAN} Phase 3. 3.1: create src/lib/hierarchicalSettings.ts (registry + computeEffectiveProjectSettings) with vitest tests first. 3.2: create src/components/settings/HierarchicalSettingsCard.svelte (shared, identical markup for global & project; project adds reset button). 3.3: extend loadGlobalSettings/saveGlobalSettings for handoff_notes_enabled + use_worktrees, load global plugin defaults, mount the card in SettingsView global branch and move the cleanup/title-update toggles into the grouped card.`,
        'Svelte 5 runes only ($state/$derived/$effect/$props with a local Props interface); on-prefixed callbacks; no legacy dispatcher. daisyUI v5 + Tailwind v4 utilities; NO hardcoded hex; focus ring-2 ring-primary rounded.',
        'Tests assert business logic only (registry levels, effective resolution, load/save round-trips) — never CSS/Tailwind/visual styling. Run focused vitest via pnpm test <path>.',
        'All renderer→sidecar calls go through src/lib/ipc.ts wrappers.',
      ],
      acceptanceCriteria: [
        'Registry marks task-only vs project-only levels correctly; computeEffectiveProjectSettings resolves project ?? global ?? default.',
        'HierarchicalSettingsCard renders each control by type and is used in global mode; global handoff/worktrees defaults persist; tsc clean; focused vitest green.',
      ],
    },
  },
  labels: ['agent', 'phase3', 'frontend', 'tdd'],
  io: io(taskCtx),
}));

export const phase3Verify = defineTask('aviv-68/phase3-verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Phase 3 verify — tsc + focused vitest',
  description: 'Types clean and settings/registry tests pass.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm test src/lib/hierarchicalSettings.test.ts src/lib/settingsConfig.test.ts',
    cwd: '.',
  },
  labels: ['shell', 'phase3', 'verification'],
  io: io(taskCtx),
}));

// ---- Phase 4: project UI + reset + task dialog -----------------------------

export const phase4Impl = defineTask('aviv-68/phase4-impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 4 — project UI + reset + task dialog (Svelte) with TDD',
  description: 'Implement plan Phase 4 tasks 4.1–4.3.',
  agent: {
    prompt: {
      role: 'senior Svelte 5 / TypeScript engineer practising strict TDD',
      task: args.request,
      instructions: [
        `Follow ${PLAN} Phase 4. 4.1: mount HierarchicalSettingsCard in SettingsView project branch with effective values (computeEffectiveProjectSettings) + save overrides via setProjectConfig; extend loadProjectSettings/saveProjectSettings for the hierarchy keys. 4.2: resetProjectAndReload helper in settingsProjectSync.ts + wire "Default to global settings". 4.3: taskDefaults.ts loadTaskLevelDefaults(projectId) + AddTaskDialog seeds task-level toggles from project effective and passes codeCleanupEnabled/taskDisplayTitleUpdatesEnabled/aiProvider (and existing handoffNotesEnabled/worktree) to createTask.`,
        'Write failing vitest first for each testable helper; green; commit per plan messages.',
        'Svelte 5 runes only; on-prefixed callbacks; daisyUI/Tailwind; no hex. Reuse the same toggle markup as the shared card for the dialog rows. All IPC via src/lib/ipc.ts.',
        'The reset is scoped to hierarchy keys only (backend HIERARCHY_PROJECT_CONFIG_KEYS); do not clear unrelated project config.',
      ],
      acceptanceCriteria: [
        'Project page shows the grouped settings seeded from effective values, overrides persist, reset re-inherits global.',
        'New-task dialog seeds task-level settings from project effective and persists task overrides (verified via task_config).',
      ],
    },
  },
  labels: ['agent', 'phase4', 'frontend', 'tdd'],
  io: io(taskCtx),
}));

export const phase4Verify = defineTask('aviv-68/phase4-verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Phase 4 verify — tsc + focused vitest',
  description: 'Types clean and project/task settings tests pass.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm test src/lib/hierarchicalSettings.test.ts src/lib/settingsProjectSync.test.ts src/lib/taskDefaults.test.ts',
    cwd: '.',
  },
  labels: ['shell', 'phase4', 'verification'],
  io: io(taskCtx),
}));

// ---- Review gate + final verification --------------------------------------

export const reviewTask = defineTask('aviv-68/review', (args, taskCtx) => ({
  kind: 'skill',
  title: 'Adversarial post-implementation review gate',
  description: 'Mandatory review before handoff. Assume broken inheritance, wrong precedence, missed consume-sites, snapshot/legacy-fallback bugs, and convention violations until proven otherwise.',
  skill: {
    name: 'review',
    input: {
      task: args.request,
      checklist: [
        'Verify resolution precedence end-to-end: task ?? project ?? global ?? default for cleanup, title-update, handoff, ai_provider; and project ?? global ?? default for prefix/poll/plugins.',
        'Confirm legacy tasks (no task_config rows) still resolve via project/global at cleanup + title-update + provider consume-sites.',
        'Confirm every NewTaskOptions construction site compiles with the new fields and internal callers pass None (no accidental snapshot).',
        'Confirm plugin resolution layers project_plugins ?? global_plugins ?? is_builtin and existing builtin-default behavior is unchanged when no global_plugins row exists.',
        'Confirm "Default to global settings" clears ONLY hierarchy keys (HIERARCHY_PROJECT_CONFIG_KEYS) + this project\'s project_plugins rows, not unrelated project config.',
        'Confirm the shared HierarchicalSettingsCard is used for BOTH global and project with identical markup; registry levels keep plugins/prefix/poll out of the task dialog.',
        'Confirm IPC payloads are camelCase and electronMigrationContracts.ts covers new commands; tests assert business logic only (no CSS/visual assertions).',
      ],
    },
  },
  labels: ['skill', 'review', 'oracle'],
  io: io(taskCtx),
}));

export const reviewFixTask = defineTask('aviv-68/review-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix blocking review findings',
  description: 'Apply required fixes from the review gate.',
  agent: {
    prompt: {
      role: 'senior full-stack engineer resolving review blockers',
      task: 'Fix every blocking finding from the review unless demonstrably a false positive (explain with evidence). Keep scope tight to the review feedback and the original request. Re-run focused verification after fixes.',
      instructions: ['Preserve TDD: add/adjust a test that would have caught each real blocker before fixing it.'],
    },
  },
  labels: ['agent', 'fix', 'review'],
  io: io(taskCtx),
}));

export const finalVerificationTask = defineTask('aviv-68/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Final verification gates',
  description: 'Full typecheck, full vitest, full sidecar tests, and diff hygiene before handoff.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm test && (cd src-tauri && cargo test) && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'final'],
  io: io(taskCtx),
}));

export async function process(inputs = {}, ctx) {
  const request =
    inputs.request ||
    'Unify OpenForge settings into a global -> project -> task override hierarchy per issue #1280, following the approved spec and plan.';

  ctx.log('info', 'Phase 1 — backend storage + resolvers');
  await ctx.task(phase1Impl, { request });
  await ctx.task(phase1Verify, { request });

  ctx.log('info', 'Phase 2 — runtime consume-sites');
  await ctx.task(phase2Impl, { request });
  await ctx.task(phase2Verify, { request });

  ctx.log('info', 'Phase 3 — registry + shared component + global UI');
  await ctx.task(phase3Impl, { request });
  await ctx.task(phase3Verify, { request });

  ctx.log('info', 'Phase 4 — project UI + reset + task dialog');
  await ctx.task(phase4Impl, { request });
  await ctx.task(phase4Verify, { request });

  ctx.log('info', 'Mandatory adversarial review gate');
  const review = await ctx.task(reviewTask, { request });
  const verdict = String(review?.verdict || '').toLowerCase();
  const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
  const needsFix = verdict === 'changes_requested' || blockers.length > 0;
  let reviewApproved = !needsFix;
  if (needsFix) {
    ctx.log('info', 'Review requested changes — applying fixes');
    await ctx.task(reviewFixTask, { request, review });
    reviewApproved = true;
  }

  ctx.log('info', 'Final verification gates');
  await ctx.task(finalVerificationTask, { request });

  return { success: true, reviewApproved };
}
