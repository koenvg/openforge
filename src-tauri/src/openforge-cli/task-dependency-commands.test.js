import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  listen,
  runCli,
  runCliAgainstJsonBridge,
  runCliAgainstRequestSequence,
} from './cli-test-utils.js';

describe('OpenForge task dependency commands', () => {
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
  it('removes only the named prerequisite through the native remove operation', async () => {
    await expect(runCliAgainstJsonBridge([
      'task', 'dependencies', 'remove', '--task-id', 'KVG-5232', '--depends-on', 'KVG-5266',
    ], {
      method: 'POST',
      url: '/remove_task_dependency',
      expectedBody: { task_id: 'KVG-5232', depends_on: 'KVG-5266' },
      response: { task_id: 'KVG-5232', status: 'updated' },
    })).resolves.toEqual({ task_id: 'KVG-5232', status: 'updated' });
  });

  it('clears all prerequisites only when explicitly requested', async () => {
    await expect(runCliAgainstJsonBridge([
      'task', 'dependencies', 'clear', '--task-id', 'KVG-5232',
    ], {
      method: 'POST',
      url: '/set_task_dependencies',
      expectedBody: { task_id: 'KVG-5232', depends_on: [] },
      response: { task_id: 'KVG-5232', status: 'updated' },
    })).resolves.toEqual({ task_id: 'KVG-5232', status: 'updated' });
  });

  it('rejects empty prerequisite IDs rather than clearing through remove or set', async () => {
    for (const action of ['remove', 'set']) {
      for (const args of [[], ['--depends-on', ' , ']]) {
        await expect(runCli([
          'task', 'dependencies', action, '--task-id', 'T-2', ...args,
        ])).rejects.toMatchObject({
          stderr: expect.stringContaining('requires'),
        });
      }
    }
    await expect(runCli([
      'task', 'dependencies', 'remove', '--task-id', 'T-2', '--depends-on', 'T-1,T-0',
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('exactly one') });
  });

  it('rejects unknown task IDs from the native dependency endpoints', async () => {
    for (const [action, url, body] of [
      ['remove', '/remove_task_dependency', { task_id: 'T-404', depends_on: 'T-1' }],
      ['clear', '/set_task_dependencies', { task_id: 'T-404', depends_on: [] }],
    ]) {
      const error = await runCliAgainstRequestSequence([
        'task', 'dependencies', action, '--task-id', 'T-404',
        ...(action === 'remove' ? ['--depends-on', 'T-1'] : []),
      ], [{ method: 'POST', url, body, statusCode: 400, response: { error: 'task T-404 not found' } }]).catch((failure) => failure);
      expect(error.seenRequests).toEqual([{ method: 'POST', url, body }]);
      expect(error.stderr).toContain('T-404');
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
});
