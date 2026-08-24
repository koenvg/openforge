import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  listen,
  runCli,
  runCliAgainstRequestSequence,
  writePlanFile,
} from './cli-test-utils.js';

describe('OpenForge task plan commands', () => {
  it('prints nested task plan apply help before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'plan', 'apply', '--help'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(stdout).toContain('Usage:\n  openforge task plan apply --file <plan.json>');
      expect(stdout).toContain('preferred workflow for non-linear multi-Task follow-up work');
      expect(stdout).toContain('Plan JSON shape:');
      expect(stdout).toContain('"projectId": "P-1"');
      expect(stdout).toContain('"dependsOn": ["api", "KVG-1957"]');
      expect(stdout).toContain('dependsOn is where current or prerequisite task IDs go');
      expect(stdout).not.toContain('"worktree"');
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('applies a JSON task plan, resolves local dependency keys, and returns a key-to-task-id mapping', async () => {
    const planPath = await writePlanFile('valid', {
      projectId: 'P-1',
      tasks: [
        { key: 'api', prompt: 'Build API task', labels: ['backend'] },
        { key: 'ui', prompt: 'Build UI task', labels: ['frontend', 'review'], dependsOn: ['api', 'KVG-1'] },
      ],
    });

    const { stdout, seenRequests } = await runCliAgainstRequestSequence([
      'task',
      'plan',
      'apply',
      '--file',
      planPath,
    ], [
      {
        method: 'POST',
        url: '/create_task',
        response: { task_id: 'KVG-10', project_id: 'P-1', status: 'created' },
      },
      {
        method: 'POST',
        url: '/create_task',
        response: { task_id: 'KVG-11', project_id: 'P-1', status: 'created' },
      },
      {
        method: 'POST',
        url: '/set_task_dependencies',
        response: { task_id: 'KVG-11', status: 'updated' },
      },
    ]);

    expect(seenRequests).toEqual([
      {
        method: 'POST',
        url: '/create_task',
        body: { initial_prompt: 'Build API task', project_id: 'P-1', labels: ['backend'] },
      },
      {
        method: 'POST',
        url: '/create_task',
        body: { initial_prompt: 'Build UI task', project_id: 'P-1', labels: ['frontend', 'review'] },
      },
      {
        method: 'POST',
        url: '/set_task_dependencies',
        body: { task_id: 'KVG-11', depends_on: ['KVG-10', 'KVG-1'] },
      },
    ]);
    expect(JSON.parse(stdout)).toEqual({
      status: 'created',
      tasks: { api: 'KVG-10', ui: 'KVG-11' },
      created: [
        { key: 'api', task_id: 'KVG-10' },
        { key: 'ui', task_id: 'KVG-11' },
      ],
      dependencies: [
        { key: 'ui', task_id: 'KVG-11', depends_on: ['KVG-10', 'KVG-1'], status: 'updated' },
      ],
    });
  });

  it('rejects worktree in task plans before contacting the HTTP bridge', async () => {
    const planPath = await writePlanFile('worktree', {
      projectId: 'P-1',
      worktree: '/repo',
      tasks: [{ key: 'api', prompt: 'Build API task' }],
    });
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(['task', 'plan', 'apply', '--file', planPath], {
        OPENFORGE_HTTP_PORT: String(port),
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('task plan worktree is not supported'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('rejects per-task worktree in task plans before contacting the HTTP bridge', async () => {
    const planPath = await writePlanFile('task-worktree', {
      projectId: 'P-1',
      tasks: [{ key: 'api', prompt: 'Build API task', worktree: '/repo' }],
    });
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(['task', 'plan', 'apply', '--file', planPath], {
        OPENFORGE_HTTP_PORT: String(port),
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('task plan tasks[0].worktree is not supported'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('rejects invalid JSON task plans before contacting the HTTP bridge', async () => {
    const planPath = await writePlanFile('invalid', {
      tasks: [
        { key: 'api', prompt: 'Build API task' },
        { key: 'ui', prompt: 'Build UI task', dependsOn: ['missing'] },
      ],
    });
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(['task', 'plan', 'apply', '--file', planPath], {
        OPENFORGE_HTTP_PORT: String(port),
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('unknown dependsOn key "missing"'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('rolls back created tasks when task plan dependency linking fails', async () => {
    const planPath = await writePlanFile('rollback', {
      tasks: [
        { key: 'api', prompt: 'Build API task' },
        { key: 'ui', prompt: 'Build UI task', dependsOn: ['api'] },
      ],
    });

    let seenRequests = [];
    try {
      await runCliAgainstRequestSequence([
        'task',
        'plan',
        'apply',
        '--file',
        planPath,
      ], [
        { method: 'POST', url: '/create_task', response: { task_id: 'KVG-20', status: 'created' } },
        { method: 'POST', url: '/create_task', response: { task_id: 'KVG-21', status: 'created' } },
        { method: 'POST', url: '/set_task_dependencies', statusCode: 500, response: { error: 'dependency write failed' } },
        { method: 'POST', url: '/hard_delete_task', response: { task_id: 'KVG-21', status: 'deleted' } },
        { method: 'POST', url: '/hard_delete_task', response: { task_id: 'KVG-20', status: 'deleted' } },
      ]);
      throw new Error('expected task plan apply to fail');
    } catch (error) {
      seenRequests = error.seenRequests ?? [];
      expect(error.stderr).toContain('rolled back created tasks: KVG-21,KVG-20');
    }

    expect(seenRequests).toEqual([
      { method: 'POST', url: '/create_task', body: { initial_prompt: 'Build API task' } },
      { method: 'POST', url: '/create_task', body: { initial_prompt: 'Build UI task' } },
      { method: 'POST', url: '/set_task_dependencies', body: { task_id: 'KVG-21', depends_on: ['KVG-20'] } },
      { method: 'POST', url: '/hard_delete_task', body: { task_id: 'KVG-21' } },
      { method: 'POST', url: '/hard_delete_task', body: { task_id: 'KVG-20' } },
    ]);
  });
});
