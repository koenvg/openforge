#!/usr/bin/env node

const DEFAULT_OPENFORGE_HTTP_PORT = '17422';
const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? DEFAULT_OPENFORGE_HTTP_PORT;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

function appendFlagValue(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }
  flags[key] = [flags[key], value];
}

function flagName(name) {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required flag ${flagName(name)}`);
  }
  return value;
}

function optionalString(flags, name) {
  return typeof flags[name] === 'string' ? flags[name] : undefined;
}

function stringListFromFlag(flags, name) {
  const raw = flags[name];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
  }
  return result;
}

function dependencyIdsFromFlag(flags, name = 'dependsOn') {
  return stringListFromFlag(flags, name);
}

function labelNamesFromFlag(flags) {
  return stringListFromFlag(flags, 'label');
}

function parseTaskChain(value) {
  return value
    .split(/\s*(?:->|,|\n)\s*/u)
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

async function requestJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`OpenForge HTTP ${res.status}: ${detail}`);
  }

  return body;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function createTask(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  const labels = labelNamesFromFlag(flags);
  const payload = {
    initial_prompt: requireFlag(flags, 'initialPrompt'),
    project_id: optionalString(flags, 'projectId'),
    worktree: optionalString(flags, 'worktree'),
    depends_on: dependsOn.length > 0 ? dependsOn : undefined,
    labels: labels.length > 0 ? labels : undefined,
  };
  printJson(await requestJson('/create_task', { method: 'POST', body: JSON.stringify(payload) }));
}

async function updateTask(flags) {
  const payload = {
    task_id: requireFlag(flags, 'taskId'),
    summary: typeof flags.summary === 'string' ? flags.summary : undefined,
  };
  if (!payload.summary) {
    throw new Error('update-task requires --summary');
  }
  printJson(await requestJson('/update_task', { method: 'POST', body: JSON.stringify(payload) }));
}

async function deleteTask(flags) {
  printJson(await requestJson('/delete_task', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId') }),
  }));
}

async function setTaskDependencies(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  if (dependsOn.length === 0) {
    throw new Error('set-task-dependencies requires --depends-on');
  }
  printJson(await requestJson('/set_task_dependencies', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: dependsOn }),
  }));
}

async function addTaskDependency(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  if (dependsOn.length !== 1) {
    throw new Error('add-task-dependency requires exactly one --depends-on task id');
  }
  printJson(await requestJson('/add_task_dependency', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: dependsOn[0] }),
  }));
}

async function linkTasks(flags) {
  const chain = parseTaskChain(requireFlag(flags, 'chain'));
  if (chain.length < 2) {
    throw new Error('link-tasks requires a chain with at least two task ids');
  }
  printJson(await requestJson('/link_task_chain', {
    method: 'POST',
    body: JSON.stringify({ chain }),
  }));
}

async function getTask(flags) {
  const taskId = encodeURIComponent(requireFlag(flags, 'taskId'));
  printJson(await requestJson(`/task/${taskId}`));
}

async function listTaskLabels(flags) {
  const taskId = encodeURIComponent(requireFlag(flags, 'taskId'));
  printJson(await requestJson(`/task/${taskId}/labels`));
}

async function addTaskLabel(flags) {
  const labels = labelNamesFromFlag(flags);
  if (labels.length !== 1) {
    throw new Error('add-task-label requires exactly one --label');
  }
  printJson(await requestJson('/add_task_label', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), label: labels[0] }),
  }));
}

async function removeTaskLabel(flags) {
  const labelIdRaw = requireFlag(flags, 'labelId');
  const labelId = Number(labelIdRaw);
  if (!Number.isInteger(labelId) || labelId <= 0) {
    throw new Error('remove-task-label requires a positive integer --label-id');
  }
  printJson(await requestJson('/remove_task_label', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), label_id: labelId }),
  }));
}

async function listTasks(flags) {
  const params = new URLSearchParams({ project_id: requireFlag(flags, 'projectId') });
  if (typeof flags.state === 'string') {
    params.set('state', flags.state);
  } else {
    params.set('exclude_done', 'true');
  }
  if (flags.full !== true) params.set('compact', 'true');
  printJson(await requestJson(`/tasks?${params.toString()}`));
}

async function listProjects() {
  printJson(await requestJson('/projects'));
}

const LOCAL_PLUGIN_INSTALL_ERROR = 'plugin install supports local Plugin Installation only; pass --path <local-plugin-source>';
const PLUGIN_RELOAD_SOURCE_ERROR = 'plugin reload uses installed Plugin Installation artifacts only';

function rejectPluginInstallSources(flags, positionals) {
  if (positionals.length > 0 || flags.npm !== undefined || flags.git !== undefined || flags.source !== undefined) {
    throw new Error(LOCAL_PLUGIN_INSTALL_ERROR);
  }
}

function rejectPluginReloadSources(flags, positionals) {
  if (positionals.length > 0 || flags.path !== undefined || flags.npm !== undefined || flags.git !== undefined || flags.source !== undefined) {
    throw new Error(PLUGIN_RELOAD_SOURCE_ERROR);
  }
}

async function installPluginFromLocal(flags) {
  const sourcePath = requireFlag(flags, 'path');
  printJson(await requestJson('/install_plugin_from_local', {
    method: 'POST',
    body: JSON.stringify({ sourcePath }),
  }));
}

async function setPluginEnabled(flags, enabled) {
  const pluginId = requireFlag(flags, 'pluginId');
  const projectId = requireFlag(flags, 'projectId');
  printJson(await requestJson('/set_plugin_enabled', {
    method: 'POST',
    body: JSON.stringify({ pluginId, projectId, enabled }),
  }));
}

async function reloadPlugin(flags) {
  const payload = {
    pluginId: requireFlag(flags, 'pluginId'),
    projectId: optionalString(flags, 'projectId'),
  };
  printJson(await requestJson('/reload_plugin', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

const COMMAND_SPECS = [
  {
    path: ['task', 'create'],
    aliases: [['create-task']],
    flags: ['initialPrompt', 'projectId', 'worktree', 'dependsOn', 'label'],
    usage: 'openforge task create --initial-prompt <text> [--project-id <id>] [--worktree <path>] [--depends-on <task-id>[,<task-id>...]] [--label <name>[,<name>...]]',
    aliasUsage: 'openforge create-task',
    handler: createTask,
  },
  {
    path: ['task', 'update'],
    aliases: [['update-task']],
    flags: ['taskId', 'summary'],
    usage: 'openforge task update --task-id <id> --summary <text>',
    aliasUsage: 'openforge update-task',
    handler: updateTask,
  },
  {
    path: ['task', 'delete'],
    aliases: [['delete-task']],
    flags: ['taskId'],
    usage: 'openforge task delete --task-id <id>',
    aliasUsage: 'openforge delete-task',
    handler: deleteTask,
  },
  {
    path: ['task', 'dependencies', 'set'],
    aliases: [['set-task-dependencies']],
    flags: ['taskId', 'dependsOn'],
    usage: 'openforge task dependencies set --task-id <id> --depends-on <task-id>[,<task-id>...]',
    aliasUsage: 'openforge set-task-dependencies',
    handler: setTaskDependencies,
  },
  {
    path: ['task', 'dependencies', 'add'],
    aliases: [['add-task-dependency']],
    flags: ['taskId', 'dependsOn'],
    usage: 'openforge task dependencies add --task-id <id> --depends-on <task-id>',
    aliasUsage: 'openforge add-task-dependency',
    handler: addTaskDependency,
  },
  {
    path: ['task', 'dependencies', 'link'],
    aliases: [['link-tasks']],
    flags: ['chain'],
    usage: 'openforge task dependencies link --chain "T-1 -> T-2 -> T-3"',
    aliasUsage: 'openforge link-tasks',
    handler: linkTasks,
  },
  {
    path: ['task', 'get'],
    aliases: [['get-task']],
    flags: ['taskId'],
    usage: 'openforge task get --task-id <id>',
    aliasUsage: 'openforge get-task',
    handler: getTask,
  },
  {
    path: ['task', 'labels', 'list'],
    aliases: [['list-task-labels']],
    flags: ['taskId'],
    usage: 'openforge task labels list --task-id <id>',
    aliasUsage: 'openforge list-task-labels',
    handler: listTaskLabels,
  },
  {
    path: ['task', 'labels', 'add'],
    aliases: [['add-task-label']],
    flags: ['taskId', 'label'],
    usage: 'openforge task labels add --task-id <id> --label <name>',
    aliasUsage: 'openforge add-task-label',
    handler: addTaskLabel,
  },
  {
    path: ['task', 'labels', 'remove'],
    aliases: [['remove-task-label']],
    flags: ['taskId', 'labelId'],
    usage: 'openforge task labels remove --task-id <id> --label-id <id>',
    aliasUsage: 'openforge remove-task-label',
    handler: removeTaskLabel,
  },
  {
    path: ['task', 'list'],
    aliases: [['list-tasks']],
    flags: ['projectId', 'state', 'full'],
    usage: 'openforge task list --project-id <id> [--state backlog|doing|done] [--full]',
    aliasUsage: 'openforge list-tasks',
    handler: listTasks,
  },
  {
    path: ['project', 'list'],
    aliases: [['list-projects']],
    flags: [],
    usage: 'openforge project list',
    aliasUsage: 'openforge list-projects',
    handler: listProjects,
  },
  {
    path: ['plugin', 'install'],
    flags: ['path', 'npm', 'git', 'source'],
    allowPositionals: true,
    usage: 'openforge plugin install --path <local-plugin-source>',
    validate: rejectPluginInstallSources,
    handler: installPluginFromLocal,
  },
  {
    path: ['plugin', 'enable'],
    flags: ['pluginId', 'projectId'],
    usage: 'openforge plugin enable --plugin-id <id> --project-id <id>',
    handler: (flags) => setPluginEnabled(flags, true),
  },
  {
    path: ['plugin', 'disable'],
    flags: ['pluginId', 'projectId'],
    usage: 'openforge plugin disable --plugin-id <id> --project-id <id>',
    handler: (flags) => setPluginEnabled(flags, false),
  },
  {
    path: ['plugin', 'reload'],
    flags: ['pluginId', 'projectId', 'path', 'npm', 'git', 'source'],
    allowPositionals: true,
    usage: 'openforge plugin reload --plugin-id <id> [--project-id <id>]',
    validate: rejectPluginReloadSources,
    handler: reloadPlugin,
  },
];

const COMMAND_MATCHES = COMMAND_SPECS.flatMap((spec) => [
  { spec, tokens: spec.path, isAlias: false },
  ...(spec.aliases ?? []).map((tokens) => ({ spec, tokens, isAlias: true })),
]).sort((left, right) => right.tokens.length - left.tokens.length);

function tokensMatch(argv, tokens) {
  if (argv.length < tokens.length) return false;
  return tokens.every((token, index) => argv[index] === token);
}

function resolveCommand(argv) {
  for (const match of COMMAND_MATCHES) {
    if (tokensMatch(argv, match.tokens)) {
      return {
        spec: match.spec,
        commandName: match.tokens.join(' '),
        isAlias: match.isAlias,
        rest: argv.slice(match.tokens.length),
      };
    }
  }
  return null;
}

function parseFlags(rest) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      appendFlagValue(flags, key, true);
      continue;
    }

    appendFlagValue(flags, key, next);
    i += 1;
  }

  return { flags, positionals };
}

function shouldPrintHelpArg(argv) {
  return argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h';
}

function shouldPrintCommandHelp(flags) {
  return flags.help === true;
}

function validateSupportedFlags(commandName, supportedFlags, flags) {
  for (const name of Object.keys(flags)) {
    if (name === 'help') continue;
    if (!supportedFlags.has(name)) {
      throw new Error(`${commandName} does not support ${flagName(name)}`);
    }
  }
}

function printHelp() {
  console.log(`OpenForge CLI

Usage:
  openforge create-task --initial-prompt <text> [--project-id <id>] [--worktree <path>] [--depends-on <task-id>[,<task-id>...]] [--label <name>[,<name>...]]
  openforge update-task --task-id <id> --summary <text>
  openforge delete-task --task-id <id>
  openforge set-task-dependencies --task-id <id> --depends-on <task-id>[,<task-id>...]
  openforge add-task-dependency --task-id <id> --depends-on <task-id>
  openforge link-tasks --chain "T-1 -> T-2 -> T-3"
  openforge get-task --task-id <id>
  openforge list-task-labels --task-id <id>
  openforge add-task-label --task-id <id> --label <name>
  openforge remove-task-label --task-id <id> --label-id <id>
  openforge list-tasks --project-id <id> [--state backlog|doing|done] [--full]
  openforge list-projects

Nested command groups:
${COMMAND_SPECS.map((spec) => `  ${spec.usage}`).join('\n')}

Flat compatibility aliases:
  openforge create-task, update-task, delete-task, get-task, list-tasks
  openforge list-task-labels, add-task-label, remove-task-label
  openforge set-task-dependencies, add-task-dependency, link-tasks
  openforge list-projects

Plugin Installation is local-only for now:
  Local Plugin Source: use openforge plugin install --path <local-plugin-source>
  Project Plugin Enablement is separate: use plugin enable/disable with --project-id.
  Plugin reload explicitly reloads installed artifacts only; it does not watch or rebuild source.

Task prompt semantics:
  create-task sets the task's initial_prompt from --initial-prompt.
  update-task updates only the task summary/handoff notes via --summary.
  update-task does not change initial_prompt or prompt; do not use it to fix a bad task prompt.
  If a task was created with the wrong initial prompt, first record its labels, own depends_on list, and reverse dependents by listing project tasks and finding depends_on entries containing the old id. Delete the incorrect task, create a replacement with the desired --initial-prompt, then repoint each dependent with set-task-dependencies.

Task listing:
  list-tasks prints compact rows by default for broad scans: id, prompt_preview, status, labels, depends_on, updated_at.
  Pass --full to print complete TaskRow objects.
  list-tasks excludes done tasks unless --state done is passed.

Task creation hygiene:
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  Use --label for obvious categories, and link prerequisites immediately with --depends-on or link-tasks when the order is known.
  If labels or dependency order are unclear, state that uncertainty instead of guessing.

Examples:
  openforge task list --project-id P-1
  openforge task delete --task-id T-123
  openforge task create --initial-prompt "Correct task prompt" --project-id P-1 --depends-on T-122 --label cleanup
  openforge task dependencies set --task-id T-999 --depends-on T-456,T-122

Environment:
  OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: 17422)
