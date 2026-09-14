import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { close, listen, runCli } from './cli-test-utils.js';

it('uses its private agent route instead of stale launch-time HTTP discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-cli-agent-'));
  await chmod(root, 0o700);
  const requests = [];
  const token = 'a'.repeat(64);
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end('[{"id":"P-fixture"}]');
  });
  try {
    const port = await listen(server);
    const configPath = join(root, 'agent.json');
    await writeFile(configPath, JSON.stringify({ version: 1, port, token, pty: { installation: 'fixture', lifetime: 'fixture', instance: 1 }, owner: { Shell: { task_id: 'T-fixture', index: 0 } } }), { mode: 0o600 });
    const { stdout, stderr } = await runCli(['project', 'list'], { OPENFORGE_AGENT_CONFIG: configPath, OPENFORGE_HTTP_PORT: '1' });
    expect(JSON.parse(stdout)).toEqual([{ id: 'P-fixture' }]);
    expect(requests).toEqual([{ url: '/projects', authorization: `Bearer ${token}` }]);
    expect(stdout + stderr).not.toContain(token);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

it('accepts the credential shape the Sidecar writes for a headless generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-cli-generation-'));
  await chmod(root, 0o700);
  const requests = [];
  const token = 'ab12'.repeat(16);
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end('{"id":"rt_1"}');
  });
  try {
    const port = await listen(server);
    const configPath = join(root, 'generation-fixture.json');
    await writeFile(configPath, JSON.stringify({ version: 1, port, token }), { mode: 0o600 });
    const { stdout } = await runCli(
      ['review', 'thread', 'create', '--namespace', 'github', '--target', 'gh:acme/web#1', '--revision', '0f1c2d3', '--file', 'src/main.rs', '--line', '42', '--body', 'Missing null check'],
      { OPENFORGE_AGENT_CONFIG: configPath, OPENFORGE_HTTP_PORT: '1' },
    );
    expect(JSON.parse(stdout)).toEqual({ id: 'rt_1' });
    expect(requests).toEqual([
      { method: 'POST', url: '/review_threads/create', authorization: `Bearer ${token}` },
    ]);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

it('fails closed on unsafe or malformed agent configuration without using legacy discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-cli-config-'));
  await chmod(root, 0o700);
  let calls = 0;
  const server = createServer((_req, res) => { calls += 1; res.end('[]'); });
  try {
    const port = await listen(server);
    const path = join(root, 'agent.json');
    for (const [contents, mode] of [['not-json', 0o600], ['{}', 0o600], ['x'.repeat(4097), 0o600], [JSON.stringify({version:1, port, token:'a'.repeat(64)}), 0o644]]) {
      await writeFile(path, contents, {mode:0o600});
      await chmod(path, mode);
      await expect(runCli(['project', 'list'], {OPENFORGE_AGENT_CONFIG:path, OPENFORGE_HTTP_PORT:String(port)})).rejects.toThrow('request not executed');
    }
    expect(calls).toBe(0);
  } finally { await close(server); await rm(root, {recursive:true, force:true}); }
});

it('does not retry a mutation when its response drops and reports unknown outcome', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-cli-outcome-'));
  await chmod(root, 0o700);
  let calls = 0;
  const server = createServer((req) => { calls += 1; req.socket.destroy(); });
  try {
    const port = await listen(server);
    const path = join(root, 'agent.json');
    await writeFile(path, JSON.stringify({version:1, port, token:'a'.repeat(64)}), {mode:0o600});
    await expect(runCli(['task', 'delete', '--task-id', 'T-fixture'], {OPENFORGE_AGENT_CONFIG:path})).rejects.toThrow('outcome unknown');
    expect(calls).toBe(1);
  } finally { await close(server); await rm(root, {recursive:true, force:true}); }
});
