/**
 * @process openforge/kvg-1588-closed-pr-state
 * @description Distinguish closed-but-unmerged PRs from merged/done task state and presentation.
 * @process methodologies/superpowers/test-driven-development.js
 * @process methodologies/gsd/iterative-convergence.js
 * @process methodologies/gsd/verify-work.js
 * @skill vitest specializations/web-development/skills/vitest/SKILL.md
 * @skill typescript specializations/web-development/skills/typescript/SKILL.md
 * @agent component-developer specializations/web-development/agents/component-developer/AGENT.md
 * @agent code-reviewer specializations/web-development/agents/code-reviewer/AGENT.md
 * @inputs { taskId: string, request: string }
 * @outputs { success: boolean, plan: object, tests: object, red: object, implementation: object, verification: object, review: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const planningTask = defineTask('kvg-1588-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Map closed PR state scope and TDD plan',
  description: 'Identify task-state and presentation surfaces affected by closed-but-unmerged PRs.',
  agent: {
    name: 'planner',
    prompt: {
      role: 'OpenForge TypeScript/Svelte planning engineer',
      task: 'Map how closed-but-unmerged pull requests flow through task state and presentation, then produce a concise TDD plan.',
      context: args,
      instructions: [
        'Do not edit files in this planning task.',
        'Inspect relevant files such as src/lib/taskState.ts, src/lib/taskStatePresentation.ts, PR status presentation, board filters/settings defaults, and focused tests.',
        'Decide whether a distinct pr-closed / closed-unmerged state is warranted for the user request.',
        'Return JSON with decision, filesToChange, testsToUpdate, and risks.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['decision', 'filesToChange', 'testsToUpdate', 'risks'],
      properties: {
        decision: { type: 'string' },
        filesToChange: { type: 'array', items: { type: 'string' } },
        testsToUpdate: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'planning', 'typescript']
}));

export const testUpdateTask = defineTask('kvg-1588-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Write failing regression tests for closed-unmerged PR state',
  description: 'Update focused business-logic/presentation tests before implementation.',
  agent: {
    name: 'component-developer',
    prompt: {
      role: 'OpenForge TypeScript engineer practising TDD',
      task: 'Write or update focused tests that expect closed-but-unmerged PRs to use a distinct closed state/presentation instead of merged/done.',
      context: args,
      instructions: [
        'You are executing a Babysitter effect for the parent run; do not start another Babysitter run.',
        'Edit tests only in this task.',
        'Prefer focused Vitest tests for src/lib/taskState, src/lib/taskStatePresentation, src/lib/prStatusPresentation, board filter/default state expectations, and TaskPullRequestStatus where existing behavior currently collapses closed PRs to merged.',
        'Do not assert CSS classes or visual styling.',
        'Keep tests aligned with Svelte 5 and project conventions.',
        'Return JSON with changedFiles, summary, and expectedFailingCommands.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['changedFiles', 'summary'],
      properties: {
        changedFiles: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        expectedFailingCommands: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'tdd', 'tests']
}));

export const redTestTask = defineTask('kvg-1588-red-tests', () => ({
  kind: 'shell',
  title: 'Run focused tests and capture red state',
  description: 'Run focused tests after test updates to confirm they fail before implementation.',
  shell: {
    command: 'pnpm exec vitest run src/lib/taskState.test.ts src/lib/taskStatePresentation.test.ts src/lib/prStatusPresentation.test.ts src/components/task-detail/TaskPullRequestStatus.test.ts src/components/settings/SettingsFocusFilterCard.test.ts src/components/settings/SettingsView.test.ts src/components/focus-board/FocusBoard.test.ts src/lib/boardFilters.test.ts',
    cwd: '.'
  },
  labels: ['shell', 'red', 'vitest']
}));

export const implementationTask = defineTask('kvg-1588-implementation', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement distinct closed-unmerged PR state',
  description: 'Implement state, presentation, filter/default, and component behavior to satisfy tests.',
  agent: {
    name: 'component-developer',
    prompt: {
      role: 'OpenForge TypeScript/Svelte implementer',
      task: 'Implement a distinct closed-but-unmerged pull request task state/presentation path while preserving merged PR behavior.',
      context: args,
      instructions: [
        'You are executing a Babysitter effect for the parent run; do not start another Babysitter run.',
        'Make the smallest coherent product-code changes to satisfy the focused tests.',
        'Closed-but-unmerged PRs should not appear as merged/done. Merged PRs should continue to appear as pr-merged/done.',
        'Update taskState types/order, task state presentation copy, PR status chips, task detail PR status labels, filter/default states, and any shared types as needed.',
        'Preserve typed IPC boundaries and existing conventions; do not use raw Electron/sidecar calls.',
        'If you notice significant adjacent cleanup, create a dependent OpenForge cleanup task rather than fixing unrelated issues.',
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
  labels: ['agent', 'implementation', 'typescript', 'svelte']
}));

export const verificationTask = defineTask('kvg-1588-verification', () => ({
  kind: 'shell',
  title: 'Verify closed PR state implementation',
  description: 'Run focused tests, TypeScript typecheck, and diff whitespace checks.',
  shell: {
    command: 'pnpm exec vitest run src/lib/taskState.test.ts src/lib/taskStatePresentation.test.ts src/lib/prStatusPresentation.test.ts src/components/task-detail/TaskPullRequestStatus.test.ts src/components/settings/SettingsFocusFilterCard.test.ts src/components/settings/SettingsView.test.ts src/components/focus-board/FocusBoard.test.ts src/lib/boardFilters.test.ts && pnpm exec tsc --noEmit && git diff --check',
    cwd: '.'
  },
  labels: ['shell', 'verification', 'vitest', 'typescript']
}));

export const reviewTask = defineTask('kvg-1588-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Post-implementation review',
  description: 'Review the diff for correctness and maintainability before handoff.',
  agent: {
    name: 'code-reviewer',
    prompt: {
      role: 'strict OpenForge code reviewer',
      task: 'Review the closed-unmerged PR state implementation.',
      context: args,
      instructions: [
        'You are executing a Babysitter effect for the parent run; do not start another Babysitter run.',
        'Inspect the actual git diff and relevant surrounding code.',
        'Check that closed-unmerged PRs no longer collapse into merged/done across task state, presentation, filters/defaults, and focused UI labels.',
        'Check tests cover business behavior without CSS-class assertions.',
        'Report only actionable blocking or material findings; return an empty findings array if none.',
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
  const taskId = inputs.taskId || 'KVG-1588';
  const request = inputs.request || 'Review and implement closed-but-unmerged pull request representation in task state and presentation.';

  const plan = await ctx.task(planningTask, { taskId, request });
  const tests = await ctx.task(testUpdateTask, { taskId, request, plan });
  const red = await ctx.task(redTestTask, { taskId, tests });
  const implementation = await ctx.task(implementationTask, { taskId, request, plan, tests, red });
  const verification = await ctx.task(verificationTask, { taskId, implementation });
  const review = await ctx.task(reviewTask, { taskId, plan, tests, red, implementation, verification });

  const findings = Array.isArray(review.findings) ? review.findings : [];
  return {
    success: findings.length === 0,
    plan,
    tests,
    red,
    implementation,
    verification,
    review,
    metadata: {
      processId: 'openforge/kvg-1588-closed-pr-state',
      taskId,
      timestamp: ctx.now()
    }
  };
}
