import { describe, expect, it } from 'vitest';
import { runCli, runCliAgainstRequestSequence } from './cli-test-utils.js';

const REMOVED = {
  task_id: 'T-7',
  previous_status: 'doing',
  status: 'done',
  worktree_path: '/repos/web/.worktrees/T-7',
  worktree_removed: true,
};

function completeStep(response, statusCode = 200) {
  return { url: '/complete_task', method: 'POST', response, statusCode };
}

describe('openforge task complete', () => {
  it('sends only the task id by default and prints a one-line summary', async () => {
    const { stdout, seenRequests } = await runCliAgainstRequestSequence(
      ['task', 'complete', '--task-id', 'T-7'],
      [completeStep(REMOVED)],
    );

    expect(seenRequests[0].body).toEqual({
      task_id: 'T-7',
      stop_session: false,
      force: false,
      keep_worktree: false,
    });
    expect(stdout.trim()).toBe('Completed T-7 (doing -> done). Removed worktree /repos/web/.worktrees/T-7.');
  });

  it('forwards --stop-session, --force and --keep-worktree', async () => {
    const { seenRequests } = await runCliAgainstRequestSequence(
      ['task', 'complete', '--task-id', 'T-7', '--stop-session', '--force', '--keep-worktree'],
      [completeStep({ ...REMOVED, worktree_removed: false })],
    );

    expect(seenRequests[0].body).toEqual({
      task_id: 'T-7',
      stop_session: true,
      force: true,
      keep_worktree: true,
    });
  });

  it('prints the result object with --json', async () => {
    const { stdout } = await runCliAgainstRequestSequence(
      ['task', 'complete', '--task-id', 'T-7', '--json'],
      [completeStep(REMOVED)],
    );

    expect(JSON.parse(stdout)).toEqual(REMOVED);
  });

  it('reports a kept worktree and an already completed task', async () => {
    const kept = await runCliAgainstRequestSequence(
      ['task', 'complete', '--task-id', 'T-7', '--keep-worktree'],
      [completeStep({ ...REMOVED, worktree_removed: false })],
    );
    expect(kept.stdout.trim()).toBe('Completed T-7 (doing -> done). Kept worktree /repos/web/.worktrees/T-7.');

    const repeat = await runCliAgainstRequestSequence(
      ['task', 'complete', '--task-id', 'T-7'],
      [completeStep({ task_id: 'T-7', previous_status: 'done', status: 'done', worktree_path: null, worktree_removed: false })],
    );
    expect(repeat.stdout.trim()).toBe('T-7 is already completed. Nothing changed.');
  });

  it('exits non-zero with the bridge refusal message', async () => {
    const refusal = 'Task T-7 has a running agent session. Pass --stop-session to stop it and complete the task.';

    await expect(
      runCliAgainstRequestSequence(
        ['task', 'complete', '--task-id', 'T-7'],
        [{ ...completeStep(refusal, 409), contentType: 'text/plain' }],
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(refusal),
    });
  });

  it('requires --task-id before contacting the bridge', async () => {
    await expect(runCli(['task', 'complete'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('missing required flag --task-id'),
    });
  });

  it('is listed in top-level help next to task completed with the difference spelled out', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('openforge task complete --task-id <id> [--stop-session] [--force] [--keep-worktree] [--json]');
    expect(stdout).toContain('task complete marks one started task done');
    expect(stdout).toContain('task completed only lists');
  });
});
