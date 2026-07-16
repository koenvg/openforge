#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

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

function requirePlanString(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`task plan ${path} must be a non-empty string`);
  }
  return value.trim();
}

function optionalPlanString(value, path) {
  if (value === undefined || value === null) return undefined;
  return requirePlanString(value, path);
}

function optionalStringArray(value, path) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`task plan ${path} must be an array of strings`);
  return value.map((entry, index) => requirePlanString(entry, `${path}[${index}]`));
}

function looksLikeExternalTaskId(value) {
  return /^[A-Z]+-\d+$/u.test(value);
}

function validateLocalDependencyGraph(tasks) {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const state = new Map();

  function visit(key, stack) {
    const currentState = state.get(key);
    if (currentState === 'visiting') {
      throw new Error(`task plan has cyclic dependsOn references: ${[...stack, key].join(' -> ')}`);
    }
    if (currentState === 'visited') return;

    state.set(key, 'visiting');
    const task = byKey.get(key);
    for (const dependency of task.dependsOn) {
      if (byKey.has(dependency)) visit(dependency, [...stack, key]);
    }
    state.set(key, 'visited');
  }

  for (const task of tasks) visit(task.key, []);
}

function normalizeTaskPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('task plan must be a JSON object');
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new Error('task plan tasks must be a non-empty array');
  }

  if (plan.worktree !== undefined) {
    throw new Error('task plan worktree is not supported; use projectId and dependsOn');
  }

  const projectId = optionalPlanString(plan.projectId, 'projectId');
  const keys = new Set();
  const tasks = plan.tasks.map((rawTask, index) => {
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) {
      throw new Error(`task plan tasks[${index}] must be an object`);
    }

    const key = requirePlanString(rawTask.key, `tasks[${index}].key`);
    if (keys.has(key)) throw new Error(`duplicate task plan key "${key}"`);
    keys.add(key);

    if (rawTask.worktree !== undefined) {
      throw new Error(`task plan tasks[${index}].worktree is not supported; use projectId and dependsOn`);
    }

    const promptValue = rawTask.prompt ?? rawTask.initialPrompt;
    return {
      key,
      prompt: requirePlanString(promptValue, `tasks[${index}].prompt`),
      projectId: optionalPlanString(rawTask.projectId, `tasks[${index}].projectId`) ?? projectId,
      labels: optionalStringArray(rawTask.labels, `tasks[${index}].labels`),
      dependsOn: optionalStringArray(rawTask.dependsOn, `tasks[${index}].dependsOn`),
    };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency) && !looksLikeExternalTaskId(dependency)) {
        throw new Error(`unknown dependsOn key "${dependency}"`);
      }
    }
  }

  validateLocalDependencyGraph(tasks);
  return { projectId, tasks };
}

