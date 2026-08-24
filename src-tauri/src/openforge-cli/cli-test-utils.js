import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

export const execFileAsync = promisify(execFile);
export const CLI_PATH = resolve(process.cwd(), 'src-tauri/src/openforge-cli/cli.js');
export const SKILL_PATH = resolve(process.cwd(), 'src-tauri/src/openforge-cli/openforge-skill.md');
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

export function buildCliBridgeTestEnv(env = {}) {
  const merged = { ...process.env, ...env };
  const normalizedNodeOptions = normalizeNodeOptionsForCliBridgeTests(merged.NODE_OPTIONS);
  if (normalizedNodeOptions) {
    merged.NODE_OPTIONS = normalizedNodeOptions;
  } else {
    delete merged.NODE_OPTIONS;
  }
  return merged;
}

export async function runCli(args, env = {}, cliPath = CLI_PATH) {
  return execFileAsync('node', [cliPath, ...args], {
    env: buildCliBridgeTestEnv(env),
  });
}

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

export function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

export async function runCliAgainstJsonBridge(args, { url, method = 'GET', response = { ok: true }, expectedBody = null, env = {} } = {}) {
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
    const { stdout } = await runCli(args, { ...env, OPENFORGE_HTTP_PORT: String(port) });
    expect(seenRequest).toEqual({ method, url, body: expectedBody });
    return JSON.parse(stdout);
  } finally {
    await close(server);
  }
}

export async function writePlanFile(name, plan) {
  const planPath = join(tmpdir(), `openforge-cli-plan-${process.pid}-${name}.json`);
  await writeFile(planPath, JSON.stringify(plan), 'utf8');
  return planPath;
}

export async function runCliAgainstRequestSequence(args, steps, env = {}, cliPath = CLI_PATH) {
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
    const result = await runCli(args, { ...env, OPENFORGE_HTTP_PORT: String(port) }, cliPath);
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
  'worktree',
  'branch',
  'project_id',
  'created_at',
];

export function expectCompactTaskRow(row, expected) {
  expect(Object.keys(row).sort()).toEqual([...COMPACT_TASK_KEYS].sort());
  expect(row).toMatchObject(expected);
  expect(row.prompt_preview.length).toBeLessThanOrEqual(120);
  for (const key of VERBOSE_TASK_KEYS) {
    expect(row).not.toHaveProperty(key);
  }
}
