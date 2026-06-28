/**
 * @process openforge/roadmap-ui-parity-fixes
 * @description Bring the Roadmap plugin closer to the standalone github-roadmap UI: masonry packing, label recoloring, and GitHub-adjacent rail order.
 * @process specializations/desktop-development/desktop-ui-implementation
 * @process specializations/desktop-development/desktop-ui-testing
 * @inputs { }
 * @outputs { success: boolean, tdd: object, implementation: object, verification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const tddGateTask = defineTask('roadmap-ui-tdd-gate', () => ({
  kind: 'shell',
  title: 'Run focused Roadmap tests after adding failing expectations',
  description: 'Execute the focused test commands that cover rail ordering, label color client/proxy plumbing, and Rust command mapping/validation.',
  shell: {
    command: [
      'pnpm --filter @openforge/plugin-roadmap exec vitest run src/index.test.ts src/lib/labelColors.test.ts',
      'cd src-tauri && cargo test roadmap_label_color_field && cargo test roadmap_qualified_commands_map_to_app_invoke_commands'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'roadmap', 'verification']
}));

export const implementationAuditTask = defineTask('roadmap-ui-implementation-audit', () => ({
  kind: 'shell',
  title: 'Audit Roadmap UI parity implementation diff',
  description: 'Inspect the changed files and diff stats after implementation.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      'git diff --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'roadmap']
}));

export const verificationTask = defineTask('roadmap-ui-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Roadmap UI parity fixes',
  description: 'Run focused frontend and Rust verification for the Roadmap UI/API changes.',
  shell: {
    command: [
      'pnpm --filter @openforge/plugin-roadmap exec vitest run src/index.test.ts src/lib/labelColors.test.ts',
      'pnpm --filter @openforge/plugin-roadmap build',
      'cd src-tauri && cargo test roadmap_label_color_field && cargo test roadmap_qualified_commands_map_to_app_invoke_commands'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'roadmap']
}));

export async function process(_inputs = {}, ctx) {
  const tdd = await ctx.task(tddGateTask, {});
  const implementation = await ctx.task(implementationAuditTask, {});
  const verification = await ctx.task(verificationTask, {});

  return {
    success: true,
    tdd,
    implementation,
    verification,
    metadata: {
      processId: 'openforge/roadmap-ui-parity-fixes',
      timestamp: ctx.now()
    }
  };
}