async function loadTaskPlan(flags) {
  const file = requireFlag(flags, 'file');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read task plan ${file}: ${message}`);
  }
  return normalizeTaskPlan(parsed);
}

function taskCreatePayloadFromPlan(task) {
  const payload = { initial_prompt: task.prompt };
  if (task.projectId) payload.project_id = task.projectId;
  if (task.labels.length > 0) payload.labels = task.labels;
  return payload;
}

async function rollbackCreatedPlanTasks(createdTasks) {
  const rolledBack = [];
  const rollbackFailures = [];
  for (const task of [...createdTasks].reverse()) {
    try {
      await requestJson('/hard_delete_task', {
        method: 'POST',
        body: JSON.stringify({ task_id: task.task_id }),
      });
      rolledBack.push(task.task_id);
    } catch (error) {
      rollbackFailures.push({
        task_id: task.task_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rolledBack, rollbackFailures };
}

function buildRollbackError(originalError, rollback) {
  const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
  const details = [];
  if (rollback.rolledBack.length > 0) {
    details.push(`rolled back created tasks: ${rollback.rolledBack.join(',')}`);
  }
  if (rollback.rollbackFailures.length > 0) {
    details.push(`rollback failures: ${rollback.rollbackFailures.map((failure) => `${failure.task_id}: ${failure.error}`).join('; ')}`);
  }
  return new Error(details.length > 0 ? `${originalMessage}; ${details.join('; ')}` : originalMessage);
}

async function applyTaskPlan(flags) {
  const plan = await loadTaskPlan(flags);
  const created = [];
  const keyToTaskId = {};
  const dependencies = [];

  try {
    for (const task of plan.tasks) {
      const response = await requestJson('/create_task', {
        method: 'POST',
        body: JSON.stringify(taskCreatePayloadFromPlan(task)),
      });
      const taskId = response?.task_id;
      if (typeof taskId !== 'string' || taskId.length === 0) {
        throw new Error(`create_task for key "${task.key}" did not return task_id`);
      }
      keyToTaskId[task.key] = taskId;
      created.push({ key: task.key, task_id: taskId });
    }

    for (const task of plan.tasks) {
      if (task.dependsOn.length === 0) continue;
      const dependsOn = task.dependsOn.map((dependency) => keyToTaskId[dependency] ?? dependency);
      const response = await requestJson('/set_task_dependencies', {
        method: 'POST',
        body: JSON.stringify({ task_id: keyToTaskId[task.key], depends_on: dependsOn }),
      });
      dependencies.push({
        key: task.key,
        task_id: keyToTaskId[task.key],
        depends_on: dependsOn,
        status: response?.status,
      });
    }
  } catch (error) {
    if (created.length > 0) throw buildRollbackError(error, await rollbackCreatedPlanTasks(created));
    throw error;
  }

  printJson({
    status: 'created',
    tasks: keyToTaskId,
    created,
    dependencies,
  });
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
  const taskId = requireFlag(flags, 'taskId');
  const summary = optionalString(flags, 'summary');
  const initialPrompt = optionalString(flags, 'initialPrompt');
  if ((summary === undefined) === (initialPrompt === undefined)) {
    throw new Error('task update requires exactly one of --summary or --initial-prompt');
  }
  const payload = { task_id: taskId };
  if (summary !== undefined) payload.summary = summary;
  if (initialPrompt !== undefined) payload.initial_prompt = initialPrompt;
  printJson(await requestJson('/update_task', { method: 'POST', body: JSON.stringify(payload) }));
}

async function startTask(flags) {
  printJson(await requestJson('/start_task', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId') }),
  }));
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
    throw new Error('task dependencies set requires --depends-on');
  }
  printJson(await requestJson('/set_task_dependencies', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: dependsOn }),
  }));
}

async function addTaskDependency(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  if (dependsOn.length !== 1) {
    throw new Error('task dependencies add requires exactly one --depends-on task id');
  }
  printJson(await requestJson('/add_task_dependency', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: dependsOn[0] }),
  }));
}

async function linkTasks(flags) {
  const chain = parseTaskChain(requireFlag(flags, 'chain'));
  if (chain.length < 2) {
    throw new Error('task dependencies link requires a chain with at least two task ids');
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
    throw new Error('task labels add requires exactly one --label');
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
    throw new Error('task labels remove requires a positive integer --label-id');
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

async function showProcessMemoryDiagnostics() {
  printJson(await requestJson('/debug/process-memory'));
}

async function listProjectLabels(flags) {
  const projectId = encodeURIComponent(requireFlag(flags, 'projectId'));
  printJson(await requestJson(`/project/${projectId}/labels`));
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
    flags: ['initialPrompt', 'projectId', 'worktree', 'dependsOn', 'label'],
    usage: 'openforge task create --initial-prompt <text> [--project-id <id>] [--worktree <path>] [--depends-on <task-id>[,<task-id>...]] [--label <name>[,<name>...]]',
    handler: createTask,
  },
  {
    path: ['task', 'update'],
    flags: ['taskId', 'summary', 'initialPrompt'],
    usage: 'openforge task update --task-id <id> (--summary <text> | --initial-prompt <text>)',
    handler: updateTask,
  },
  {
    path: ['task', 'start'],
    flags: ['taskId'],
    usage: 'openforge task start --task-id <id>',
    handler: startTask,
  },
  {
    path: ['task', 'delete'],
    flags: ['taskId'],
    usage: 'openforge task delete --task-id <id>',
    handler: deleteTask,
  },
  {
    path: ['task', 'dependencies', 'set'],
    flags: ['taskId', 'dependsOn'],
    usage: 'openforge task dependencies set --task-id <id> --depends-on <task-id>[,<task-id>...]',
    handler: setTaskDependencies,
  },
  {
    path: ['task', 'dependencies', 'add'],
    flags: ['taskId', 'dependsOn'],
    usage: 'openforge task dependencies add --task-id <id> --depends-on <task-id>',
    handler: addTaskDependency,
  },
  {
    path: ['task', 'dependencies', 'link'],
    flags: ['chain'],
    usage: 'openforge task dependencies link --chain "T-1 -> T-2 -> T-3"',
    handler: linkTasks,
  },
  {
    path: ['task', 'get'],
    flags: ['taskId'],
    usage: 'openforge task get --task-id <id>',
    handler: getTask,
  },
  {
    path: ['task', 'labels', 'list'],
    flags: ['taskId'],
    usage: 'openforge task labels list --task-id <id>',
    handler: listTaskLabels,
  },
  {
    path: ['task', 'labels', 'add'],
    flags: ['taskId', 'label'],
    usage: 'openforge task labels add --task-id <id> --label <name>',
    handler: addTaskLabel,
  },
  {
    path: ['task', 'labels', 'remove'],
    flags: ['taskId', 'labelId'],
    usage: 'openforge task labels remove --task-id <id> --label-id <id>',
    handler: removeTaskLabel,
  },
  {
    path: ['task', 'list'],
    flags: ['projectId', 'state', 'full'],
    usage: 'openforge task list --project-id <id> [--state backlog|doing|done] [--full]',
    handler: listTasks,
  },
  {
    path: ['task', 'plan', 'apply'],
    flags: ['file'],
    usage: 'openforge task plan apply --file <plan.json>',
    handler: applyTaskPlan,
  },
  {
    path: ['project', 'list'],
    flags: [],
    usage: 'openforge project list',
    handler: listProjects,
  },
  {
    path: ['debug', 'process-memory'],
    flags: [],
    usage: 'openforge debug process-memory',
    handler: showProcessMemoryDiagnostics,
  },
  {
    path: ['project', 'labels', 'list'],
    flags: ['projectId'],
    usage: 'openforge project labels list --project-id <id>',
    handler: listProjectLabels,
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

const COMMAND_MATCHES = COMMAND_SPECS.map((spec) => ({
  spec,
  tokens: spec.path,
})).sort((left, right) => right.tokens.length - left.tokens.length);

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
${COMMAND_SPECS.map((spec) => `  ${spec.usage}`).join('\n')}

Plugin Installation is local-only for now:
  Local Plugin Source: use openforge plugin install --path <local-plugin-source>
  Project Plugin Enablement is separate: use plugin enable/disable with --project-id.
  Plugin reload explicitly reloads installed artifacts only; it does not watch or rebuild source.

Task prompt semantics:
  task create sets the task's initial_prompt from --initial-prompt.
  task update --summary updates only the task summary/Handoff Notes.
  task update --initial-prompt updates initial_prompt and prompt together only while the task has never started.
  Started or completed tasks reject prompt updates; create a replacement task instead.

Task starting:
  task start uses persisted task and project configuration to start the native configured implementation flow.
  Existing dependency, concurrent-start, active-session, workspace, provider, and PTY safeguards remain enforced.

Task listing:
  task list prints compact rows by default for broad scans: id, prompt_preview, status, labels, depends_on, updated_at.
  Pass --full to print complete TaskRow objects.
  task list excludes done tasks unless --state done is passed.

Diagnostics:
  debug process-memory prints read-only Rust sidecar, plugin host, and PTY process-tree RSS attribution.

Task creation hygiene:
  Before creating follow-up Tasks, use project labels list when a project id is known and reuse an existing label when it fits.
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  For non-linear multi-Task follow-up work, use task plan apply as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys are resolved in one operation.
  For simple follow-up work, link prerequisites immediately with --depends-on or task dependencies link.
  If labels or dependency order are unclear, state that uncertainty instead of guessing.

Examples:
  openforge project labels list --project-id P-1
  openforge debug process-memory
  openforge task list --project-id P-1
  openforge task start --task-id T-123
  openforge task delete --task-id T-123
  openforge task create --initial-prompt "Correct task prompt" --project-id P-1 --depends-on T-122 --label cleanup
  openforge task dependencies set --task-id T-999 --depends-on T-456,T-122
  openforge task plan apply --file follow-up-plan.json

Environment:
  OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: 17422)
`);
}

