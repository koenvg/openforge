import { describe, expect, it } from 'vitest';
import { runCli, runCliAgainstJsonBridge } from './cli-test-utils.js';

describe('OpenForge completed task commands', () => {
  it('lists a canonical fixed Completed Task page with continuation metadata', async () => {
    const page = {
      tasks: [{
        id: 'T-done',
        status: 'done',
        projectId: 'P-1',
        title: 'Completed work',
        promptPreview: 'Completed work',
        dependsOn: [],
        labels: [],
        createdAt: 1,
        updatedAt: 2,
        sourceTicketUrl: null,
        completedAt: 1700000000,
      }],
      nextCursor: 'next-page',
      completionCoverage: { trackedFrom: 1700000000, unknownCompletedTaskCount: 0, rangeStatus: 'complete' },
    };
    const result = await runCliAgainstJsonBridge([
      'task', 'completed',
      '--project-id', 'P-1',
      '--cursor', 'cursor-1',
      '--search', 'completed',
      '--label', 'cleanup',
      '--completed-from', '1700000000',
      '--completed-before', '1700000001',
    ], {
      url: '/v2/projects/P-1/tasks/completed?search=completed&labels=cleanup&cursor=cursor-1&completedFrom=1700000000&completedBefore=1700000001',
      response: page,
    });

    expect(result).toEqual(page);
    expect(result.tasks[0]).not.toHaveProperty('prompt');
  });

  it('rejects unpaired Completed Task period flags before contacting the bridge', async () => {
    await expect(runCli(['task', 'completed', '--project-id', 'P-1', '--completed-from', '1700000000']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('requires both --completed-from and --completed-before') });
  });

});