`);
}

function printCommandHelp(spec) {
  console.log(`OpenForge CLI

Usage:
  ${spec.usage}

${spec.aliasUsage ? `Flat compatibility alias: ${spec.aliasUsage}\n\n` : ''}Task prompt semantics:
  create-task sets the task's initial_prompt from --initial-prompt.
  update-task updates only the task summary/handoff notes via --summary.
  update-task does not change initial_prompt or prompt; do not use it to fix a bad task prompt.
  If a task was created with the wrong initial prompt, first record its labels, own depends_on list, and reverse dependents by listing project tasks and finding depends_on entries containing the old id. Delete the incorrect task, create a replacement with the desired --initial-prompt, then repoint each dependent with set-task-dependencies.

Task creation hygiene:
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  Use --label for obvious categories, and link prerequisites immediately with --depends-on or link-tasks when the order is known.
  If labels or dependency order are unclear, state that uncertainty instead of guessing.
`);
}

async function main(argv) {
  if (shouldPrintHelpArg(argv)) {
    printHelp();
    return;
  }

  const resolved = resolveCommand(argv);
  if (!resolved) {
    throw new Error(`unknown command: ${argv[0]}`);
  }

  const { spec, commandName, isAlias, rest } = resolved;
  const { flags, positionals } = parseFlags(rest);

  if (shouldPrintCommandHelp(flags)) {
    if (isAlias) {
      printHelp();
    } else {
      printCommandHelp(spec);
    }
    return;
  }

  validateSupportedFlags(commandName, new Set(spec.flags), flags);
  spec.validate?.(flags, positionals);
  if (positionals.length > 0 && !spec.allowPositionals) {
    throw new Error(`unexpected positional argument: ${positionals[0]}`);
  }

  await spec.handler(flags, positionals);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
