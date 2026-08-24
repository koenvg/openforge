import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLI_PATH,
  close,
  listen,
  runCli,
  runCliAgainstJsonBridge,
  runCliAgainstRequestSequence,
} from './cli-test-utils.js';

describe('OpenForge Plugin Commands', () => {
  it('runs installed CLI Plugin Command discovery using explicit or Agent Session Task context', async () => {
    const installDir = await mkdtemp(join(tmpdir(), 'openforge-installed-cli-'));
    const installedCliPath = join(installDir, 'cli.js');
    for (const filename of [
      'cli.js',
      'command-line.js',
      'debug-commands.js',
      'help.js',
      'http-transport.js',
      'plugin-commands.js',
      'plugin-management-commands.js',
      'project-commands.js',
      'task-commands.js',
    ]) {
      await writeFile(
        join(installDir, filename),
        await readFile(join(dirname(CLI_PATH), filename), 'utf8'),
        'utf8',
      );
    }
    const listed = [{
      qualifiedId: 'com.example.sync.run',
      pluginId: 'com.example.sync',
      runtime: 'backend',
      description: 'Run synchronization.',
      examples: [{ force: true }],
      discoverable: true,
    }];
    const fromEnvironment = await runCliAgainstRequestSequence(
      ['plugin', 'command', 'list'],
      [{
        method: 'POST',
        url: '/plugin_commands/list',
        response: listed,
      }],
      { OPENFORGE_TASK_ID: 'T-42' },
      installedCliPath,
    );

    expect(fromEnvironment.seenRequests).toEqual([{
      method: 'POST',
      url: '/plugin_commands/list',
      body: { taskId: 'T-42' },
    }]);
    expect(JSON.parse(fromEnvironment.stdout)).toEqual(listed);

    const explicitProject = await runCliAgainstRequestSequence(
      ['plugin', 'command', 'list', '--project-id', 'P-7'],
      [{ method: 'POST', url: '/plugin_commands/list', response: listed }],
      { OPENFORGE_TASK_ID: 'T-42' },
      installedCliPath,
    );
    expect(explicitProject.seenRequests[0].body).toEqual({ projectId: 'P-7' });
    const invoked = await runCliAgainstRequestSequence(
      [
        'plugin', 'command', 'invoke',
        '--command-id', 'com.example.sync.run',
        '--input', '{"force":true}',
      ],
      [{ method: 'POST', url: '/plugin_commands/invoke', response: { synced: 3 } }],
      { OPENFORGE_TASK_ID: 'T-42' },
      installedCliPath,
    );
    expect(invoked.seenRequests[0].body).toEqual({
      commandId: 'com.example.sync.run',
      taskId: 'T-42',
      input: { force: true },
    });
    expect(JSON.parse(invoked.stdout)).toEqual({ synced: 3 });

    await rm(installDir, { recursive: true, force: true });
  });

  it('describes an exact enabled backend Plugin Command including hidden commands', async () => {
    const descriptor = {
      qualifiedId: 'com.example.sync.hidden',
      pluginId: 'com.example.sync',
      runtime: 'backend',
      input: { type: 'object' },
      output: { type: 'boolean' },
      description: 'Run a targeted repair.',
      examples: [{}],
      discoverable: false,
    };

    const result = await runCliAgainstJsonBridge([
      'plugin',
      'command',
      'describe',
      '--command-id',
      'com.example.sync.hidden',
      '--task-id',
      'T-9',
      '--project-id',
      'P-1',
    ], {
      method: 'POST',
      url: '/plugin_commands/describe',
      expectedBody: {
        commandId: 'com.example.sync.hidden',
        taskId: 'T-9',
        projectId: 'P-1',
      },
      response: descriptor,
    });

    expect(result).toEqual(descriptor);
  });

  it('invokes an exact backend Plugin Command with JSON input and Agent Session Task context', async () => {
    const result = await runCliAgainstJsonBridge([
      'plugin',
      'command',
      'invoke',
      '--command-id',
      'com.example.sync.run',
      '--input',
      '{"force":true}',
    ], {
      method: 'POST',
      url: '/plugin_commands/invoke',
      expectedBody: {
        commandId: 'com.example.sync.run',
        taskId: 'T-42',
        input: { force: true },
      },
      response: { synced: 3 },
      env: { OPENFORGE_TASK_ID: 'T-42' },
    });

    expect(result).toEqual({ synced: 3 });
  });

  it('invokes a project-scoped Plugin Command without plugin input', async () => {
    const result = await runCliAgainstJsonBridge([
      'plugin',
      'command',
      'invoke',
      '--command-id',
      'com.example.sync.status',
      '--project-id',
      'P-7',
    ], {
      method: 'POST',
      url: '/plugin_commands/invoke',
      expectedBody: {
        commandId: 'com.example.sync.status',
        projectId: 'P-7',
      },
      response: { ready: true },
    });

    expect(result).toEqual({ ready: true });
  });

  it('rejects invalid Plugin Command context and JSON before contacting the bridge', async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('should not be called');
    });
    const port = await listen(server);

    try {
      await expect(runCli(['plugin', 'command', 'list'], {
        OPENFORGE_HTTP_PORT: String(port),
        OPENFORGE_TASK_ID: '',
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('plugin command discovery requires --task-id or --project-id'),
      });
      await expect(runCli([
        'plugin', 'command', 'invoke',
        '--command-id', 'com.example.sync.run',
        '--input', '{invalid',
        '--task-id', 'T-42',
      ], {
        OPENFORGE_HTTP_PORT: String(port),
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('invalid --input JSON'),
      });
      expect(requestCount).toBe(0);
    } finally {
      await close(server);
    }
  });
});
