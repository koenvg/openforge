/**
 * @process openforge/roadmap-card-context-actions
 * @description Add Roadmap card context actions that create/start OpenForge tasks from GitHub issues using project Actions config.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process specializations/sdk-platform-development/plugin-extension-architecture
 * @process tdd-quality-convergence
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @inputs { }
 * @outputs { success: boolean, audit: object, focusedVerification: object, finalVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('roadmap-card-context-actions-audit', () => ({
  kind: 'shell',
  title: 'Audit Roadmap context action diff',
  description: 'Inspect the changed files and diff stats for the Roadmap card action implementation.',
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

export const focusedVerificationTask = defineTask('roadmap-card-context-actions-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Roadmap context action tests',
  description: 'Execute focused tests covering action parsing, issue prompt construction, plugin metadata, and runtime launch behavior.',
  shell: {
    command: 'pnpm --filter @openforge/plugin-roadmap exec vitest run src/lib/roadmapActions.test.ts src/index.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'roadmap', 'plugin']
}));

export const finalVerificationTask = defineTask('roadmap-card-context-actions-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Roadmap context action implementation',
  description: 'Run plugin tests/build and workspace type checking for the Roadmap card context action changes.',
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
      processId: 'openforge/roadmap-card-context-actions',
      timestamp: ctx.now()
    }
  };
}
