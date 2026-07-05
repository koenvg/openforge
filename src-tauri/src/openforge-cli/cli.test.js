import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve(process.cwd(), 'src-tauri/src/openforge-cli/cli.js');
const SKILL_PATH = resolve(process.cwd(), 'src-tauri/src/openforge-cli/openforge-skill.md');
const CLI_TEST_LOCAL_STORAGE_FILE = join(tmpdir(), `openforge-cli-vitest-${process.pid}.localstorage`);

function normalizeNodeOptionsForCliBridgeTests(nodeOptions) {
  if (!nodeOptions) return undefined;

  const tokens = nodeOptions.split(/\s+/u).filter(Boolean);
  const normalized = [];
  let sawWebStorageOption = false;
  let hasValidLocalStorageFile = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === '--experimental-webstorage') {
      sawWebStorageOption = true;
      normalized.push(token);
      continue;
    }

    if (token === '--localstorage-file') {
      sawWebStorageOption = true;
      const value = tokens[i + 1];
      if (value && !value.startsWith('--')) {
        normalized.push(token, value);
        hasValidLocalStorageFile = true;
        i += 1;
      }
      continue;
    }

    if (token.startsWith('--localstorage-file=')) {
      sawWebStorageOption = true;
      if (token.slice('--localstorage-file='.length)) {
        normalized.push(token);
        hasValidLocalStorageFile = true;
      }
      continue;
    }

    normalized.push(token);
  }

  if (sawWebStorageOption && !hasValidLocalStorageFile) {
    normalized.push('--localstorage-file', CLI_TEST_LOCAL_STORAGE_FILE);
  }

  if (sawWebStorageOption && !normalized.includes('--disable-warning=ExperimentalWarning')) {
    normalized.push('--disable-warning=ExperimentalWarning');
  }

  return normalized.length > 0 ? normalized.join(' ') : undefined;
}

function buildCliBridgeTestEnv(env = {}) {
  const merged = { ...process.env, ...env };
  const normalizedNodeOptions = normalizeNodeOptionsForCliBridgeTests(merged.NODE_OPTIONS);
  if (normalizedNodeOptions) {
    merged.NODE_OPTIONS = normalizedNodeOptions;
  } else {
    delete merged.NODE_OPTIONS;
  }
  return merged;
}

