/**
 * @process openforge/injectable-picker-mvp
 * @description Iteration 1 of the Injectable Picker — a Claude-scoped, summonable picker that lists skills + commands, groups by Origin/Trigger with search + collapsible groups, shows a skill's full SKILL.md in a closable master-detail reading pane, and inserts /name into the prompt or live PTY (no auto-submit). Backend enriches CommandInfo with origin/triggerMode/userInvocable/sourceDir/sourcePath and parses disable-model-invocation. No snippets, categories, or audit (later iterations).
 * @process specializations/web-development/svelte-sveltekit-development
 * @process specializations/sdk-platform-development/plugin-extension-architecture
 * @process specializations/rust/rust-development
 * @process tdd-quality-convergence
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @skill rust specializations/rust/skills/rust/SKILL.md
 * @inputs { }
 * @outputs { success: boolean, audit: object, rustVerification: object, focusedVerification: object, review: object, finalVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const auditTask = defineTask('injectable-picker-audit', () => ({
  kind: 'shell',
  title: 'Audit Injectable Picker diff',
  description: 'Inspect changed files and diff stats for the iteration-1 Injectable Picker implementation.',
  shell: {
    command: [
      'git status --short --branch',
      'git diff --stat',
      'git diff --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'injectable-picker']
}));

export const rustVerificationTask = defineTask('injectable-picker-rust-tests', () => ({
  kind: 'shell',
  title: 'Run focused Rust catalog-enrichment tests',
  description: 'Execute focused Rust tests for SKILL.md trigger-flag parsing (command_discovery) and CommandInfo origin/trigger/source enrichment (claude_code provider).',
  shell: {
    command: 'cargo test command_discovery && cargo test claude_code',
    cwd: 'src-tauri'
  },
  labels: ['shell', 'tdd', 'verification', 'rust', 'injectable-picker']
}));

export const focusedVerificationTask = defineTask('injectable-picker-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Injectable Picker frontend tests',
  description: 'Execute focused Vitest suites for buildInjectables, facets, the catalog loader, the picker component, and integration wiring.',
  shell: {
    command: 'pnpm exec vitest run src/lib/injectables src/components/injectables',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'frontend', 'injectable-picker']
}));

export const reviewTask = defineTask('injectable-picker-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Review Injectable Picker iteration-1 diff',
  description: 'Adversarial OpenForge-specific review of the working-tree diff before handoff.',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior OpenForge reviewer',
      task: 'Review the uncommitted working-tree diff for the iteration-1 Injectable Picker and report only actionable correctness, regression, security, maintainability, or missing-test findings.',
      context: args,
      instructions: [
        'Base the review on `git diff` (and `git status`) in the repo root plus the relevant existing code.',
        'Enforce OpenForge boundaries: Svelte 5 runes only; all frontend→backend calls via typed src/lib/ipc.ts wrappers; IPC payloads camelCase even though Rust params are snake_case; Rust command boundaries return Result<T, String>; no raw Electron/preload/sidecar calls from Svelte.',
        'Check the effect-cleanup rule: no $effect return-cleanup keyed by a prop value; explicit previous-value comparison + onDestroy instead.',
        'Verify Injectable ids are unique (origin+kind+name) so keyed {#each} has no duplicate keys; verify non-Claude (.pi/.codex/.opencode) skills and user-invocable:false items are dropped.',
        'Confirm tests cover business logic only — no assertions on CSS classes / Tailwind utilities / visual styling.',
        'Confirm the picker inserts into the prompt/PTY without auto-submit, and that lazy source reading handles the null-source (built-in) case.',
        'Verify suspected issues against the actual diff before reporting; do not report cosmetic styling preferences.',
        'Return JSON with findings, openQuestions, skippedVerification, residualRisk, and summary.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['findings', 'summary'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['severity', 'file', 'message'],
            properties: {
              severity: { type: 'string' },
              file: { type: 'string' },
              line: { type: 'number' },
              message: { type: 'string' },
              evidence: { type: 'string' },
              recommendation: { type: 'string' }
            }
          }
        },
        openQuestions: { type: 'array', items: { type: 'string' } },
        skippedVerification: { type: 'array', items: { type: 'string' } },
        residualRisk: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'review', 'adversarial', 'injectable-picker']
}));

export const finalVerificationTask = defineTask('injectable-picker-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Injectable Picker implementation',
  description: 'Run focused frontend tests, workspace type checking, focused Rust tests, and diff hygiene checks.',
  shell: {
    command: [
      'pnpm exec vitest run src/lib/injectables src/components/injectables',
      'pnpm exec tsc --noEmit',
      '(cd src-tauri && cargo test command_discovery && cargo test claude_code)',
      'git diff --check'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'verification', 'injectable-picker']
}));

export async function process(_inputs = {}, ctx) {
  const audit = await ctx.task(auditTask, {});
  const rustVerification = await ctx.task(rustVerificationTask, {});
  const focusedVerification = await ctx.task(focusedVerificationTask, {});
  const review = await ctx.task(reviewTask, { audit });
  const finalVerification = await ctx.task(finalVerificationTask, {});

  return {
    success: Array.isArray(review.findings) ? review.findings.length === 0 : false,
    audit,
    rustVerification,
    focusedVerification,
    review,
    finalVerification,
    metadata: {
      processId: 'openforge/injectable-picker-mvp',
      timestamp: ctx.now()
    }
  };
}
