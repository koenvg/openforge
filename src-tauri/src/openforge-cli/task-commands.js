import { readFile } from 'node:fs/promises';

import { optionalString, requireFlag, stringListFromFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

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
  const payload = {
    task_id: requireFlag(flags, 'taskId'),
    initial_prompt: requireFlag(flags, 'initialPrompt'),
  };
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

function canonicalProjectPath(flags) {
  return encodeURIComponent(requireFlag(flags, 'projectId'));
}

async function readActiveTasks(flags) {
  printJson(await requestJson(`/v2/projects/${canonicalProjectPath(flags)}/tasks/active`));
}

async function readCompletedTasks(flags) {
  const params = new URLSearchParams();
  const search = optionalString(flags, 'search');
  const cursor = optionalString(flags, 'cursor');
  if (search !== undefined) params.set('search', search);
  for (const label of labelNamesFromFlag(flags)) params.append('labels', label);
  if (cursor !== undefined) params.set('cursor', cursor);
  const query = params.toString();
  printJson(await requestJson(`/v2/projects/${canonicalProjectPath(flags)}/tasks/completed${query ? `?${query}` : ''}`));
}

async function readTaskDetail(flags) {
  const projectId = canonicalProjectPath(flags);
  const taskId = encodeURIComponent(requireFlag(flags, 'taskId'));
  printJson(await requestJson(`/v2/projects/${projectId}/tasks/${taskId}`));
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

export const TASK_COMMAND_SPECS = [
  {
    path: ['task', 'create'],
    flags: ['initialPrompt', 'projectId', 'worktree', 'dependsOn', 'label'],
    usage: 'openforge task create --initial-prompt <text> [--project-id <id>] [--worktree <path>] [--depends-on <task-id>[,<task-id>...]] [--label <name>[,<name>...]]',
    handler: createTask,
  },
  {
    path: ['task', 'update'],
    flags: ['taskId', 'initialPrompt'],
    usage: 'openforge task update --task-id <id> --initial-prompt <text>',
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
    path: ['task', 'active'],
    flags: ['projectId'],
    usage: 'openforge task active --project-id <id>',
    handler: readActiveTasks,
  },
  {
    path: ['task', 'completed'],
    flags: ['projectId', 'search', 'label', 'cursor'],
    usage: 'openforge task completed --project-id <id> [--search <text>] [--label <name>] [--cursor <cursor>]',
    handler: readCompletedTasks,
  },
  {
    path: ['task', 'detail'],
    flags: ['projectId', 'taskId'],
    usage: 'openforge task detail --project-id <id> --task-id <id>',
    handler: readTaskDetail,
  },
  {
    path: ['task', 'get'],
    flags: ['taskId'],
    usage: '[deprecated; removed in v2] openforge task get --task-id <id>',
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
    usage: '[deprecated; removed in v2] openforge task list --project-id <id> [--state backlog|doing|done] [--full]',
    handler: listTasks,
  },
  {
    path: ['task', 'plan', 'apply'],
    flags: ['file'],
    usage: 'openforge task plan apply --file <plan.json>',
    handler: applyTaskPlan,
  },
];
