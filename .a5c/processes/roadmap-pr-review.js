/**
 * @process openforge/roadmap-pr-review
 * @description Review PR #1043 for the github-roadmap feature, with GitHub context collection and an adversarial OpenForge-specific review pass
 * @process methodologies/cc10x/cc10x-review
 * @process methodologies/claudekit/claudekit-code-review
 * @inputs { prUrl: string, reviewFocus?: string }
 * @outputs { success: boolean, findings: array, summary: string, residualRisk: array }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const collectPrContextTask = defineTask('roadmap-pr-review-context', (args) => ({
  kind: 'shell',
  title: 'Collect PR metadata and changed files',
  description: 'Capture current GitHub metadata, changed file list, and per-file stats for PR review.',
  shell: {
    command: [
      `gh pr view ${args.prUrl} --json number,title,state,isDraft,author,baseRefName,headRefName,url,body,additions,deletions,changedFiles,mergeable,reviewDecision,statusCheckRollup,commits`,
      `gh pr diff ${args.prUrl} --name-only`,
      `gh api repos/koenvg/openforge/pulls/1043/files --paginate --jq '.[] | [.status, .filename, (.additions|tostring), (.deletions|tostring), (.changes|tostring)] | @tsv'`
    ].join(' && printf "\\n---\\n" && '),
    cwd: '.'
  },
  labels: ['shell', 'github', 'pr-context', 'review']
}));

export const reviewTask = defineTask('roadmap-pr-adversarial-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Review Roadmap PR for actionable findings',
  description: 'Inspect the Roadmap PR diff and local code context for correctness risks.',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior OpenForge reviewer',
      task: 'Review PR #1043 and report only actionable correctness, regression, security, maintainability, or missing-test findings.',
      context: args,
      instructions: [
        'Use a code-review stance: findings first, ordered by severity, with exact file and line references.',
        'Focus on OpenForge boundaries: Svelte 5 runes, typed IPC and host callbacks, plugin authorization, Rust Result<T, String> command boundaries, GitHub API behavior, SQLite persistence, and built-in plugin registration.',
        'Do not report cosmetic styling preferences or CSS class choices.',
        'Verify suspected issues against the actual diff and relevant existing code before reporting.',
        'Call out merge conflicts, skipped or weak tests, and residual risks separately from actionable code findings.',
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
            required: ['severity', 'file', 'line', 'message'],
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
  labels: ['agent', 'review', 'adversarial', 'roadmap']
}));

export async function process(inputs = {}, ctx) {
  const prUrl = inputs.prUrl || 'https://github.com/koenvg/openforge/pull/1043';
  const reviewFocus = inputs.reviewFocus || 'Roadmap left-rail view, plugin host callbacks, Rust GitHub/SQLite backend, and Svelte plugin UI.';

  const prContext = await ctx.task(collectPrContextTask, { prUrl });
  const review = await ctx.task(reviewTask, { prUrl, reviewFocus, prContext });

  return {
    success: Array.isArray(review.findings) ? review.findings.length === 0 : false,
    findings: review.findings || [],
    summary: review.summary || '',
    openQuestions: review.openQuestions || [],
    skippedVerification: review.skippedVerification || [],
    residualRisk: review.residualRisk || [],
    metadata: {
      processId: 'openforge/roadmap-pr-review',
      prUrl,
      timestamp: ctx.now()
    }
  };
}
