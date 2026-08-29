import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  SKILL_PATH,
  buildCliBridgeTestEnv,
  close,
  execFileAsync,
  listen,
  runCli,
} from './cli-test-utils.js';

describe('OpenForge CLI', () => {
  it('keeps the auto-installed task-management skill concise while covering safe commands', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');

    for (const command of [
      'openforge task create',
      'openforge task update',
      'openforge task start',
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
    expect(stdout).toContain('openforge task start --task-id <id>');
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
      'openforge task update --task-id <id> --initial-prompt <text>',
      'openforge task start --task-id <id>',
      'openforge task list --project-id <id>',
      'openforge task get --task-id <id>',
      'openforge task labels list --task-id <id>',
      'openforge task labels add --task-id <id> --label <name>',
      'openforge task labels remove --task-id <id> --label-id <id>',
      'openforge task dependencies set --task-id <id> --depends-on <task-id>',
      'openforge task dependencies add --task-id <id> --depends-on <task-id>',
      'openforge project list',
      'openforge project labels list --project-id <id>',
      'openforge debug process-memory',
      'openforge debug process-memory-history',
      'openforge plugin install --path <local-plugin-source>',
      'openforge plugin enable --plugin-id <id> --project-id <id>',
      'openforge plugin disable --plugin-id <id> --project-id <id>',
      'openforge plugin app enable --plugin-id <id>',
      'openforge plugin app disable --plugin-id <id>',
      'openforge plugin reload --plugin-id <id> [--project-id <id>]',
      'openforge task plan apply --file <plan.json>',
    ]) {
      expect(stdout).toContain(command);
    }

    expect(stdout).toContain('Plugin Installation is local-only for now');
    expect(stdout).toContain('Local Plugin Source');
    expect(stdout).toContain('Plugin Installation never enables a plugin automatically.');
    expect(stdout).not.toContain('Flat compatibility aliases:');
    expect(stdout).not.toContain('openforge create-task');
    expect(stdout).not.toContain('openforge list-projects');
    expect(stdout).not.toContain('openforge list-project-labels');
    expect(stdout).not.toContain('openforge plugin install --npm');
    expect(stdout).not.toContain('openforge plugin install --git');
    expect(stdout).not.toContain('openforge plugin install --source');
  });

  it('does not expose mcp as a CLI command', async () => {
    await expect(runCli(['mcp'])).rejects.toMatchObject({
      stderr: expect.stringContaining('unknown command: mcp'),
    });
  });
});
