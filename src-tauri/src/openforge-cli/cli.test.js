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
    expect(stdout).toContain('list-tasks requests compact non-done task rows unless --state done is passed');
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

  it('deletes tasks through the first-class HTTP bridge endpoint', async () => {
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
        res.end(JSON.stringify({ task_id: 'T-1', status: 'deleted' }));
      });
    });
    const port = await listen(server);

    try {
      const { stdout } = await runCli(['delete-task', '--task-id', 'T-1'], {
        OPENFORGE_HTTP_PORT: String(port),
      });

      expect(JSON.parse(stdout)).toEqual({ task_id: 'T-1', status: 'deleted' });
      expect(seenBody).toEqual({ task_id: 'T-1' });
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

  it('requests non-done compact task rows from list-tasks by default', async () => {
    const tasks = [
      { id: 'T-1', project_id: 'P-1', status: 'backlog' },
      { id: 'T-2', project_id: 'P-1', status: 'doing' },
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

      expect(seenUrl).toBe('/tasks?project_id=P-1&exclude_done=true&compact=true');
      expect(JSON.parse(stdout)).toEqual(tasks);
    } finally {
      await close(server);
    }
  });

  it('keeps explicit done-task access through list-tasks --state done', async () => {
    const doneTasks = [
      { id: 'T-3', project_id: 'P-1', status: 'done', initial_prompt: 'Done task' },
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
      const { stdout } = await runCli(['list-tasks', '--project-id', 'P-1', '--state', 'done'], { OPENFORGE_HTTP_PORT: String(port) });

      expect(seenUrl).toBe('/tasks?project_id=P-1&state=done');
      expect(JSON.parse(stdout)).toEqual(doneTasks);
    } finally {
      await close(server);
    }
  });

  it.each(['backlog', 'doing'])('keeps explicit %s list-tasks filtering unchanged', async (state) => {
    const tasks = [
      { id: `T-${state}`, project_id: 'P-1', status: state, initial_prompt: `${state} task` },
    ];
    let seenUrl = null;
    const server = createServer((req, res) => {
      seenUrl = req.url;
      if (req.url !== `/tasks?project_id=P-1&state=${state}`) {
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

      expect(seenUrl).toBe(`/tasks?project_id=P-1&state=${state}`);
      expect(JSON.parse(stdout)).toEqual(tasks);
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
