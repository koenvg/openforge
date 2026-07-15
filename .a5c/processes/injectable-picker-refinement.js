/**
 * @process openforge/injectable-picker-refinement
 * @description Iteration 1.1 UI-refinement pass on the Injectable Picker. Adds: keyboard up/down navigation across visible items; detail pane closed by default with click-to-open / click-selected-again-or-X-to-close (Preview button removed); draggable list/detail divider via the existing ResizablePanel; edit + delete (with confirmation) for personal-origin skills backed by a NEW ~/.claude-scoped file write/delete IPC command; raw<->markdown content toggle (default markdown, picker-scoped, resets on close); swapped Group-by/Filter-by order; per-item character count; and a visual polish pass (origin colors/icons) per the mockup. daisyUI semantic classes only, no hex.
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

export const auditTask = defineTask('injectable-picker-refine-audit', () => ({
  kind: 'shell',
  title: 'Audit Injectable Picker refinement diff',
  description: 'Inspect the full feature-branch diff (main...HEAD) plus working-tree status for the refinement pass.',
  shell: {
    command: [
      'git status --short --branch',
      'git --no-pager diff main...HEAD --stat',
      'git --no-pager diff main...HEAD --name-only'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'audit', 'injectable-picker']
}));

export const rustVerificationTask = defineTask('injectable-picker-refine-rust-tests', () => ({
  kind: 'shell',
  title: 'Run focused Rust tests for the ~/.claude asset write/delete command',
  description: 'Execute focused Rust tests for the new personal-scoped claude asset write/delete IPC command (path-traversal + home-scope safety) and the claude_code provider.',
  shell: {
    command: 'cargo test claude_asset && cargo test claude_code',
    cwd: 'src-tauri'
  },
  labels: ['shell', 'tdd', 'verification', 'rust', 'injectable-picker']
}));

export const focusedVerificationTask = defineTask('injectable-picker-refine-focused-tests', () => ({
  kind: 'shell',
  title: 'Run focused Injectable Picker frontend tests',
  description: 'Execute focused Vitest suites for the injectables lib helpers (char-count formatting, keyboard navigation, view-toggle/reselect logic) and the picker component.',
  shell: {
    command: 'pnpm exec vitest run src/lib/injectables src/components/injectables',
    cwd: '.'
  },
  labels: ['shell', 'tdd', 'verification', 'frontend', 'injectable-picker']
}));

export const reviewTask = defineTask('injectable-picker-refine-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Review Injectable Picker refinement diff',
  description: 'Adversarial OpenForge-specific review of the refinement diff before handoff.',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior OpenForge reviewer',
      task: 'Review the Injectable Picker refinement changes for actionable correctness, regression, security, maintainability, or missing-test findings.',
      context: args,
      instructions: [
        'Base the review on `git diff main...HEAD` (and `git status`) in the repo root plus the relevant existing code.',
        'SECURITY FOCUS: the new file write/delete IPC command must be hard-scoped to the user ~/.claude directory — reject path traversal, symlink escapes, and any path outside ~/.claude. Verify edit/delete are only reachable for personal-origin injectables.',
        'Enforce OpenForge boundaries: Svelte 5 runes only; all frontend->backend calls via typed src/lib/ipc.ts wrappers (camelCase payloads even though Rust params are snake_case); no raw Electron/preload/sidecar calls from Svelte; Rust command boundaries return Result<T, String> with .map_err(format!).',
        'Check the effect-cleanup rule: no $effect return-cleanup keyed by a prop value; explicit previous-value comparison + onDestroy instead.',
        'Verify markdown rendering reuses the existing renderMarkdownHtml / MarkdownContent sanitization path (no unsanitized innerHTML).',
        'Confirm the resizable divider reuses the existing ResizablePanel component rather than reinventing drag logic.',
        'Confirm tests cover business logic only (char-count formatting, keyboard nav index, view-toggle/reselect, IPC wrappers, Rust path safety) — no assertions on CSS classes / Tailwind utilities / visual styling.',
        'Confirm delete uses a confirmation step and that after edit/delete the catalog reloads so the UI reflects disk state.',
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

export const finalVerificationTask = defineTask('injectable-picker-refine-final-verification', () => ({
  kind: 'shell',
  title: 'Verify Injectable Picker refinement implementation',
  description: 'Run focused frontend tests, workspace type checking, focused Rust tests, and diff hygiene checks.',
  shell: {
    command: [
      'pnpm exec vitest run src/lib/injectables src/components/injectables',
      'pnpm exec tsc --noEmit',
      '(cd src-tauri && cargo test claude_asset && cargo test claude_code)',
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
      processId: 'openforge/injectable-picker-refinement',
      timestamp: ctx.now()
    }
  };
}
