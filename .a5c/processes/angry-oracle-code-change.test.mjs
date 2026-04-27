import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORACLE_BLOCKING_SEVERITIES,
  buildOracleReviewPrompt,
  changeInventoryTask,
  hasBlockingOracleFindings,
  mergeChangedFiles
} from './angry-oracle-code-change.js';

describe('angry oracle code-change process', () => {
  it('treats critical, high, explicit blockers, and non-approve verdicts as blocking', () => {
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
    assert.equal(hasBlockingOracleFindings({ verdict: 'approve', blockers: ['tests do not cover failure path'] }), true);
  });

  it('deduplicates changed files from implementation and fixer outputs while preserving order', () => {
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

  it('builds an adversarial post-change oracle prompt that requires actionable fixes', () => {
    const prompt = buildOracleReviewPrompt({
      request: 'Add token rotation',
      changedFiles: ['src/auth.ts'],
      verificationResults: [{ command: 'pnpm test', status: 'ok' }],
      iteration: 1
    });

    assert.equal(prompt.role, 'angry principal engineer oracle');
    assert.match(prompt.task, /review the completed code changes/i);
    assert.match(prompt.task, /not rubber-stamp/i);
    assert.ok(prompt.instructions.some((instruction) => /actionable fix/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /project conventions/i.test(instruction)));
    assert.deepEqual(prompt.context.changedFiles, ['src/auth.ts']);
  });
});
