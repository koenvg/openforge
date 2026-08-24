import { optionalString, requireFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

function pluginCommandContext(flags) {
  const projectId = optionalString(flags, 'projectId');
  const explicitTaskId = optionalString(flags, 'taskId');
  const environmentTaskId = typeof process.env.OPENFORGE_TASK_ID === 'string' && process.env.OPENFORGE_TASK_ID.length > 0
    ? process.env.OPENFORGE_TASK_ID
    : undefined;
  const taskId = explicitTaskId ?? (projectId === undefined ? environmentTaskId : undefined);
  if (!taskId && !projectId) {
    throw new Error('plugin command discovery requires --task-id or --project-id');
  }
  return { taskId, projectId };
}

async function listPluginCommands(flags) {
  printJson(await requestJson('/plugin_commands/list', {
    method: 'POST',
    body: JSON.stringify(pluginCommandContext(flags)),
  }));
}

async function describePluginCommand(flags) {
  const payload = {
    commandId: requireFlag(flags, 'commandId'),
    ...pluginCommandContext(flags),
  };
  printJson(await requestJson('/plugin_commands/describe', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

function optionalJsonInput(flags) {
  if (flags.input === undefined) return undefined;
  if (typeof flags.input !== 'string') {
    throw new Error('--input requires a JSON value');
  }
  try {
    return JSON.parse(flags.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid --input JSON: ${message}`);
  }
}

async function invokePluginCommand(flags) {
  const payload = {
    commandId: requireFlag(flags, 'commandId'),
    ...pluginCommandContext(flags),
  };
  const input = optionalJsonInput(flags);
  if (input !== undefined) payload.input = input;
  printJson(await requestJson('/plugin_commands/invoke', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

export const PLUGIN_COMMAND_SPECS = [
  {
    path: ['plugin', 'command', 'list'],
    flags: ['taskId', 'projectId'],
    usage: 'openforge plugin command list [--task-id <id> | --project-id <id>]',
    handler: listPluginCommands,
  },
  {
    path: ['plugin', 'command', 'describe'],
    flags: ['commandId', 'taskId', 'projectId'],
    usage: 'openforge plugin command describe --command-id <qualified-id> [--task-id <id> | --project-id <id>]',
    handler: describePluginCommand,
  },
  {
    path: ['plugin', 'command', 'invoke'],
    flags: ['commandId', 'input', 'taskId', 'projectId'],
    usage: 'openforge plugin command invoke --command-id <qualified-id> [--input <json>] [--task-id <id> | --project-id <id>]',
    handler: invokePluginCommand,
  },
];
