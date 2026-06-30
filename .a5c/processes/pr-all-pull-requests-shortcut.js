/**
 * @process openforge/pr-all-pull-requests-shortcut
 * @description Add a logical keyboard shortcut (Cmd+Shift+G) to the "All Pull Requests" global view (pr_review_global) contributed by the github-sync plugin, mirroring the project-scoped "Pull Requests" Cmd+G shortcut. TDD: assert the shortcut in the plugin registration test first, then add the single shortcut field to the view registration.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process tdd-quality-convergence
 * @inputs { }
 * @outputs { success: boolean, audit: object, focusedVerification: object, finalVerification: object, review: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('pr-all-pull-requests-shortcut-audit', () => ({
  kind: 'shell',
  title: 'Audit All Pull Requests shortcut diff',
  description: 'Inspect changed files and diff stats for the pr_review_global shortcut change.',
  shell: {
    command: 'git status --short --branch && git diff --stat && git diff --name-only',
    cwd: '.'
  },
  labels: ['shell', 'audit', 'plugin', 'github-sync', 'shortcut']
}));

export const focusedVerificationTask = defineTask('pr-all-pull-requests-shortcut-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused github-sync plugin registration test',
  description: 'Execute the plugin registration test that asserts pr_review_global registers with shortcut Cmd+Shift+G.',
  shell: {
    command: 'pnpm exec vitest run plugins/github-sync/src/index.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'github-sync', 'shortcut']
}));

export const finalVerificationTask = defineTask('pr-all-pull-requests-shortcut-final-verification', () => ({
  kind: 'shell',
  title: 'Verify All Pull Requests shortcut implementation',
  description: 'Run the plugin registration test, the shortcut wiring tests, and workspace type checking.',
  shell: {
    command: [
      'pnpm exec vitest run plugins/github-sync/src/index.test.ts src/lib/plugin/contributionResolver.test.ts src/lib/iconRailNav.test.ts',
      'pnpm exec tsc --noEmit',
      'git diff --check'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'github-sync', 'shortcut']
}));

export const reviewTask = defineTask('pr-all-pull-requests-shortcut-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Post-implementation code review of the shortcut change',
  description: 'Adversarial review of the completed diff after objective verification and before final handoff.',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'adversarial senior OpenForge reviewer',
      task: 'Review the completed All Pull Requests shortcut change for correctness, scope, convention fit, and collisions.',
      context: args,
      instructions: [
        'Inspect the git diff for the change to plugins/github-sync/src/index.ts and the github-sync index test.',
        'Confirm the chosen shortcut Cmd+Shift+G normalizes to ⌘⇧g and does not collide with Cmd+G (pr_review) or Cmd+Shift+R (refresh).',
        'Confirm the host auto-registers a keybinding and surfaces the sidebar hint for any plugin view that declares a shortcut, so no extra host plumbing is required.',
        'Confirm the change is minimal and follows OpenForge plugin conventions; flag any over-reach, missing test coverage, or broken verification gates.',
        'Return changes_requested only for real blocking issues.'
      ],
      outputFormat: 'JSON with verdict (approve|changes_requested), summary, blockers, findings'
    },
    outputSchema: {
      type: 'object',
      required: ['verdict', 'summary'],
      properties: {
        verdict: { type: 'string' },
        summary: { type: 'string' },
        blockers: { type: 'array', items: { type: 'string' } },
        findings: { type: 'array' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'review', 'github-sync', 'shortcut']
}));

export async function process(_inputs = {}, ctx) {
  const audit = await ctx.task(auditTask, {});
  const focusedVerification = await ctx.task(focusedVerificationTask, {});
  const finalVerification = await ctx.task(finalVerificationTask, {});
  const review = await ctx.task(reviewTask, {
    request: 'Add a logical keyboard shortcut (Cmd+Shift+G) for the All Pull Requests section.',
    audit,
    focusedVerification,
    finalVerification
  });

  return {
    success: true,
    audit,
    focusedVerification,
    finalVerification,
    review,
    metadata: {
      processId: 'openforge/pr-all-pull-requests-shortcut',
      timestamp: ctx.now()
    }
  };
}