function printCommandHelp(spec) {
  const planJsonHelp = spec.path.join(' ') === 'task plan apply' ? `\nPlan JSON shape:\n  {\n    "projectId": "P-1",\n    "tasks": [\n      { "key": "api", "prompt": "Build API", "labels": ["backend"] },\n      { "key": "ui", "prompt": "Build UI", "dependsOn": ["api", "KVG-1957"] }\n    ]\n  }\n\nPlan JSON fields:\n  projectId is optional when the OpenForge bridge can infer the project; include it when known.\n  tasks[].key is a stable local name used by other tasks in dependsOn.\n  tasks[].prompt becomes the new task prompt; initialPrompt is also accepted.\n  tasks[].labels is optional.\n  dependsOn is where current or prerequisite task IDs go; values may be local keys or existing task IDs.\n` : '';
  const startHelp = spec.path.join(' ') === 'task start' ? `\nTask starting:\n  task start uses persisted task and project configuration and starts the native configured implementation flow.\n  Existing dependency and active-session safeguards remain enforced alongside concurrent-start, workspace, provider, and PTY checks.\n` : '';

  console.log(`OpenForge CLI

Usage:
  ${spec.usage}
${planJsonHelp}${startHelp}
Task prompt semantics:
  task create sets the task's initial_prompt from --initial-prompt.
  task update --summary updates only the task summary/Handoff Notes.
  task update --initial-prompt updates initial_prompt and prompt together only while the task has never started.
  Started or completed tasks reject prompt updates; create a replacement task instead.

Task creation hygiene:
  Before creating follow-up Tasks, use project labels list when a project id is known and reuse an existing label when it fits.
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  For non-linear multi-Task follow-up work, use task plan apply as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys are resolved in one operation.
  For simple follow-up work, link prerequisites immediately with --depends-on or task dependencies link.
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

  const { spec, commandName, rest } = resolved;
  const { flags, positionals } = parseFlags(rest);

  if (shouldPrintCommandHelp(flags)) {
    printCommandHelp(spec);
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
