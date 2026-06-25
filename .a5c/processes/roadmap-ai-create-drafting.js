/**
 * @process openforge/roadmap-ai-create-drafting
 * @description Implement Roadmap Create AI drafting using the configured OpenForge provider and focused TDD verification.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process specializations/sdk-platform-development/plugin-extension-architecture
 * @process tdd-quality-convergence
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @skill rust specializations/rust/skills/rust/SKILL.md
 * @inputs { }
 * @outputs { success: boolean, audit: object, focusedVerification: object, rustVerification: object, finalVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('roadmap-ai-create-audit', () => ({
  kind: 'shell',
  title: 'Audit Roadmap AI create diff',
  description: 'Inspect changed files and diff stats for the Roadmap AI create drafting implementation.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      'git diff --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'roadmap', 'plugin', 'rust']
}));

export const focusedVerificationTask = defineTask('roadmap-ai-create-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Roadmap AI create tests',
  description: 'Execute focused plugin tests for CreateDialog AI drafting and backend/client wiring.',
  shell: {
    command: 'pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/components/Board.test.ts src/index.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'roadmap', 'plugin']
}));

export const rustVerificationTask = defineTask('roadmap-ai-create-rust-tests', () => ({
  kind: 'shell',
  title: 'Run focused Rust Roadmap AI create tests',
  description: 'Execute focused Rust tests for Roadmap AI draft parsing and command behavior.',
  shell: {
    command: 'cargo test roadmap_ai',
    cwd: 'src-tauri'
  },
  labels: ['shell', 'tdd', 'verification', 'roadmap', 'rust']
}));

export const finalVerificationTask = defineTask('roadmap-ai-create-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Roadmap AI create implementation',
  description: 'Run plugin tests/build, workspace type checking, focused Rust tests, and diff hygiene checks.',
  shell: {
    command: [
      'pnpm --filter @openforge/plugin-roadmap test',
      'pnpm --filter @openforge/plugin-roadmap build',
      'pnpm exec tsc --noEmit',
      '(cd src-tauri && cargo test roadmap_ai)',
      'git diff --check'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'roadmap', 'plugin', 'rust']
}));

export async function process(_inputs = {}, ctx) {
  const audit = await ctx.task(auditTask, {});
  const focusedVerification = await ctx.task(focusedVerificationTask, {});
  const rustVerification = await ctx.task(rustVerificationTask, {});
  const finalVerification = await ctx.task(finalVerificationTask, {});

  return {
    success: true,
    audit,
    focusedVerification,
    rustVerification,
    finalVerification,
    metadata: {
      processId: 'openforge/roadmap-ai-create-drafting',
      timestamp: ctx.now()
    }
  };
}