async function runCli(args, env = {}) {
  return execFileAsync('node', [CLI_PATH, ...args], {
    env: buildCliBridgeTestEnv(env),
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

const COMPACT_TASK_KEYS = ['depends_on', 'id', 'labels', 'prompt_preview', 'status', 'updated_at'];
const VERBOSE_TASK_KEYS = [
  'initial_prompt',
  'prompt',
  'summary',
  'worktree',
  'branch',
  'project_id',
  'created_at',
];

function expectCompactTaskRow(row, expected) {
  expect(Object.keys(row).sort()).toEqual([...COMPACT_TASK_KEYS].sort());
  expect(row).toMatchObject(expected);
  expect(row.prompt_preview.length).toBeLessThanOrEqual(120);
  for (const key of VERBOSE_TASK_KEYS) {
    expect(row).not.toHaveProperty(key);
  }
}

describe('OpenForge CLI', () => {
  it('keeps the auto-installed task-management skill concise while covering safe commands', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');

    for (const command of [
      'openforge create-task',
      'openforge update-task',
      'openforge delete-task',
      'openforge get-task',
      'openforge list-tasks',
      'openforge list-task-labels',
      'openforge add-task-label',
      'openforge remove-task-label',
    ]) {
      expect(skill).toContain(command);
    }
    expect(skill).toContain('openforge create-task --help');
    expect(skill).toContain('openforge update-task --help');
    expect(skill).toContain('Before creating follow-up Tasks');
    expect(skill).toContain('When creating multiple related Tasks');
    expect(skill).toContain('Use labels to record task categories');
    expect(skill.match(/openforge get-task/g)).toHaveLength(1);
    expect(skill.match(/openforge list-task-labels/g)).toHaveLength(1);
    expect(skill).not.toContain('reverse dependents');
    expect(skill).not.toContain('repoint each dependent');
    expect(skill).not.toContain('Correct task prompt');
  });

  it('prints launcher-based help without the MCP command', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('Usage:\n  openforge create-task');
    expect(stdout).toContain('openforge delete-task --task-id <id>');
    expect(stdout).toContain('openforge list-projects');
    expect(stdout).toContain('list-tasks prints compact rows by default');
    expect(stdout).toContain('Pass --full to print complete TaskRow objects');
    expect(stdout).toContain('list-tasks excludes done tasks unless --state done is passed');
    expect(stdout).toContain('Task creation hygiene:');
    expect(stdout).toContain('include useful --label values when the category is obvious');
    expect(stdout).toContain('link prerequisites immediately with --depends-on or link-tasks');
    expect(stdout).not.toContain('node cli.js');
    expect(stdout).not.toContain('openforge mcp');
  });

  it.each([
    ['empty assignment', '--experimental-webstorage --localstorage-file='],
    ['bare flag', '--experimental-webstorage --localstorage-file'],
  ])('keeps inherited Node web storage options with %s from breaking CLI bridge child processes', async (_label, nodeOptions) => {
    const { stdout, stderr } = await runCli(['--help'], {
      NODE_OPTIONS: nodeOptions,
    });

    expect(stdout).toContain('Usage:\n  openforge create-task');
    expect(stderr).not.toContain('--localstorage-file');
  });

  it.each([
    ['empty assignment', '--experimental-webstorage --localstorage-file='],
    ['bare flag', '--experimental-webstorage --localstorage-file'],
  ])('provides a valid localStorage backing file for inherited Node web storage options with %s', async (_label, nodeOptions) => {
    const { stdout, stderr } = await execFileAsync('node', [
      '--eval',
      "localStorage.setItem('openforge-cli-test', 'ok'); console.log(localStorage.getItem('openforge-cli-test'))",
    ], {
      env: buildCliBridgeTestEnv({ NODE_OPTIONS: nodeOptions }),
    });

    expect(stdout.trim()).toBe('ok');
    expect(stderr).toBe('');
  });

  it('prints help for command-specific --help before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['create-task', '--help'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(stdout).toContain('Usage:\n  openforge create-task');
      expect(stdout).toContain('openforge update-task --task-id <id> --summary <text>');
      expect(stdout).toContain('openforge delete-task --task-id <id>');
      expect(stdout).toContain('update-task updates only the task summary/handoff notes');
      expect(stdout).toContain('reverse dependents');
      expect(stdout).toContain('Task creation hygiene:');
      expect(stdout).toContain('link prerequisites immediately with --depends-on or link-tasks');
      expect(stdout).toContain('set-task-dependencies');
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('does not expose mcp as a CLI command', async () => {
    await expect(runCli(['mcp'])).rejects.toMatchObject({
      stderr: expect.stringContaining('unknown command: mcp'),
    });
  });

  it('prints update-task help without initial-prompt support', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('openforge update-task --task-id <id> --summary <text>');
    expect(stdout).toContain('update-task does not change initial_prompt or prompt');
    expect(stdout).toContain('finding depends_on entries containing the old id');
    expect(stdout).not.toContain('update-task --task-id <id> [--initial-prompt <text>]');
  });

  it('rejects update-task initial-prompt updates before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['update-task', '--task-id', 'T-1', '--initial-prompt'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('update-task does not support --initial-prompt'),
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
        runCli(['create-task', '--initial-prompt', 'Test task', '--summary', 'Wrong command'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('create-task does not support --summary'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
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
        'create-task',
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

  it('sets dependencies for an existing task', async () => {
    let seenBody = null;
    const server = createServer((req, res) => {
      if (req.url !== '/set_task_dependencies' || req.method !== 'POST') {
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
        res.end(JSON.stringify({ task_id: 'T-2', status: 'updated' }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli([
        'set-task-dependencies',
        '--task-id',
        'T-2',
        '--depends-on',
        'T-1,T-0',
      ], { OPENFORGE_HTTP_PORT: String(port) });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-2', status: 'updated' });
      expect(seenBody).toEqual({ task_id: 'T-2', depends_on: ['T-1', 'T-0'] });
    } finally {
      await close(server);
    }
  });

  it('links task chains through one atomic bridge request', async () => {
    let seenBody = null;
    const server = createServer((req, res) => {
      if (req.url !== '/link_task_chain' || req.method !== 'POST') {
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
        res.end(JSON.stringify({
          status: 'updated',
          links: [
            { task_id: 'KVG-1133', depends_on: 'KVG-1129' },
            { task_id: 'KVG-1131', depends_on: 'KVG-1133' },
          ],
        }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli([
        'link-tasks',
        '--chain',
        'KVG-1129 -> KVG-1133 -> KVG-1131',
      ], { OPENFORGE_HTTP_PORT: String(port) });

      expect(JSON.parse(stdout)).toEqual({
        status: 'updated',
        links: [
          { task_id: 'KVG-1133', depends_on: 'KVG-1129' },
          { task_id: 'KVG-1131', depends_on: 'KVG-1133' },
        ],
      });
      expect(seenBody).toEqual({ chain: ['KVG-1129', 'KVG-1133', 'KVG-1131'] });
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
      const { stdout } = await runCli(['delete-task', '--task-id', 'T-1'], {
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
      summary: '## Handoff Notes\nKeep this reference',
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
      await runCli(['delete-task', '--task-id', 'T-1'], { OPENFORGE_HTTP_PORT: String(port) });

      const { stdout: getTaskStdout } = await runCli(['get-task', '--task-id', 'T-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });
      expect(JSON.parse(getTaskStdout)).toEqual(completedTask);

      const { stdout: normalListStdout } = await runCli(['list-tasks', '--project-id', 'P-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });
      expect(JSON.parse(normalListStdout)).toEqual([openTask]);

      const { stdout: doneListStdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--state', 'done'], {
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
      await expect(runCli(['delete-task'], { OPENFORGE_HTTP_PORT: String(port) })).rejects.toMatchObject({
        stderr: expect.stringContaining('missing required flag --task-id'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('updates task summaries without sending initial_prompt', async () => {
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
      const { stdout } = await runCli(['update-task', '--task-id', 'T-1', '--summary', 'Done'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-1', status: 'updated' });
      expect(seenBody).toEqual({ task_id: 'T-1', summary: 'Done' });
    } finally {
      await close(server);
    }
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1'], { OPENFORGE_HTTP_PORT: String(port) });
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
        summary: '## Current summary\nDetailed handoff notes',
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--full'], {
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--state', 'done'], { OPENFORGE_HTTP_PORT: String(port) });
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
        summary: 'Done handoff notes',
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--state', 'done', '--full'], {
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--state', state], { OPENFORGE_HTTP_PORT: String(port) });
      const listedTasks = JSON.parse(stdout);

      expect(seenUrl).toBe(`/tasks?project_id=P-1&state=${state}&compact=true`);
      expect(listedTasks).toHaveLength(1);
      expectCompactTaskRow(listedTasks[0], tasks[0]);
    } finally {
      await close(server);
    }
  });

  it('lists projects from the HTTP bridge', async () => {
    const projects = [
      { id: 'P-2', name: 'Second', path: '/tmp/second', created_at: 2, updated_at: 3 },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== '/projects') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(projects));
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['list-projects'], { OPENFORGE_HTTP_PORT: String(port) });

      expect(seenUrl).toBe('/projects');
      expect(JSON.parse(stdout)).toEqual(projects);
    } finally {
      await close(server);
    }
  });
});
