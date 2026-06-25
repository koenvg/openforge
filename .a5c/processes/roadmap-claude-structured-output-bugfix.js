/**
 * @process openforge/roadmap-claude-structured-output-bugfix
 * @description Fix Roadmap +Create Refine parsing for Claude Code structured JSON output wrappers.
 * @skill rust .agents/skills/rust/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const auditTask = defineTask('roadmap-claude-structured-output/audit', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Audit Roadmap Claude refine parser',
  description: 'Inspect the Roadmap AI parser, current git state, and refine transport changes before edits.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      "sed -n '1,380p' src-tauri/src/roadmap_ai.rs",
      "sed -n '1,130p' src-tauri/src/plugin_host/rpc_transport.rs",
    ].join(' && '),
    cwd: '.',
  },
  labels: ['shell', 'audit', 'roadmap', 'claude', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const redTestTask = defineTask('roadmap-claude-structured-output/red-test', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run focused red parser test',
  description: 'Run the focused Rust parser test that should fail before structured_output is handled.',
  shell: {
    command: 'cargo test roadmap_ai_parses_claude_structured_output_before_result_text',
    cwd: 'src-tauri',
  },
  labels: ['shell', 'tdd', 'red', 'roadmap', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

const focusedVerificationTask = defineTask(
  'roadmap-claude-structured-output/focused-verification',
  (_args, taskCtx) => ({
    kind: 'shell',
    title: 'Run focused parser verification',
    description: 'Run focused Rust parser tests and Roadmap plugin refine tests after the parser fix.',
    shell: {
      command:
        'cargo test roadmap_ai && cd .. && pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/index.test.ts',
      cwd: 'src-tauri',
    },
    labels: ['shell', 'verification', 'roadmap', 'claude', 'rust'],
    io: {
      inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
      outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
    },
  }),
);

const finalVerificationTask = defineTask('roadmap-claude-structured-output/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run final parser bugfix verification',
  description: 'Run typecheck, focused Rust/plugin tests, and diff hygiene for the Claude parser fix.',
  shell: {
    command:
      'pnpm exec tsc --noEmit && pnpm --filter @openforge/plugin-roadmap exec vitest run src/components/CreateDialog.test.ts src/index.test.ts && (cd src-tauri && cargo test roadmap_ai) && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'roadmap', 'claude', 'rust'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export async function process(_inputs, ctx) {
  ctx.log('info', 'Audit the Claude Code Roadmap refine parser shape');
  await ctx.task(auditTask, {});

  ctx.log('info', 'Require the focused structured_output parser test before implementation');
  await ctx.task(redTestTask, {});

  ctx.log('info', 'Verify the focused parser fix');
  await ctx.task(focusedVerificationTask, {});

  ctx.log('info', 'Run final verification gates');
  await ctx.task(finalVerificationTask, {});

  return {
    success: true,
    summary: 'Roadmap Claude structured_output parser bugfix verified',
  };
}
