import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  listen,
  runCli,
  runCliAgainstJsonBridge,
} from './cli-test-utils.js';

describe('OpenForge project commands', () => {
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
});
