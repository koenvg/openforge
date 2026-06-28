/**
 * @process openforge/done-lane-chip
 * @description Add a fourth "Done" lane chip (⌘4) to the focus board so completed tasks are visible and recoverable, with a "Reopen" action that returns a task to 'doing' (never to backlog) and clears any stale Low-Fire membership.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process tdd-quality-convergence
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @inputs { }
 * @outputs { success: boolean, audit: object, focusedVerification: object, finalVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('done-lane-chip-audit', () => ({
  kind: 'shell',
  title: 'Audit Done lane chip diff',
  description: 'Inspect the changed files and diff stats for the Done lane chip + Reopen implementation.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      'git diff --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'board', 'focus-board']
}));

export const focusedVerificationTask = defineTask('done-lane-chip-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Done lane chip tests',
  description: 'Execute focused tests covering the boardFilters done branch/counts, the reopenTask helper, and the TaskContextMenu done-state (Reopen only, no backlog path).',
  shell: {
    command: 'pnpm exec vitest run src/lib/boardFilters.test.ts src/lib/reopenTask.test.ts src/components/shared/tasks/TaskContextMenu.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'focus-board']
}));

export const finalVerificationTask = defineTask('done-lane-chip-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Done lane chip implementation',
  description: 'Run the full renderer test suite and workspace type checking for the Done lane chip changes.',
  shell: {
    command: [
      'pnpm exec vitest run src/lib/boardFilters.test.ts src/lib/reopenTask.test.ts src/components/shared/tasks/TaskContextMenu.test.ts src/components/focus-board',
      'pnpm exec tsc --noEmit',
      'git diff --check'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'focus-board']
}));

export async function process(_inputs = {}, ctx) {
  const audit = await ctx.task(auditTask, {});
  const focusedVerification = await ctx.task(focusedVerificationTask, {});
  const finalVerification = await ctx.task(finalVerificationTask, {});

  return {
    success: true,
    audit,
    focusedVerification,
    finalVerification,
    metadata: {
      processId: 'openforge/done-lane-chip',
      timestamp: ctx.now()
    }
  };
}
