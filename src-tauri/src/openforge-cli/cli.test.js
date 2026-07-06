import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
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

async function runCliAgainstJsonBridge(args, { url, method = 'GET', response = { ok: true }, expectedBody = null } = {}) {
  let seenRequest = null;
  const server = createServer((req, res) => {
    if (req.url !== url || req.method !== method) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seenRequest = {
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  const port = await listen(server);

  try {
    const { stdout } = await runCli(args, { OPENFORGE_HTTP_PORT: String(port) });
    expect(seenRequest).toEqual({ method, url, body: expectedBody });
    return JSON.parse(stdout);
  } finally {
    await close(server);
  }
}

async function writePlanFile(name, plan) {
  const planPath = join(tmpdir(), `openforge-cli-plan-${process.pid}-${name}.json`);
  await writeFile(planPath, JSON.stringify(plan), 'utf8');
  return planPath;
}

async function runCliAgainstRequestSequence(args, steps, env = {}) {
  const seenRequests = [];
  const server = createServer((req, res) => {
    const step = steps[seenRequests.length];
    if (!step || req.url !== step.url || req.method !== step.method) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seenRequests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(step.statusCode ?? 200, { 'content-type': step.contentType ?? 'application/json' });
      res.end(typeof step.response === 'string' ? step.response : JSON.stringify(step.response));
    });
  });
  const port = await listen(server);

  try {
    const result = await runCli(args, { ...env, OPENFORGE_HTTP_PORT: String(port) });
    return { ...result, seenRequests };
  } catch (error) {
    error.seenRequests = seenRequests;
    throw error;
  } finally {
    await close(server);
  }
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
      'openforge task create',
      'openforge task update',
      'openforge task delete',
      'openforge task get',
      'openforge task list',
      'openforge project labels list',
      'openforge task labels list',
      'openforge task labels add',
      'openforge task labels remove',
    ]) {
      expect(skill).toContain(command);
    }
    expect(skill).toContain('openforge task create --help');
    expect(skill).toContain('openforge task update --help');
    expect(skill).toContain('Before creating follow-up Tasks');
    expect(skill).toContain('add useful --label values and dependency links');
    expect(skill).toContain('When creating multiple related Tasks');
    expect(skill).toContain('openforge task plan apply --file');
    expect(skill).toContain('Plan JSON shape');
    expect(skill).toContain('Use dependsOn for current or prerequisite task IDs');
    expect(skill).toContain('Use labels to record task categories');
    for (const removedAlias of [
      'openforge create-task',
      'openforge update-task',
      'openforge delete-task',
      'openforge get-task',
      'openforge list-tasks',
      'openforge list-project-labels',
      'openforge list-task-labels',
    ]) {
      expect(skill).not.toContain(removedAlias);
    }
    expect(skill).not.toContain('reverse dependents');
    expect(skill).not.toContain('repoint each dependent');
    expect(skill).not.toContain('Correct task prompt');
  });

  it('prints launcher-based help without the MCP command', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('Usage:\n  openforge task create');
    expect(stdout).toContain('openforge task delete --task-id <id>');
    expect(stdout).toContain('openforge project list');
    expect(stdout).toContain('openforge project labels list --project-id <id>');
    expect(stdout).toContain('task list prints compact rows by default');
    expect(stdout).toContain('Pass --full to print complete TaskRow objects');
    expect(stdout).toContain('task list excludes done tasks unless --state done is passed');
    expect(stdout).toContain('Task creation hygiene:');
    expect(stdout).toContain('include useful --label values and dependency links when creating related follow-up Tasks');
    expect(stdout).toContain('link prerequisites immediately with --depends-on or task dependencies link');
    expect(stdout).toContain('openforge task plan apply --file <plan.json>');
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

    expect(stdout).toContain('Usage:\n  openforge task create');
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

  it('rejects removed flat aliases before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      for (const removedAlias of ['create-task', 'list-projects', 'list-project-labels']) {
        await expect(runCli([removedAlias, '--help'], {
          OPENFORGE_HTTP_PORT: String(port),
        })).rejects.toMatchObject({
          stderr: expect.stringContaining(`unknown command: ${removedAlias}`),
        });
      }
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('prints canonical CLI commands and local-only plugin install guidance', async () => {
    const { stdout } = await runCli(['--help']);

    for (const command of [
      'openforge task create --initial-prompt <text>',
      'openforge task update --task-id <id> --summary <text>',
      'openforge task list --project-id <id>',
      'openforge task get --task-id <id>',
      'openforge task labels list --task-id <id>',
      'openforge task labels add --task-id <id> --label <name>',
      'openforge task labels remove --task-id <id> --label-id <id>',
      'openforge task dependencies set --task-id <id> --depends-on <task-id>',
      'openforge task dependencies add --task-id <id> --depends-on <task-id>',
      'openforge project list',
      'openforge project labels list --project-id <id>',
      'openforge plugin install --path <local-plugin-source>',
      'openforge plugin enable --plugin-id <id> --project-id <id>',
      'openforge plugin disable --plugin-id <id> --project-id <id>',
      'openforge plugin reload --plugin-id <id> [--project-id <id>]',
      'openforge task plan apply --file <plan.json>',
    ]) {
      expect(stdout).toContain(command);
    }

    expect(stdout).toContain('Plugin Installation is local-only for now');
    expect(stdout).toContain('Local Plugin Source');
    expect(stdout).not.toContain('Flat compatibility aliases:');
    expect(stdout).not.toContain('openforge create-task');
    expect(stdout).not.toContain('openforge list-projects');
    expect(stdout).not.toContain('openforge list-project-labels');
    expect(stdout).not.toContain('openforge plugin install --npm');
    expect(stdout).not.toContain('openforge plugin install --git');
    expect(stdout).not.toContain('openforge plugin install --source');
  });

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

  it('does not expose mcp as a CLI command', async () => {
    await expect(runCli(['mcp'])).rejects.toMatchObject({
      stderr: expect.stringContaining('unknown command: mcp'),
    });
  });

  it('prints task update help without initial-prompt support', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('openforge task update --task-id <id> --summary <text>');
    expect(stdout).toContain('task update does not change initial_prompt or prompt');
    expect(stdout).toContain('finding depends_on entries containing the old id');
    expect(stdout).not.toContain('task update --task-id <id> [--initial-prompt <text>]');
  });

  it('rejects task update initial-prompt updates before contacting the HTTP bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(
        runCli(['task', 'update', '--task-id', 'T-1', '--initial-prompt'], {
          OPENFORGE_HTTP_PORT: String(port),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('task update does not support --initial-prompt'),
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

  it('updates task summaries through the nested task update command', async () => {
    const result = await runCliAgainstJsonBridge([
      'task',
      'update',
      '--task-id',
      'T-1',
      '--summary',
      'Nested summary',
    ], {
      method: 'POST',
      url: '/update_task',
      expectedBody: { task_id: 'T-1', summary: 'Nested summary' },
      response: { task_id: 'T-1', status: 'updated' },
    });

    expect(result).toEqual({ task_id: 'T-1', status: 'updated' });
  });

  it('retrieves task rows through the nested task get command', async () => {
    const task = {
      id: 'T-1',
      initial_prompt: 'Nested get',
      prompt: 'Nested get full prompt',
      summary: 'Nested handoff',
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

  it('manages task dependencies through the nested task dependencies group', async () => {
    await expect(runCliAgainstJsonBridge([
      'task',
      'dependencies',
      'set',
      '--task-id',
      'T-2',
      '--depends-on',
      'T-1,T-0',
    ], {
      method: 'POST',
      url: '/set_task_dependencies',
      expectedBody: { task_id: 'T-2', depends_on: ['T-1', 'T-0'] },
      response: { task_id: 'T-2', status: 'updated' },
    })).resolves.toEqual({ task_id: 'T-2', status: 'updated' });

    await expect(runCliAgainstJsonBridge([
      'task',
      'dependencies',
      'add',
      '--task-id',
      'T-2',
      '--depends-on',
      'T-1',
    ], {
      method: 'POST',
      url: '/add_task_dependency',
      expectedBody: { task_id: 'T-2', depends_on: 'T-1' },
      response: { task_id: 'T-2', depends_on: 'T-1', status: 'updated' },
    })).resolves.toEqual({ task_id: 'T-2', depends_on: 'T-1', status: 'updated' });

    await expect(runCliAgainstJsonBridge([
      'task',
      'dependencies',
      'link',
      '--chain',
      'T-0 -> T-1 -> T-2',
    ], {
      method: 'POST',
      url: '/link_task_chain',
      expectedBody: { chain: ['T-0', 'T-1', 'T-2'] },
      response: {
        status: 'updated',
        links: [
          { task_id: 'T-1', depends_on: 'T-0' },
          { task_id: 'T-2', depends_on: 'T-1' },
        ],
      },
    })).resolves.toEqual({
      status: 'updated',
      links: [
        { task_id: 'T-1', depends_on: 'T-0' },
        { task_id: 'T-2', depends_on: 'T-1' },
      ],
    });
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

  it('lists projects through the nested project list command', async () => {
    const projects = [{ id: 'P-1', name: 'Nested', path: '/tmp/nested', created_at: 1, updated_at: 2 }];

    const result = await runCliAgainstJsonBridge(['project', 'list'], {
      url: '/projects',
      response: projects,
    });

    expect(result).toEqual(projects);
  });

  it('lists project labels through the canonical nested project label command', async () => {
    const labels = [
      { id: 1, project_id: 'P-1', name: 'bug' },
      { id: 2, project_id: 'P-1', name: 'cleanup' },
    ];

    await expect(runCliAgainstJsonBridge(['project', 'labels', 'list', '--project-id', 'P-1'], {
      url: '/project/P-1/labels',
      response: labels,
    })).resolves.toEqual(labels);
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
        'task',
        'dependencies',
        'set',
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
        'task',
        'dependencies',
        'link',
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
      const { stdout } = await runCli(['task', 'update', '--task-id', 'T-1', '--summary', 'Done'], {
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
      const { stdout } = await runCli(['project', 'list'], { OPENFORGE_HTTP_PORT: String(port) });

      expect(seenUrl).toBe('/projects');
      expect(JSON.parse(stdout)).toEqual(projects);
    } finally {
      await close(server);
    }
  });

  it('installs local plugin packages through the nested plugin install command only after an explicit path', async () => {
    const row = {
      id: 'review-helper',
      name: 'Review Helper',
      version: '1.0.0',
      api_version: '1',
      description: null,
      permissions: '[]',
      install_path: '/Users/me/openforge-plugins/review-helper',
      frontend_entry: './dist/frontend.js',
      backend_entry: null,
      contributes: '{}',
      is_builtin: false,
      source_kind: 'local',
      source_spec: '/Users/me/openforge-plugins/review-helper',
      package_metadata: '{"id":"review-helper","apiVersion":"1","displayName":"Review Helper"}',
      installed_at: 123,
    };

    const result = await runCliAgainstJsonBridge([
      'plugin',
      'install',
      '--path',
      '/Users/me/openforge-plugins/review-helper',
    ], {
      method: 'POST',
      url: '/install_plugin_from_local',
      expectedBody: { sourcePath: '/Users/me/openforge-plugins/review-helper' },
      response: row,
    });

    expect(result).toEqual(row);
  });

  it.each([
    ['npm flag', ['plugin', 'install', '--npm', '@acme/openforge-helper']],
    ['git flag', ['plugin', 'install', '--git', 'github.com/acme/openforge-helper@main']],
    ['generic source spec flag', ['plugin', 'install', '--source', 'npm:@acme/openforge-helper']],
    ['npm source spec positional', ['plugin', 'install', 'npm:@acme/openforge-helper']],
    ['git source spec positional', ['plugin', 'install', 'git:github.com/acme/openforge-helper@main']],
  ])('rejects plugin install %s before contacting the HTTP bridge', async (_label, args) => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(args, { OPENFORGE_HTTP_PORT: String(port) })).rejects.toMatchObject({
        stderr: expect.stringContaining('plugin install supports local Plugin Installation only; pass --path <local-plugin-source>'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('enables and disables installed plugins for a project through nested plugin commands', async () => {
    await expect(runCliAgainstJsonBridge([
      'plugin',
      'enable',
      '--plugin-id',
      'review-helper',
      '--project-id',
      'P-1',
    ], {
      method: 'POST',
      url: '/set_plugin_enabled',
      expectedBody: { pluginId: 'review-helper', projectId: 'P-1', enabled: true },
      response: { plugin_id: 'review-helper', project_id: 'P-1', enabled: true },
    })).resolves.toEqual({ plugin_id: 'review-helper', project_id: 'P-1', enabled: true });

    await expect(runCliAgainstJsonBridge([
      'plugin',
      'disable',
      '--plugin-id',
      'review-helper',
      '--project-id',
      'P-1',
    ], {
      method: 'POST',
      url: '/set_plugin_enabled',
      expectedBody: { pluginId: 'review-helper', projectId: 'P-1', enabled: false },
      response: { plugin_id: 'review-helper', project_id: 'P-1', enabled: false },
    })).resolves.toEqual({ plugin_id: 'review-helper', project_id: 'P-1', enabled: false });
  });

  it('reloads installed plugin artifacts globally or for one project through nested plugin reload', async () => {
    await expect(runCliAgainstJsonBridge([
      'plugin',
      'reload',
      '--plugin-id',
      'review-helper',
    ], {
      method: 'POST',
      url: '/reload_plugin',
      expectedBody: { pluginId: 'review-helper' },
      response: { plugin_id: 'review-helper', reloaded: true },
    })).resolves.toEqual({ plugin_id: 'review-helper', reloaded: true });

    await expect(runCliAgainstJsonBridge([
      'plugin',
      'reload',
      '--plugin-id',
      'review-helper',
      '--project-id',
      'P-1',
    ], {
      method: 'POST',
      url: '/reload_plugin',
      expectedBody: { pluginId: 'review-helper', projectId: 'P-1' },
      response: { plugin_id: 'review-helper', project_id: 'P-1', reloaded: true },
    })).resolves.toEqual({ plugin_id: 'review-helper', project_id: 'P-1', reloaded: true });
  });

  it('rejects plugin reload source inputs so reload only targets installed artifacts', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli([
        'plugin',
        'reload',
        '--plugin-id',
        'review-helper',
        '--path',
        '/Users/me/openforge-plugins/review-helper',
      ], { OPENFORGE_HTTP_PORT: String(port) })).rejects.toMatchObject({
        stderr: expect.stringContaining('plugin reload uses installed Plugin Installation artifacts only'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });
});
