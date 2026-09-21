import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildCliBridgeTestEnv, close, listen, runCliAgainstJsonBridge } from './cli-test-utils.js';

afterEach(() => vi.unstubAllEnvs());

it('sends ordinary CLI tests only to their fixture bridge despite inherited agent credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-cli-isolation-'));
  let inheritedRequests = 0;
  const inheritedGateway = createServer((_req, res) => {
    inheritedRequests++;
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  try {
    const port = await listen(inheritedGateway);
    const config = join(root, 'agent.json');
    await writeFile(config, JSON.stringify({ version: 1, port, token: 'a'.repeat(64) }), { mode: 0o600 });
    vi.stubEnv('OPENFORGE_AGENT_CONFIG', config);
    vi.stubEnv('OPENFORGE_HTTP_PORT', String(port));
    vi.stubEnv('OPENFORGE_BACKEND_PORT', String(port));
    vi.stubEnv('OPENFORGE_TASK_ID', 'T-inherited');
    vi.stubEnv('OPENFORGE_PTY_INSTANCE_ID', '999');
    const response = await runCliAgainstJsonBridge(['project', 'list'], {
      url: '/projects', response: [{ id: 'P-isolated' }],
    });
    expect(response).toEqual([{ id: 'P-isolated' }]);
    expect(inheritedRequests).toBe(0);
  } finally {
    await close(inheritedGateway);
    await rm(root, { recursive: true, force: true });
  }
});

it('disables default-port discovery unless a test explicitly supplies a transport', () => {
  vi.stubEnv('OPENFORGE_HTTP_PORT', '17422');
  vi.stubEnv('OPENFORGE_TASK_ID', 'live-task');
  vi.stubEnv('OPENFORGE_FUTURE_TRANSPORT', 'live-location');
  const env = buildCliBridgeTestEnv();
  expect(Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('OPENFORGE_')))).toEqual({ OPENFORGE_HTTP_PORT: '0' });
  expect(buildCliBridgeTestEnv({ OPENFORGE_HTTP_PORT: undefined }).OPENFORGE_HTTP_PORT).toBe('0');
  const explicit = { OPENFORGE_HTTP_PORT: '12345', OPENFORGE_AGENT_CONFIG: '/fixture/agent.json', OPENFORGE_TASK_ID: 'T-fixture' };
  expect(buildCliBridgeTestEnv(explicit)).toMatchObject(explicit);
});
