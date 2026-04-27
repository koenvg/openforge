/**
 * @process openforge/angry-oracle-code-change
 * @description Code-change workflow with TDD, verification, and an adversarial post-change oracle review/fix loop
 * @skill rust .agents/skills/rust/SKILL.md
 * @skill ui-ux-pro-max .agents/skills/ui-ux-pro-max/SKILL.md
 * @skill openforge /Users/koen/.pi/agent/skills/openforge/SKILL.md
 * @inputs { request: string, maxOracleIterations: number, targetOracleScore: number, verificationCommands: string[] }
 * @outputs { success: boolean, oracleApproved: boolean, iterations: number, changedFiles: string[], finalOracleReview: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const ORACLE_BLOCKING_SEVERITIES = ['critical', 'high'];
export const DEFAULT_VERIFICATION_COMMANDS = ['pnpm exec tsc --noEmit', 'pnpm test'];

export function hasBlockingOracleFindings(review = {}) {
  const verdict = String(review.verdict || '').toLowerCase();
  if (verdict && !['approve', 'approved', 'pass', 'passed'].includes(verdict)) {
    return true;
  }

  if (Array.isArray(review.blockers) && review.blockers.length > 0) {
    return true;
  }

  const findings = Array.isArray(review.findings) ? review.findings : [];
  return findings.some((finding) =>
    ORACLE_BLOCKING_SEVERITIES.includes(String(finding?.severity || '').toLowerCase())
  );
}

export function mergeChangedFiles(existing = [], update = {}) {
  const ordered = [];
  const add = (path) => {
    if (typeof path !== 'string') return;
    const trimmed = path.trim();
    if (trimmed && !ordered.includes(trimmed)) ordered.push(trimmed);
  };

  existing.forEach(add);
  update.filesCreated?.forEach(add);
  update.filesModified?.forEach(add);
  update.changedFiles?.forEach(add);
  update.files?.forEach(add);

  return ordered;
}

export function buildOracleReviewPrompt({ request, changedFiles = [], verificationResults = [], iteration = 1 }) {
  return {
    role: 'angry principal engineer oracle',
    task: 'Review the completed code changes after implementation. Be adversarial: do not rubber-stamp the work, and assume subtle bugs, convention violations, missing tests, and over-engineering are present until proven otherwise.',
    context: {
      request,
      changedFiles,
      verificationResults,
      iteration,
      projectConventions: [
        'Svelte 5 runes only; no legacy event dispatchers',
        'All Tauri invoke calls go through src/lib/ipc.ts typed wrappers',
        'External links use openUrl() IPC wrapper',
        'TypeScript uses import type with verbatimModuleSyntax',
        'Rust commands return Result<T, String> with formatted errors',
        'Tests cover business logic, not visual styling',
        'Map-based stores must replace with new Map() for reactivity',
        'Terminal lifecycle ownership belongs in src/lib/terminalPool.ts'
      ]
    },
    instructions: [
      'Inspect the diff, tests, and verification output against the original request.',
      'Check project conventions from AGENTS.md and the project profile before judging readiness.',
      'Flag any missing test coverage, business logic regressions, race conditions, stale lifecycle state, direct invoke usage, or Svelte/Rust convention violations.',
      'Every finding must include severity, file/path when applicable, evidence, and an actionable fix.',
      'Treat critical and high severity findings as blockers that must be fixed before completion.',
      'Return changes_requested unless the implementation is genuinely ready with no blocking issues.'
    ],
    outputFormat: 'JSON with verdict (approve|changes_requested), score (0-100), summary, blockers, findings, requiredFixes, and praiseIfAny'
  };
}

export async function process(inputs, ctx) {
  const request = inputs.request || inputs.prompt || 'Implement the requested code change';
  const maxOracleIterations = Number(inputs.maxOracleIterations ?? 3);
  const targetOracleScore = Number(inputs.targetOracleScore ?? 90);
  const verificationCommands = Array.isArray(inputs.verificationCommands) && inputs.verificationCommands.length > 0
    ? inputs.verificationCommands
    : DEFAULT_VERIFICATION_COMMANDS;

  const projectContext = await ctx.task(projectContextTask, { request });

  let implementation = await ctx.task(implementationTask, {
    request,
    projectContext,
    previousOracleReview: null
  });

  let changedFiles = mergeChangedFiles([], implementation);
  const oracleAttempts = [];
  let verificationResults = [];
  let finalOracleReview = null;
  let oracleApproved = false;

  for (let iteration = 1; iteration <= maxOracleIterations; iteration++) {
    const inventory = await ctx.task(changeInventoryTask, { request, changedFiles, iteration });
    changedFiles = mergeChangedFiles(changedFiles, inventory);

    verificationResults = [];
    for (const command of verificationCommands) {
      const result = await ctx.task(runVerificationCommandTask, { command, iteration });
      verificationResults.push({ command, ...result });
    }

    finalOracleReview = await ctx.task(angryOracleReviewTask, {
      request,
      changedFiles,
      implementation,
      verificationResults,
      iteration,
      targetOracleScore
    });

    const blocking = hasBlockingOracleFindings(finalOracleReview);
    const score = Number(finalOracleReview?.score ?? 0);
    oracleAttempts.push({ iteration, review: finalOracleReview, blocking, score });

    if (!blocking && score >= targetOracleScore) {
      oracleApproved = true;
      break;
    }

    if (iteration === maxOracleIterations) {
      await ctx.breakpoint({
        title: 'Angry oracle still has blocking feedback',
        question: `The angry oracle still requests changes after ${iteration} iteration(s). Stop here or manually approve continuing despite the feedback?`,
        context: {
          runId: ctx.runId,
          oracleReview: finalOracleReview,
          changedFiles,
          verificationResults
        },
        tags: ['oracle', 'quality-gate', 'manual-decision']
      });
      break;
    }

    const fixResult = await ctx.task(oracleFixTask, {
      request,
      changedFiles,
      verificationResults,
      oracleReview: finalOracleReview,
      iteration
    });
    implementation = { ...implementation, ...fixResult };
    changedFiles = mergeChangedFiles(changedFiles, fixResult);
  }

  return {
    success: oracleApproved,
    request,
    oracleApproved,
    iterations: oracleAttempts.length,
    changedFiles,
    verificationResults,
    finalOracleReview,
    oracleAttempts,
    metadata: {
      processId: 'openforge/angry-oracle-code-change',
      timestamp: ctx.now()
    }
  };
}

export const projectContextTask = defineTask('project-context', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Map project context and constraints',
  description: 'Read project guidance and identify verification expectations before editing',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer preparing a code change',
      task: 'Summarize the project-specific rules, relevant files, and verification gates for the requested change',
      context: args,
      instructions: [
        'Read AGENTS.md, .a5c/project-profile.md, and .a5c/quality-gates.json if available.',
        'Identify which frontend, Rust, plugin, or process files are likely touched.',
        'Call out any project-specific hazards that the implementation and oracle must enforce.'
      ],
      outputFormat: 'JSON with summary, relevantFiles, verificationCommands, hazards, and constraints'
    },
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
        relevantFiles: { type: 'array', items: { type: 'string' } },
        verificationCommands: { type: 'array', items: { type: 'string' } },
        hazards: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'planning', 'project-context']
}));

export const implementationTask = defineTask('implementation-with-tdd', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement requested code change with TDD',
  description: 'Make the requested changes, writing or updating focused business-logic tests first',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior OpenForge engineer',
      task: 'Implement the requested code change completely',
      context: args,
      instructions: [
        'Use TDD: write or update focused business-logic tests first and verify they fail for the right reason before implementation.',
        'Implement only the requested scope; do not opportunistically refactor unrelated code.',
        'Follow AGENTS.md conventions exactly for Svelte, TypeScript, Rust, IPC, terminal lifecycle, task context menus, and styling.',
        'Run targeted verification as you work when practical.',
        'Return a precise list of files created, modified, and verification performed.'
      ],
      outputFormat: 'JSON with summary, filesCreated, filesModified, changedFiles, testsAddedOrUpdated, verification'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'changedFiles'],
      properties: {
        summary: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
        changedFiles: { type: 'array', items: { type: 'string' } },
        testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
        verification: { type: 'array' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'implementation', 'tdd']
}));

export const changeInventoryTask = defineTask('change-inventory', (args) => ({
  kind: 'shell',
  title: `Inventory changed files (oracle iter ${args.iteration})`,
  description: 'Capture git status, changed file names, and diff stat after code changes',
  shell: {
    command: 'printf "## git status --short\\n" && git status --short && printf "\\n## changed tracked files\\n" && git diff --name-only HEAD && printf "\\n## untracked files\\n" && git ls-files --others --exclude-standard && printf "\\n## diff stat\\n" && git diff --stat HEAD',
    cwd: '.'
  },
  labels: ['shell', 'git', 'inventory', `oracle-iteration-${args.iteration}`]
}));

export const runVerificationCommandTask = defineTask('verification-command', (args) => ({
  kind: 'shell',
  title: `Verify: ${args.command}`,
  description: 'Run a project verification command before the oracle review',
  shell: {
    command: args.command,
    cwd: '.'
  },
  labels: ['shell', 'verification', `oracle-iteration-${args.iteration}`]
}));

export const angryOracleReviewTask = defineTask('angry-oracle-review', (args, taskCtx) => ({
  kind: 'agent',
  title: `Angry oracle review (iteration ${args.iteration})`,
  description: 'Adversarial post-change review that must find actionable blocking feedback before completion',
  agent: {
    name: 'general-purpose',
    prompt: buildOracleReviewPrompt(args),
    outputSchema: {
      type: 'object',
      required: ['verdict', 'score', 'summary', 'findings'],
      properties: {
        verdict: { type: 'string', enum: ['approve', 'changes_requested'] },
        score: { type: 'number', minimum: 0, maximum: 100 },
        summary: { type: 'string' },
        blockers: { type: 'array', items: { type: 'string' } },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['severity', 'message', 'actionableFix'],
            properties: {
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              file: { type: 'string' },
              message: { type: 'string' },
              evidence: { type: 'string' },
              actionableFix: { type: 'string' }
            }
          }
        },
        requiredFixes: { type: 'array', items: { type: 'string' } },
        praiseIfAny: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'oracle', 'adversarial-review', `iteration-${args.iteration}`]
}));

export const oracleFixTask = defineTask('oracle-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: `Fix angry oracle feedback (iteration ${args.iteration})`,
  description: 'Apply required fixes from the adversarial oracle review',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer fixing code review blockers',
      task: 'Apply the angry oracle feedback and remove all critical/high blockers',
      context: args,
      instructions: [
        'Fix every critical and high severity finding unless it is demonstrably false; explain any false positive with evidence.',
        'Add or update focused business-logic tests for the fixed behavior.',
        'Keep the scope tight to the oracle feedback and original request.',
        'Return exactly what changed and which findings were addressed.'
      ],
      outputFormat: 'JSON with summary, filesCreated, filesModified, changedFiles, addressedFindings, testsAddedOrUpdated, remainingConcerns'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'changedFiles'],
      properties: {
        summary: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
        changedFiles: { type: 'array', items: { type: 'string' } },
        addressedFindings: { type: 'array', items: { type: 'string' } },
        testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
        remainingConcerns: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'fix', 'oracle-feedback', `iteration-${args.iteration}`]
}));
