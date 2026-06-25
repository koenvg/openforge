/**
 * @process openforge/roadmap-column-create-affordance
 * @description Implement github-roadmap-style column + create controls with label preselection in the Roadmap plugin.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process specializations/sdk-platform-development/plugin-extension-architecture
 * @process tdd-quality-convergence
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @inputs { }
 * @outputs { success: boolean, audit: object, focusedVerification: object, finalVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('roadmap-column-create-audit', () => ({
  kind: 'shell',
  title: 'Audit Roadmap column create diff',
  description: 'Inspect changed files and diff stats for the Roadmap column + create implementation.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      'git diff --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'roadmap', 'plugin']
}));

export const focusedVerificationTask = defineTask('roadmap-column-create-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Roadmap column create tests',
  description: 'Execute focused tests for CreateDialog initial labels and Board column add behavior.',
  shell: {
    command: 'pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/components/Board.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'roadmap', 'plugin']
}));

export const finalVerificationTask = defineTask('roadmap-column-create-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Roadmap column create implementation',
  description: 'Run plugin tests/build, workspace type checking, and diff hygiene checks.',
  shell: {
    command: [
      'pnpm --filter @openforge/plugin-roadmap test',
      'pnpm --filter @openforge/plugin-roadmap build',
      'pnpm exec tsc --noEmit',
      'git diff --check'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'roadmap', 'plugin']
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
      processId: 'openforge/roadmap-column-create-affordance',
      timestamp: ctx.now()
    }
  };
}
