/**
 * @process openforge/calm-ci-chips
 * @description Remove the bright "Fix failing CI checks" banner and restore calm muted small chips in the OpenForge UI.
 * @process specializations/web-development/svelte-sveltekit-development
 * @process specializations/desktop-development/desktop-ui-implementation
 * @process methodologies/atdd-tdd/atdd-tdd
 * @skill ui-ux-pro-max specializations/web-development/skills/frontend-design/SKILL.md
 * @agent component-developer specializations/web-development/agents/component-developer/AGENT.md
 * @agent code-reviewer specializations/web-development/agents/code-reviewer/AGENT.md
 * @inputs { taskId: string, request: string }
 * @outputs { success: boolean, implementation: object, verification: object, review: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const locateAndImplementTask = defineTask('calm-ci-chips-implement', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Restore calm CI failure chips',
  description: 'Find the bright CI failure banner and replace it with the prior calm, muted small-chip presentation without changing CI/task behavior.',
  agent: {
    name: 'component-developer',
    prompt: {
      role: 'OpenForge Svelte/TypeScript implementer',
      task: 'Remove the large bright "Fix failing CI checks" banner and restore muted small chips for CI failure affordances.',
      context: args,
      instructions: [
        'You are executing a Babysitter effect for the parent run; do not start another Babysitter run.',
        'Inspect the repository to locate the exact UI for the bright "Fix failing CI checks" banner.',
        'Make the smallest product-code change that removes the big banner and restores calm muted small chips.',
        'Preserve existing behavior and typed IPC boundaries; do not introduce raw Electron/sidecar calls.',
        'Do not add tests that assert Tailwind/daisyUI classes or visual styling; use existing business-logic tests only if behavior changes.',
        'Return JSON with changedFiles, summary, and verificationRecommendations.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['changedFiles', 'summary'],
      properties: {
        changedFiles: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        verificationRecommendations: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'implementation', 'svelte', 'ui']
}));

export const verificationTask = defineTask('calm-ci-chips-verification', () => ({
  kind: 'shell',
  title: 'Verify calm CI chip UI change',
  description: 'Run targeted static verification for the Svelte/TypeScript UI change.',
  shell: {
    command: 'pnpm exec tsc --noEmit && git diff --check',
    cwd: '.'
  },
  labels: ['shell', 'verification', 'typescript']
}));

export const reviewTask = defineTask('calm-ci-chips-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Post-implementation review',
  description: 'Review the calm CI chip change for correctness, maintainability, and regressions.',
  agent: {
    name: 'code-reviewer',
    prompt: {
      role: 'strict OpenForge code reviewer',
      task: 'Review the diff for the CI failure UI change.',
      context: args,
      instructions: [
        'You are executing a Babysitter effect for the parent run; do not start another Babysitter run.',
        'Inspect the actual git diff and relevant surrounding code.',
        'Report only actionable correctness, regression, maintainability, accessibility, or missing-verification findings.',
        'Do not report cosmetic preferences or ask for CSS-class unit tests.',
        'Return JSON with findings, summary, and residualRisk.'
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
              recommendation: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' },
        residualRisk: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'review', 'post-implementation']
}));

export async function process(inputs = {}, ctx) {
  const taskId = inputs.taskId || 'KVG-1608';
  const request = inputs.request || 'Remove the bright Fix failing CI checks banner and restore calm muted small chips.';

  const implementation = await ctx.task(locateAndImplementTask, { taskId, request });
  const verification = await ctx.task(verificationTask, { taskId, implementation });
  const review = await ctx.task(reviewTask, { taskId, implementation, verification });

  const findings = Array.isArray(review.findings) ? review.findings : [];

  return {
    success: findings.length === 0,
    implementation,
    verification,
    review,
    metadata: {
      processId: 'openforge/calm-ci-chips',
      taskId,
      timestamp: ctx.now()
    }
  };
}
