import { readFile } from 'node:fs/promises';

import { requireFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

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
  const keyToTaskId = Object.create(null);
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

export const TASK_PLAN_COMMAND_SPECS = [
  {
    path: ['task', 'plan', 'apply'],
    flags: ['file'],
    usage: 'openforge task plan apply --file <plan.json>',
    handler: applyTaskPlan,
  },
];
