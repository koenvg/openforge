import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  expectCompactTaskRow,
  listen,
  runCli,
  runCliAgainstJsonBridge,
} from './cli-test-utils.js';

describe('OpenForge task list commands', () => {
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
      }],
      nextCursor: 'next-page',
    };
    const result = await runCliAgainstJsonBridge([
      'task', 'completed',
      '--project-id', 'P-1',
      '--cursor', 'cursor-1',
      '--search', 'completed',
      '--label', 'cleanup',
    ], {
      url: '/v2/projects/P-1/tasks/completed?search=completed&labels=cleanup&cursor=cursor-1',
      response: page,
    });

    expect(result).toEqual(page);
    expect(result.tasks[0]).not.toHaveProperty('prompt');
  });


  it('lists compact non-done task rows through the nested task list command', async () => {
    const tasks = [
      {
        id: 'T-1',
        prompt_preview: 'Nested list',
        status: 'backlog',
        labels: [{ id: 1, name: 'cli' }],
        depends_on: ['T-0'],
        updated_at: 400,
      },
    ];

    const result = await runCliAgainstJsonBridge(['task', 'list', '--project-id', 'P-1'], {
      url: '/tasks?project_id=P-1&exclude_done=true&compact=true',
      response: tasks,
    });

    expect(result).toEqual(tasks);
    expectCompactTaskRow(result[0], tasks[0]);
  });

  it('requests compact non-done task rows from list-tasks by default', async () => {
    const tasks = [
      {
        id: 'T-1',
        prompt_preview: 'Open task',
        status: 'backlog',
        labels: [{ id: 1, name: 'cleanup' }],
        depends_on: ['T-0'],
        updated_at: 200,
      },
      {
        id: 'T-2',
        prompt_preview: 'Active task',
        status: 'doing',
        labels: [],
        depends_on: [],
        updated_at: 201,
      },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== '/tasks?project_id=P-1&exclude_done=true&compact=true') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(tasks));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'list', '--project-id', 'P-1'], { OPENFORGE_HTTP_PORT: String(port) });
      const listedTasks = JSON.parse(stdout);

      expect(seenUrl).toBe('/tasks?project_id=P-1&exclude_done=true&compact=true');
      expect(listedTasks).toEqual(tasks);
      for (const task of listedTasks) expectCompactTaskRow(task, task);
    } finally {
      await close(server);
    }
  });

  it('keeps full TaskRow access behind list-tasks --full while still excluding done tasks by default', async () => {
    const tasks = [
      {
        id: 'T-1',
        project_id: 'P-1',
        status: 'backlog',
        initial_prompt: 'Open task',
        prompt: 'Open task\nwith details',
        worktree: '/tmp/openforge/T-1',
        branch: 'task/T-1',
        labels: [{ id: 1, name: 'cleanup' }],
        depends_on: ['T-0'],
        updated_at: 200,
      },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== '/tasks?project_id=P-1&exclude_done=true') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(tasks));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'list', '--project-id', 'P-1', '--full'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(seenUrl).toBe('/tasks?project_id=P-1&exclude_done=true');
      expect(JSON.parse(stdout)).toEqual(tasks);
    } finally {
      await close(server);
    }
  });

  it('keeps explicit done-task access through compact list-tasks --state done', async () => {
    const doneTasks = [
      {
        id: 'T-3',
        prompt_preview: 'Done task',
        status: 'done',
        labels: [{ id: 3, name: 'done-label' }],
        depends_on: ['T-1'],
        updated_at: 203,
      },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== '/tasks?project_id=P-1&state=done&compact=true') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(doneTasks));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'list', '--project-id', 'P-1', '--state', 'done'], { OPENFORGE_HTTP_PORT: String(port) });
      const listedTasks = JSON.parse(stdout);

      expect(seenUrl).toBe('/tasks?project_id=P-1&state=done&compact=true');
      expect(listedTasks).toHaveLength(1);
      expectCompactTaskRow(listedTasks[0], doneTasks[0]);
    } finally {
      await close(server);
    }
  });

  it('keeps explicit done-task full-row access through list-tasks --state done --full', async () => {
    const doneTasks = [
      {
        id: 'T-3',
        project_id: 'P-1',
        status: 'done',
        initial_prompt: 'Done task',
        prompt: 'Done task full prompt',
        worktree: '/tmp/openforge/T-3',
        branch: 'task/T-3',
        labels: [{ id: 3, name: 'done-label' }],
        depends_on: ['T-1'],
        updated_at: 203,
      },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== '/tasks?project_id=P-1&state=done') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(doneTasks));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'list', '--project-id', 'P-1', '--state', 'done', '--full'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(seenUrl).toBe('/tasks?project_id=P-1&state=done');
      expect(JSON.parse(stdout)).toEqual(doneTasks);
    } finally {
      await close(server);
    }
  });

  it.each(['backlog', 'doing'])('keeps explicit %s list-tasks filtering compact and unchanged', async (state) => {
    const tasks = [
      {
        id: `T-${state}`,
        prompt_preview: `${state} task`,
        status: state,
        labels: [{ id: 1, name: state }],
        depends_on: ['T-parent'],
        updated_at: 300,
      },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== `/tasks?project_id=P-1&state=${state}&compact=true`) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(tasks));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['task', 'list', '--project-id', 'P-1', '--state', state], { OPENFORGE_HTTP_PORT: String(port) });
      const listedTasks = JSON.parse(stdout);

      expect(seenUrl).toBe(`/tasks?project_id=P-1&state=${state}&compact=true`);
      expect(listedTasks).toHaveLength(1);
      expectCompactTaskRow(listedTasks[0], tasks[0]);
    } finally {
      await close(server);
    }
  });
});
