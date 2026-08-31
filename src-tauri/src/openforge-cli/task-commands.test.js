import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  listen,
  runCli,
  runCliAgainstJsonBridge,
} from './cli-test-utils.js';

describe('OpenForge task commands', () => {
  it('prints nested task command help before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'create', '--help'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(stdout).toContain('Usage:\n  openforge task create --initial-prompt <text>');
      expect(stdout).not.toContain('Flat compatibility alias:');
      expect(stdout).toContain('Task creation hygiene:');
      expect(stdout).toContain('include useful --label values and dependency links when creating related follow-up Tasks');
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('prints task start help before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'start', '--help'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(stdout).toContain('Usage:\n  openforge task start --task-id <id>');
      expect(stdout).toContain('starts the native configured implementation flow');
      expect(stdout).toContain('dependency and active-session safeguards');
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('documents guarded initial-prompt updates and replacement guidance', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('openforge task update --task-id <id> --initial-prompt <text>');
    expect(stdout).toContain('updates initial_prompt and prompt together only while the task has never started');
    expect(stdout).toContain('create a replacement task instead');
  });

  it('requires the initial prompt and rejects the removed summary flag before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['task', 'update', '--task-id', 'T-1'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('missing required flag --initial-prompt'),
      });
      await expect(
        runCli(['task', 'update', '--task-id', 'T-1', '--summary', 'Summary'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('task update does not support --summary'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('requires task start task-id before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['task', 'start'], { OPENFORGE_HTTP_PORT: String(port) }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('missing required flag --task-id'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('rejects unsupported command flags before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['task', 'create', '--initial-prompt', 'Test task', '--summary', 'Wrong command'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('task create does not support --summary'),
      });
      await expect(
        runCli(['task', 'start', '--task-id', 'T-1', '--provider', 'pi'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('task start does not support --provider'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('creates tasks through the nested task create command with dependency IDs and labels', async () => {
    const result = await runCliAgainstJsonBridge([
      'task',
      'create',
      '--initial-prompt',
      'Nested dependent task',
      '--project-id',
      'P-1',
      '--depends-on',
      'T-1,T-0',
      '--depends-on',
      'T-1',
      '--label',
      'agent-facing,cli',
    ], {
      method: 'POST',
      url: '/create_task',
      expectedBody: {
        initial_prompt: 'Nested dependent task',
        project_id: 'P-1',
        depends_on: ['T-1', 'T-0'],
        labels: ['agent-facing', 'cli'],
      },
      response: { task_id: 'T-3', project_id: 'P-1', status: 'created' },
    });

    expect(result).toEqual({ task_id: 'T-3', project_id: 'P-1', status: 'created' });
  });

  it('starts tasks through the nested task start command and preserves native run details', async () => {
    const response = {
      task_id: 'T-3',
      session_id: 'session-3',
      workspace_path: '/tmp/task-3',
      port: 4321,
    };
    const result = await runCliAgainstJsonBridge(['task', 'start', '--task-id', 'T-3'], {
      method: 'POST',
      url: '/start_task',
      expectedBody: { task_id: 'T-3' },
      response,
    });

    expect(result).toEqual(response);
  });

  it('reports native task start lifecycle failures', async () => {
    const server = createServer((req, res) => {
      if (req.url !== '/start_task' || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task dependency T-2 is not done' }));
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['task', 'start', '--task-id', 'T-3'], { OPENFORGE_HTTP_PORT: String(port) }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('OpenForge HTTP 409: {"error":"Task dependency T-2 is not done"}'),
      });
    } finally {
      await close(server);
    }
  });

  it('updates never-started task prompts through the nested task update command', async () => {
    const result = await runCliAgainstJsonBridge([
      'task',
      'update',
      '--task-id',
      'T-1',
      '--initial-prompt',
      'Replacement prompt',
    ], {
      method: 'POST',
      url: '/update_task',
      expectedBody: { task_id: 'T-1', initial_prompt: 'Replacement prompt' },
      response: { task_id: 'T-1', status: 'updated' },
    });

    expect(result).toEqual({ task_id: 'T-1', status: 'updated' });
  });

  it('reads canonical active, Completed, and detail projections', async () => {
    const active = { tasks: [{ id: 'T-1', projectId: 'P 1', prompt: 'Active' }], related: [] };
    await expect(runCliAgainstJsonBridge(['task', 'active', '--project-id', 'P 1'], {
      url: '/v2/projects/P%201/tasks/active',
      response: active,
    })).resolves.toEqual(active);

    const page = { tasks: [{ id: 'T-2', projectId: 'P 1', promptPreview: 'Done' }], nextCursor: 'opaque' };
    await expect(runCliAgainstJsonBridge([
      'task', 'completed', '--project-id', 'P 1', '--search', 'done now',
      '--label', 'urgent,backend', '--cursor', 'opaque',
    ], {
      url: '/v2/projects/P%201/tasks/completed?search=done+now&labels=urgent&labels=backend&cursor=opaque',
      response: page,
    })).resolves.toEqual(page);

    const detail = { task: { id: 'T/1', projectId: 'P 1', prompt: 'Full prompt' }, related: [] };
    await expect(runCliAgainstJsonBridge([
      'task', 'detail', '--project-id', 'P 1', '--task-id', 'T/1',
    ], {
      url: '/v2/projects/P%201/tasks/T%2F1',
      response: detail,
    })).resolves.toEqual(detail);
  });

  it('retrieves task rows through the nested task get command', async () => {
    const task = {
      id: 'T-1',
      prompt: 'Nested get full prompt',
      prompt_preview: 'Nested get full prompt',
      title: 'Nested get',
      status: 'backlog',
      labels: [],
      depends_on: [],
    };

    const result = await runCliAgainstJsonBridge(['task', 'get', '--task-id', 'T-1'], {
      url: '/task/T-1',
      response: task,
    });

    expect(result).toEqual(task);
  });

  it('manages task labels through the nested task labels group', async () => {
    const labels = [{ id: 2, name: 'nested' }];
    await expect(runCliAgainstJsonBridge(['task', 'labels', 'list', '--task-id', 'T-1'], {
      url: '/task/T-1/labels',
      response: labels,
    })).resolves.toEqual(labels);

    await expect(runCliAgainstJsonBridge(['task', 'labels', 'add', '--task-id', 'T-1', '--label', 'nested'], {
      method: 'POST',
      url: '/add_task_label',
      expectedBody: { task_id: 'T-1', label: 'nested' },
      response: { task_id: 'T-1', label: 'nested', status: 'added' },
    })).resolves.toEqual({ task_id: 'T-1', label: 'nested', status: 'added' });

    await expect(runCliAgainstJsonBridge(['task', 'labels', 'remove', '--task-id', 'T-1', '--label-id', '2'], {
      method: 'POST',
      url: '/remove_task_label',
      expectedBody: { task_id: 'T-1', label_id: 2 },
      response: { task_id: 'T-1', label_id: 2, status: 'removed' },
    })).resolves.toEqual({ task_id: 'T-1', label_id: 2, status: 'removed' });
  });

  it('creates tasks with dependency IDs from repeated and comma-separated depends-on flags', async () => {
    let seenBody = null;
    const server = createServer((req, res) => {
      if (req.url !== '/create_task' || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seenBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ task_id: 'T-2', project_id: 'P-1', status: 'created' }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli([
        'task',
        'create',
        '--initial-prompt',
        'Dependent task',
        '--project-id',
        'P-1',
        '--depends-on',
        'T-1,T-0',
        '--depends-on',
        'T-1',
      ], { OPENFORGE_HTTP_PORT: String(port) });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-2', project_id: 'P-1', status: 'created' });
      expect(seenBody).toEqual({
        initial_prompt: 'Dependent task',
        project_id: 'P-1',
        depends_on: ['T-1', 'T-0'],
      });
    } finally {
      await close(server);
    }
  });

  it('completes tasks through the first-class HTTP bridge endpoint', async () => {
    let seenBody = null;
    const server = createServer((req, res) => {
      if (req.url !== '/delete_task' || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seenBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ task_id: 'T-1', status: 'completed' }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'delete', '--task-id', 'T-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-1', status: 'completed' });
      expect(seenBody).toEqual({ task_id: 'T-1' });
    } finally {
      await close(server);
    }
  });

  it('keeps completed tasks reachable through get-task and explicit done lists', async () => {
    let completed = false;
    const completedTask = {
      id: 'T-1',
      initial_prompt: 'Completed prompt',
      prompt: 'Full prompt kept for agents',
      status: 'done',
      depends_on: [],
      labels: [],
    };
    const openTask = {
      id: 'T-2',
      prompt_preview: 'Open task',
      status: 'backlog',
      labels: [],
      depends_on: [],
      updated_at: 300,
    };
    const server = createServer((req, res) => {
      if (req.url === '/delete_task' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          expect(JSON.parse(body)).toEqual({ task_id: 'T-1' });
          completed = true;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'T-1', status: 'completed' }));
        });
        return;
      }

      if (req.url === '/task/T-1' && req.method === 'GET' && completed) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(completedTask));
        return;
      }

      if (req.url === '/tasks?project_id=P-1&exclude_done=true&compact=true' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([openTask]));
        return;
      }

      if (req.url === '/tasks?project_id=P-1&state=done&compact=true' && req.method === 'GET' && completed) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: completedTask.id,
            prompt_preview: completedTask.initial_prompt,
            status: completedTask.status,
            labels: completedTask.labels,
            depends_on: completedTask.depends_on,
            updated_at: 301,
          },
        ]));
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    const port = await listen(server);

    try {
      await runCli(['task', 'delete', '--task-id', 'T-1'], { OPENFORGE_HTTP_PORT: String(port) });

      const { stdout: getTaskStdout } = await runCli(['task', 'get', '--task-id', 'T-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });
      expect(JSON.parse(getTaskStdout)).toEqual(completedTask);

      const { stdout: normalListStdout } = await runCli(['task', 'list', '--project-id', 'P-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });
      expect(JSON.parse(normalListStdout)).toEqual([openTask]);

      const { stdout: doneListStdout } = await runCli(['task', 'list', '--project-id', 'P-1', '--state', 'done'], {
        OPENFORGE_HTTP_PORT: String(port),
      });
      const doneTasks = JSON.parse(doneListStdout);
      expect(doneTasks).toHaveLength(1);
      expect(doneTasks[0]).toMatchObject({ id: 'T-1', status: 'done' });
    } finally {
      await close(server);
    }
  });

  it('rejects delete-task without task-id before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(['task', 'delete'], { OPENFORGE_HTTP_PORT: String(port) })).rejects.toMatchObject({
        stderr: expect.stringContaining('missing required flag --task-id'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('updates initial prompts without sending removed task fields', async () => {
    let seenBody = null;
    const server = createServer((req, res) => {
      if (req.url !== '/update_task' || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seenBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ task_id: 'T-1', status: 'updated' }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'update', '--task-id', 'T-1', '--initial-prompt', 'Done'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-1', status: 'updated' });
      expect(seenBody).toEqual({ task_id: 'T-1', initial_prompt: 'Done' });
    } finally {
      await close(server);
    }
  });
});
