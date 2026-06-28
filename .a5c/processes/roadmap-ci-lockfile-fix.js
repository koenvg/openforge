/**
 * @process openforge/roadmap-ci-lockfile-fix
 * @description Fix PR #1043 Frontend Tests failing at pnpm frozen lockfile install.
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const auditTask = defineTask('roadmap-ci-lockfile/audit', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Audit CI lockfile failure scope',
  description: 'Inspect branch state, PR checks, package manifests, and lockfile references before editing.',
  shell: {
    command: [
      'git status --short --branch',
      'gh pr checks 1043 --json name,state,bucket,link,workflow',
      "grep -R \"@lucide/svelte\" -n package.json plugins pnpm-lock.yaml || true",
      "grep -R \"lucide\" -n package.json plugins/*/package.json || true",
    ].join(' && '),
    cwd: '.',
  },
  labels: ['shell', 'audit', 'ci', 'pnpm', 'roadmap'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const redInstallTask = defineTask('roadmap-ci-lockfile/red-install', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Reproduce frozen lockfile failure',
  description: 'Run the same frozen pnpm install mode used by CI before fixing the lockfile.',
  shell: {
    command: 'pnpm install --frozen-lockfile',
    cwd: '.',
  },
  labels: ['shell', 'tdd', 'red', 'ci', 'pnpm'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const focusedVerificationTask = defineTask('roadmap-ci-lockfile/focused-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run focused lockfile verification',
  description: 'Verify frozen install and focused Roadmap frontend checks after the lockfile fix.',
  shell: {
    command:
      'pnpm install --frozen-lockfile && pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/index.test.ts && pnpm exec tsc --noEmit',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'ci', 'pnpm', 'roadmap'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const finalVerificationTask = defineTask('roadmap-ci-lockfile/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run final CI lockfile verification',
  description: 'Run CI-equivalent frontend gates and diff hygiene before commit/push.',
  shell: {
    command:
      'pnpm install --frozen-lockfile && pnpm build:plugins && pnpm exec tsc --noEmit && pnpm test && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'ci', 'pnpm', 'frontend'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export async function process(_inputs, ctx) {
  ctx.log('info', 'Audit the PR CI lockfile failure');
  await ctx.task(auditTask, {});

  ctx.log('info', 'Reproduce the frozen lockfile install failure');
  await ctx.task(redInstallTask, {});

  ctx.log('info', 'Verify the focused lockfile fix');
  await ctx.task(focusedVerificationTask, {});

  ctx.log('info', 'Run final CI-equivalent frontend gates');
  await ctx.task(finalVerificationTask, {});

  return {
    success: true,
    summary: 'PR #1043 frontend CI lockfile failure fixed and verified',
  };
}
