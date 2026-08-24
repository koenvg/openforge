import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  close,
  listen,
  runCli,
  runCliAgainstJsonBridge,
} from './cli-test-utils.js';

describe('OpenForge plugin management commands', () => {
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

  it('enables and disables app-enabled plugins without a project scope', async () => {
    await expect(runCliAgainstJsonBridge([
      'plugin',
      'app',
      'enable',
      '--plugin-id',
      'account-usage',
    ], {
      method: 'POST',
      url: '/set_app_plugin_enabled',
      expectedBody: { pluginId: 'account-usage', enabled: true },
      response: { plugin_id: 'account-usage', enabled: true },
    })).resolves.toEqual({ plugin_id: 'account-usage', enabled: true });

    await expect(runCliAgainstJsonBridge([
      'plugin',
      'app',
      'disable',
      '--plugin-id',
      'account-usage',
    ], {
      method: 'POST',
      url: '/set_app_plugin_enabled',
      expectedBody: { pluginId: 'account-usage', enabled: false },
      response: { plugin_id: 'account-usage', enabled: false },
    })).resolves.toEqual({ plugin_id: 'account-usage', enabled: false });
  });

  it('rejects project scope flags for app plugin enablement before contacting the HTTP bridge', async () => {
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
        'app',
        'enable',
        '--plugin-id',
        'account-usage',
        '--project-id',
        'P-1',
      ], { OPENFORGE_HTTP_PORT: String(port) })).rejects.toMatchObject({
        stderr: expect.stringContaining('plugin app enable does not support --project-id'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
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
