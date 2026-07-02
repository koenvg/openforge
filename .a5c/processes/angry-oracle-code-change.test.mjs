import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ORACLE_BLOCKING_SEVERITIES,
  buildManualVerificationSkip,
  buildOracleReviewPrompt,
  changeInventoryTask,
  angryOracleReviewTask,
  architectureReviewTask,
  hasBlockingArchitectureFindings,
  hasBlockingOracleFindings,
  implementationTask,
  isFiniteNumericReviewScore,
  manualAppVerificationTask,
  mergeChangedFiles,
  process as runProcess,
  projectContextTask,
  runVerificationCommandTask,
  shouldRequestManualAppVerification
} from './angry-oracle-code-change.js';

describe('angry oracle code-change process', () => {
  it('treats critical, high, explicit blockers, required fixes, and non-approve verdicts as blocking', () => {
    assert.deepEqual(ORACLE_BLOCKING_SEVERITIES, ['critical', 'high']);

    assert.equal(
      hasBlockingOracleFindings({ verdict: 'approve', findings: [{ severity: 'medium', message: 'nit' }] }),
      false
    );
    assert.equal(
      hasBlockingOracleFindings({ verdict: 'approve', findings: [{ severity: 'high', message: 'broken edge case' }] }),
      true
    );
    assert.equal(hasBlockingOracleFindings({ verdict: 'changes_requested', findings: [] }), true);
    assert.equal(hasBlockingOracleFindings({ score: 99, findings: [] }), true);
    assert.equal(hasBlockingOracleFindings({ verdict: 'needs_work', score: 99, findings: [] }), true);
    assert.equal(hasBlockingOracleFindings({ verdict: 'approve', blockers: ['tests do not cover failure path'] }), true);
    assert.equal(hasBlockingOracleFindings({ verdict: 'approve', requiredFixes: ['split orchestration concerns'] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: 95, findings: [] }), false);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: '95', findings: [] }), false);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: 'not-a-number', findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: Number.NaN, findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: Infinity, findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: -1, findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: 101, findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: '0', findings: [] }), false);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', score: '100', findings: [] }), false);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'approve', findings: [{ severity: 'critical', message: 'wrong layer' }] }), true);
    assert.equal(hasBlockingArchitectureFindings({ score: 99, findings: [] }), true);
    assert.equal(hasBlockingArchitectureFindings({ verdict: 'needs_work', score: 99, findings: [] }), true);
    assert.equal(isFiniteNumericReviewScore(95), true);
    assert.equal(isFiniteNumericReviewScore('95'), true);
    assert.equal(isFiniteNumericReviewScore('not-a-number'), false);
    assert.equal(isFiniteNumericReviewScore(Infinity), false);
  });

  it('deduplicates changed files from implementation outputs while preserving order', () => {
    assert.deepEqual(
      mergeChangedFiles(['src/a.ts', 'src/b.ts'], {
        filesCreated: ['src/c.ts'],
        filesModified: ['src/b.ts', 'src/d.ts'],
        changedFiles: ['src/a.ts', 'src/e.ts']
      }),
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']
    );
  });

  it('inventories tracked and untracked files for oracle review', async () => {
    const task = await changeInventoryTask.build({ iteration: 1 }, { effectId: 'effect-1' });

    assert.match(task.shell.command, /git diff --name-only HEAD/);
    assert.match(task.shell.command, /git ls-files --others --exclude-standard/);
  });

  it('applies TDD conditionally instead of mandating failing tests for every workflow change', async () => {
    const implementation = await implementationTask.build({}, { effectId: 'effect-1' });

    assert.match(implementation.title, /appropriate verification/i);
    assert.ok(
      implementation.agent.prompt.instructions.some((instruction) =>
        /TDD.*feature.*bugfix.*business-logic/i.test(instruction)
      )
    );
    assert.ok(
      implementation.agent.prompt.instructions.some((instruction) =>
        /documentation-only.*configuration-only.*process-only/i.test(instruction)
      )
    );
  });

  it('builds an adversarial post-change oracle prompt that requires thermo-nuclear structural review, architectural review, and actionable fixes', () => {
    const prompt = buildOracleReviewPrompt({
      request: 'Add token rotation',
      changedFiles: ['src/auth.ts'],
      verificationResults: [{ command: 'pnpm test', status: 'ok' }],
      manualVerification: { status: 'passed', applicable: true, summary: 'Board smoke checked' },
      iteration: 1
    });

    assert.equal(prompt.role, 'thermo-nuclear code quality oracle');
    assert.match(prompt.task, /review the completed code changes/i);
    assert.match(prompt.task, /not rubber-stamp/i);
    assert.match(prompt.task, /architectural fit/i);
    assert.match(prompt.task, /thermo-nuclear code quality/i);
    assert.ok(prompt.instructions.some((instruction) => /actionable fix/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /project conventions/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /architecture/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /manual app verification/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /code judo/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /spaghetti/i.test(instruction)));
    assert.deepEqual(prompt.context.changedFiles, ['src/auth.ts']);
    assert.deepEqual(prompt.context.manualVerification, { status: 'passed', applicable: true, summary: 'Board smoke checked' });
  });

  it('uses the repo-local review skill for the adversarial oracle review gate', async () => {
    const task = await angryOracleReviewTask.build(
      {
        request: 'Add token rotation',
        changedFiles: ['src/auth.ts'],
        verificationResults: [{ command: 'pnpm test', status: 'ok' }],
        manualVerification: { status: 'skipped', applicable: false },
        architectureReview: { verdict: 'approve', score: 95, summary: 'Architecture fits', findings: [] },
        iteration: 1,
        targetOracleScore: 90
      },
      { effectId: 'effect-review' }
    );

    assert.equal(task.kind, 'skill');
    assert.equal(task.skill.name, 'review');
    assert.equal(task.skill.context.role, 'thermo-nuclear code quality oracle');
    assert.match(task.skill.context.expectedOutput, /verdict/);
    assert.match(task.skill.context.expectedOutput, /requiredFixes/);
    assert.equal(task.io.outputJsonPath, 'tasks/effect-review/output.json');
  });

  it('uses the improve-codebase-architecture skill for the explicit architecture review gate', async () => {
    const task = await architectureReviewTask.build(
      {
        request: 'Add token rotation',
        changedFiles: ['src/auth.ts'],
        verificationResults: [{ command: 'pnpm test', status: 'ok' }],
        manualVerification: { status: 'skipped', applicable: false },
        iteration: 1,
        targetOracleScore: 90
      },
      { effectId: 'effect-1' }
    );

    assert.equal(task.kind, 'skill');
    assert.equal(task.skill.name, 'improve-codebase-architecture');
    assert.ok(task.skill.context.instructions.some((instruction) => /architecture review gate/i.test(instruction)));
    assert.ok(task.skill.context.instructions.some((instruction) => /module boundaries/i.test(instruction)));
    assert.match(task.skill.context.expectedOutput, /verdict/);
    assert.equal(task.io.outputJsonPath, 'tasks/effect-1/output.json');
  });

  it('declares the architecture and thermo-nuclear review skills in the process JSDoc skill markers', async () => {
    const architectureTask = await architectureReviewTask.build({ iteration: 1 }, { effectId: 'effect-1' });
    const oracleTask = await angryOracleReviewTask.build({ iteration: 1 }, { effectId: 'effect-2' });
    const source = readFileSync(new URL('./angry-oracle-code-change.js', import.meta.url), 'utf8');
    const processJsDoc = source.match(/^\/\*\*[\s\S]*?\*\//)?.[0] ?? '';
    const skillMarkers = new Map(
      [...processJsDoc.matchAll(/^\s*\*\s*@skill\s+(\S+)\s+(\S+)/gm)].map((match) => [match[1], match[2]])
    );

    assert.ok(
      skillMarkers.has(architectureTask.skill.name),
      `Expected architectureReviewTask skill "${architectureTask.skill.name}" to be declared in process @skill markers`
    );
    assert.equal(
      skillMarkers.get(architectureTask.skill.name),
      '/Users/koen/.agents/skills/improve-codebase-architecture/SKILL.md'
    );
    assert.ok(
      skillMarkers.has(oracleTask.skill.name),
      `Expected angryOracleReviewTask skill "${oracleTask.skill.name}" to be declared in process @skill markers`
    );
    assert.equal(skillMarkers.get(oracleTask.skill.name), '.agents/skills/review/SKILL.md');
  });

  it('requests manual app verification for app-facing and runtime-sensitive changes', () => {
    assert.equal(shouldRequestManualAppVerification(['src/App.svelte']), true);
    assert.equal(shouldRequestManualAppVerification(['src/electron/main.ts']), true);
    assert.equal(shouldRequestManualAppVerification(['src-tauri/src/commands/tasks.rs']), true);
    assert.equal(shouldRequestManualAppVerification(['plugins/skills-viewer/src/SkillsView.svelte']), true);
    assert.equal(shouldRequestManualAppVerification(['packages/plugin-sdk/src/index.ts']), true);
  });

  it('skips manual app verification for process-only changes with an explicit rationale', () => {
    assert.equal(shouldRequestManualAppVerification(['.a5c/processes/angry-oracle-code-change.js']), false);

    assert.deepEqual(
      buildManualVerificationSkip(['.a5c/processes/angry-oracle-code-change.js'], 2),
      {
        status: 'skipped',
        applicable: false,
        iteration: 2,
        summary: 'Manual OpenForge app smoke verification was skipped because the changed files do not affect app UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior.',
        changedFiles: ['.a5c/processes/angry-oracle-code-change.js']
      }
    );
  });

  it('uses the openforge-app-operator skill for applicable manual app verification', async () => {
    const task = await manualAppVerificationTask.build(
      {
        request: 'Fix task detail rendering',
        changedFiles: ['src/components/TaskDetails.svelte'],
        verificationResults: [{ command: 'pnpm test', status: 'ok' }],
        iteration: 1
      },
      { effectId: 'effect-1' }
    );

    assert.equal(task.kind, 'skill');
    assert.equal(task.skill.name, 'openforge-app-operator');
    assert.ok(task.skill.context.instructions.some((instruction) => /manual app smoke verification/i.test(instruction)));
    assert.ok(task.skill.context.instructions.some((instruction) => /read-only/i.test(instruction)));
    assert.deepEqual(task.skill.context.changedFiles, ['src/components/TaskDetails.svelte']);
    assert.equal(task.io.outputJsonPath, 'tasks/effect-1/output.json');
  });

  it('runs applicable manual app verification and architecture review after automated verification and before oracle review', async () => {
    const taskOrder = [];
    const manualVerification = { status: 'passed', applicable: true, summary: 'Smoke checked task detail' };
    const architectureReview = { verdict: 'approve', score: 95, summary: 'Architecture fits', findings: [] };

    const result = await runProcess(
      {
        request: 'Fix task detail rendering',
        verificationCommands: ['pnpm test src/components/TaskDetails.test.ts'],
        targetOracleScore: 90
      },
      {
        runId: 'run-1',
        now: () => '2026-05-06T00:00:00.000Z',
        task: async (task, args) => {
          if (task === projectContextTask) {
            taskOrder.push('project-context');
            return { summary: 'context' };
          }
          if (task === implementationTask) {
            taskOrder.push('implementation');
            return { summary: 'implemented', changedFiles: ['src/components/TaskDetails.svelte'] };
          }
          if (task === changeInventoryTask) {
            taskOrder.push('change-inventory');
            return {};
          }
          if (task === runVerificationCommandTask) {
            taskOrder.push('automated-verification');
            assert.equal(args.command, 'pnpm test src/components/TaskDetails.test.ts');
            return { status: 'ok' };
          }
          if (task === manualAppVerificationTask) {
            taskOrder.push('manual-verification');
            assert.deepEqual(args.verificationResults, [
              { command: 'pnpm test src/components/TaskDetails.test.ts', status: 'ok' }
            ]);
            return manualVerification;
          }
          if (task === architectureReviewTask) {
            taskOrder.push('architecture-review');
            assert.deepEqual(args.manualVerification, manualVerification);
            return architectureReview;
          }
          if (task === angryOracleReviewTask) {
            taskOrder.push('oracle-review');
            assert.deepEqual(args.manualVerification, manualVerification);
            assert.deepEqual(args.architectureReview, architectureReview);
            return { verdict: 'approve', score: 95, summary: 'ready', findings: [] };
          }
          throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
        },
        breakpoint: async () => {
          throw new Error('No breakpoint expected');
        }
      }
    );

    assert.deepEqual(taskOrder, [
      'project-context',
      'implementation',
      'change-inventory',
      'automated-verification',
      'manual-verification',
      'architecture-review',
      'oracle-review'
    ]);
    assert.equal(result.oracleApproved, true);
    assert.equal(result.architectureApproved, true);
    assert.deepEqual(result.manualVerification, manualVerification);
    assert.deepEqual(result.finalArchitectureReview, architectureReview);
  });

  it('runs one oracle review and records a failed result without fix loops or breakpoints', async () => {
    for (const oracleReview of [
      { score: 99, summary: 'High-scoring oracle forgot to emit an approve verdict', findings: [] },
      { verdict: 'needs_work', score: 99, summary: 'Oracle emitted an invalid verdict', findings: [] }
    ]) {
      const taskOrder = [];
      const breakpoints = [];
      const architectureReview = { verdict: 'approve', score: 95, summary: 'Architecture fits', findings: [] };

      const result = await runProcess(
        {
          request: 'Tighten oracle gate verdict handling',
          verificationCommands: ['node --test .a5c/processes/angry-oracle-code-change.test.mjs'],
          targetOracleScore: 90
        },
        {
          runId: `run-oracle-${oracleReview.verdict || 'missing'}`,
          now: () => '2026-05-06T00:00:00.000Z',
          task: async (task) => {
            if (task === projectContextTask) {
              taskOrder.push('project-context');
              return { summary: 'context' };
            }
            if (task === implementationTask) {
              taskOrder.push('implementation');
              return { summary: 'implemented', changedFiles: ['.a5c/processes/angry-oracle-code-change.js'] };
            }
            if (task === changeInventoryTask) {
              taskOrder.push('change-inventory');
              return {};
            }
            if (task === runVerificationCommandTask) {
              taskOrder.push('automated-verification');
              return { status: 'ok' };
            }
            if (task === architectureReviewTask) {
              taskOrder.push('architecture-review');
              return architectureReview;
            }
            if (task === angryOracleReviewTask) {
              taskOrder.push('oracle-review');
              return oracleReview;
            }
            throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
          },
          breakpoint: async (details) => {
            breakpoints.push(details);
          }
        }
      );

      assert.deepEqual(taskOrder, [
        'project-context',
        'implementation',
        'change-inventory',
        'automated-verification',
        'architecture-review',
        'oracle-review'
      ]);
      assert.equal(result.architectureApproved, true);
      assert.equal(result.oracleApproved, false);
      assert.equal(result.success, false);
      assert.deepEqual(result.finalOracleReview, oracleReview);
      assert.equal(result.oracleAttempts.length, 1);
      assert.equal(result.oracleAttempts[0].blocking, true);
      assert.equal(breakpoints.length, 0);
    }
  });

  it('blocks a high-scoring architecture review with a missing verdict before oracle review', async () => {
    const taskOrder = [];
    const breakpoints = [];
    const architectureReview = {
      score: 99,
      summary: 'High-scoring review forgot to emit an approve verdict',
      findings: []
    };

    const result = await runProcess(
      {
        request: 'Tighten architecture gate verdict handling',
        verificationCommands: ['node --test .a5c/processes/angry-oracle-code-change.test.mjs'],
        targetOracleScore: 90
      },
      {
        runId: 'run-1',
        now: () => '2026-05-06T00:00:00.000Z',
        task: async (task) => {
          if (task === projectContextTask) {
            taskOrder.push('project-context');
            return { summary: 'context' };
          }
          if (task === implementationTask) {
            taskOrder.push('implementation');
            return { summary: 'implemented', changedFiles: ['.a5c/processes/angry-oracle-code-change.js'] };
          }
          if (task === changeInventoryTask) {
            taskOrder.push('change-inventory');
            return {};
          }
          if (task === runVerificationCommandTask) {
            taskOrder.push('automated-verification');
            return { status: 'ok' };
          }
          if (task === architectureReviewTask) {
            taskOrder.push('architecture-review');
            return architectureReview;
          }
          if (task === angryOracleReviewTask) {
            throw new Error('Angry oracle review must not run when architecture verdict is missing');
          }
          throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
        },
        breakpoint: async (details) => {
          breakpoints.push(details);
        }
      }
    );

    assert.deepEqual(taskOrder, [
      'project-context',
      'implementation',
      'change-inventory',
      'automated-verification',
      'architecture-review'
    ]);
    assert.equal(result.architectureApproved, false);
    assert.equal(result.oracleApproved, false);
    assert.equal(result.finalOracleReview, null);
    assert.deepEqual(result.finalArchitectureReview, architectureReview);
    assert.equal(result.architectureAttempts.length, 1);
    assert.equal(result.architectureAttempts[0].blocking, true);
    assert.equal(breakpoints.length, 0);
  });

  it('blocks an approving architecture review with a non-numeric score before oracle review', async () => {
    const taskOrder = [];
    const breakpoints = [];
    const architectureReview = {
      verdict: 'approve',
      score: 'not-a-number',
      summary: 'Approval accidentally emitted an invalid score',
      findings: []
    };

    const result = await runProcess(
      {
        request: 'Tighten architecture gate score handling',
        verificationCommands: ['node --test .a5c/processes/angry-oracle-code-change.test.mjs'],
        targetOracleScore: 90
      },
      {
        runId: 'run-1',
        now: () => '2026-05-06T00:00:00.000Z',
        task: async (task) => {
          if (task === projectContextTask) {
            taskOrder.push('project-context');
            return { summary: 'context' };
          }
          if (task === implementationTask) {
            taskOrder.push('implementation');
            return { summary: 'implemented', changedFiles: ['.a5c/processes/angry-oracle-code-change.js'] };
          }
          if (task === changeInventoryTask) {
            taskOrder.push('change-inventory');
            return {};
          }
          if (task === runVerificationCommandTask) {
            taskOrder.push('automated-verification');
            return { status: 'ok' };
          }
          if (task === architectureReviewTask) {
            taskOrder.push('architecture-review');
            return architectureReview;
          }
          if (task === angryOracleReviewTask) {
            throw new Error('Angry oracle review must not run when architecture score is non-numeric');
          }
          throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
        },
        breakpoint: async (details) => {
          breakpoints.push(details);
        }
      }
    );

    assert.deepEqual(taskOrder, [
      'project-context',
      'implementation',
      'change-inventory',
      'automated-verification',
      'architecture-review'
    ]);
    assert.equal(result.architectureApproved, false);
    assert.equal(result.oracleApproved, false);
    assert.equal(result.finalOracleReview, null);
    assert.deepEqual(result.finalArchitectureReview, architectureReview);
    assert.equal(result.architectureAttempts.length, 1);
    assert.equal(result.architectureAttempts[0].blocking, true);
    assert.equal(breakpoints.length, 0);
  });

  it('blocks approving architecture reviews with out-of-range scores before oracle review', async () => {
    for (const score of [-1, 101]) {
      const taskOrder = [];
      const breakpoints = [];
      const architectureReview = {
        verdict: 'approve',
        score,
        summary: `Approval accidentally emitted out-of-range score ${score}`,
        findings: []
      };

      const result = await runProcess(
        {
          request: 'Tighten architecture gate score range handling',
          verificationCommands: ['node --test .a5c/processes/angry-oracle-code-change.test.mjs'],
          targetOracleScore: 90
        },
        {
          runId: `run-score-${score}`,
          now: () => '2026-05-06T00:00:00.000Z',
          task: async (task) => {
            if (task === projectContextTask) {
              taskOrder.push('project-context');
              return { summary: 'context' };
            }
            if (task === implementationTask) {
              taskOrder.push('implementation');
              return { summary: 'implemented', changedFiles: ['.a5c/processes/angry-oracle-code-change.js'] };
            }
            if (task === changeInventoryTask) {
              taskOrder.push('change-inventory');
              return {};
            }
            if (task === runVerificationCommandTask) {
              taskOrder.push('automated-verification');
              return { status: 'ok' };
            }
            if (task === architectureReviewTask) {
              taskOrder.push('architecture-review');
              return architectureReview;
            }
            if (task === angryOracleReviewTask) {
              throw new Error(`Angry oracle review must not run when architecture score is ${score}`);
            }
            throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
          },
          breakpoint: async (details) => {
            breakpoints.push(details);
          }
        }
      );

      assert.deepEqual(taskOrder, [
        'project-context',
        'implementation',
        'change-inventory',
        'automated-verification',
        'architecture-review'
      ]);
      assert.equal(result.architectureApproved, false);
      assert.equal(result.oracleApproved, false);
      assert.equal(result.finalOracleReview, null);
      assert.deepEqual(result.finalArchitectureReview, architectureReview);
      assert.equal(result.architectureAttempts.length, 1);
      assert.equal(result.architectureAttempts[0].blocking, true);
      assert.equal(breakpoints.length, 0);
    }
  });

  it('runs one architecture review and records a failed result without fixes, oracle review, or breakpoints', async () => {
    const taskOrder = [];
    const breakpoints = [];
    const architectureReview = {
      verdict: 'changes_requested',
      score: 70,
      summary: 'Ownership is misplaced',
      findings: [{ severity: 'high', message: 'Wrong layer', actionableFix: 'Move process orchestration back into process task' }]
    };

    const result = await runProcess(
      {
        request: 'Move task orchestration into the right layer',
        verificationCommands: ['node --test .a5c/processes/angry-oracle-code-change.test.mjs'],
        targetOracleScore: 90
      },
      {
        runId: 'run-1',
        now: () => '2026-05-06T00:00:00.000Z',
        task: async (task, args) => {
          if (task === projectContextTask) {
            taskOrder.push('project-context');
            return { summary: 'context' };
          }
          if (task === implementationTask) {
            taskOrder.push('implementation');
            return { summary: 'implemented', changedFiles: ['.a5c/processes/angry-oracle-code-change.js'] };
          }
          if (task === changeInventoryTask) {
            taskOrder.push(`change-inventory-${args.iteration}`);
            return {};
          }
          if (task === runVerificationCommandTask) {
            taskOrder.push(`automated-verification-${args.iteration}`);
            return { status: 'ok' };
          }
          if (task === architectureReviewTask) {
            taskOrder.push(`architecture-review-${args.iteration}`);
            return architectureReview;
          }
          if (task === angryOracleReviewTask) {
            throw new Error('Angry oracle review must not run when architecture review blocks');
          }
          throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
        },
        breakpoint: async (details) => {
          breakpoints.push(details);
        }
      }
    );

    assert.deepEqual(taskOrder, [
      'project-context',
      'implementation',
      'change-inventory-1',
      'automated-verification-1',
      'architecture-review-1'
    ]);
    assert.equal(result.architectureApproved, false);
    assert.equal(result.oracleApproved, false);
    assert.equal(result.success, false);
    assert.deepEqual(result.finalArchitectureReview, architectureReview);
    assert.equal(result.finalOracleReview, null);
    assert.equal(result.architectureAttempts.length, 1);
    assert.equal(result.oracleAttempts.length, 0);
    assert.equal(breakpoints.length, 0);
  });
});
