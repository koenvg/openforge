/**
 * @process openforge/roadmap-refine-timeout-bugfix
 * @description Fix Roadmap +Create Refine timing out at the plugin backend transport boundary.
 * @skill openforge-app-operator .agents/skills/openforge-app-operator/SKILL.md
 * @skill rust .agents/skills/rust/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const auditTask = defineTask('roadmap-refine-timeout/audit', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Audit Roadmap refine timeout path',
  description: 'Inspect the changed files, plugin transport timeout, and Roadmap refine wiring before edits.',
  shell: {
    command: [
      'git status --short --branch',
      "git diff --stat",
      "sed -n '1,130p' src-tauri/src/plugin_host/rpc_transport.rs",
      "sed -n '1,40p' src-tauri/src/plugin_rpc.rs",
      "sed -n '70,90p' plugins/roadmap/src/backend.ts",
    ].join(' && '),
    cwd: '.',
  },
  labels: ['shell', 'audit', 'roadmap', 'plugin-host', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const redTestTask = defineTask('roadmap-refine-timeout/red-test', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run focused red timeout test',
  description: 'Run the focused Rust test that should fail before the timeout fix.',
  shell: {
    command: 'cargo test plugin_host::rpc_transport::tests::roadmap_refine_ticket_uses_long_backend_timeout',
    cwd: 'src-tauri',
  },
  labels: ['shell', 'tdd', 'red', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const focusedVerificationTask = defineTask('roadmap-refine-timeout/focused-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run focused timeout verification',
  description: 'Run focused Rust and Roadmap plugin tests after the timeout fix.',
  shell: {
    command: 'cargo test plugin_host::rpc_transport::tests::roadmap_refine_ticket_uses_long_backend_timeout && cd .. && pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/index.test.ts',
    cwd: 'src-tauri',
  },
  labels: ['shell', 'verification', 'roadmap', 'plugin-host', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const finalVerificationTask = defineTask('roadmap-refine-timeout/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run final timeout bugfix verification',
  description: 'Run typecheck, focused Rust/plugin tests, and diff hygiene for the timeout fix.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/index.test.ts && (cd src-tauri && cargo test plugin_host::rpc_transport::tests::roadmap_refine_ticket_uses_long_backend_timeout) && (cd src-tauri && cargo test roadmap_ai) && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'roadmap', 'plugin-host', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export async function process(_inputs, ctx) {
  ctx.log('info', 'Audit the plugin backend timeout path');
  await ctx.task(auditTask, {});

  ctx.log('info', 'Require the focused timeout test to be introduced and fail before implementation');
  await ctx.task(redTestTask, {});

  ctx.log('info', 'Verify the focused fix');
  await ctx.task(focusedVerificationTask, {});

  ctx.log('info', 'Run final verification gates');
  await ctx.task(finalVerificationTask, {});

  return {
    success: true,
    summary: 'Roadmap refine plugin backend timeout bugfix verified',
  };
}
