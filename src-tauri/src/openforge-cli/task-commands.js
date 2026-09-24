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

async function clearTaskDependencies(flags) {
  printJson(await requestJson('/set_task_dependencies', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: [] }),
  }));
}

async function removeTaskDependency(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  if (dependsOn.length !== 1) {
    throw new Error('task dependencies remove requires exactly one --depends-on task id');
  }
  printJson(await requestJson('/remove_task_dependency', {
    method: 'POST',
    body: JSON.stringify({ task_id: requireFlag(flags, 'taskId'), depends_on: dependsOn[0] }),
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
  const completedFrom = optionalString(flags, 'completedFrom');
  const completedBefore = optionalString(flags, 'completedBefore');
  if ((completedFrom === undefined) !== (completedBefore === undefined)) {
    throw new Error('task completed requires both --completed-from and --completed-before');
  }
  if (search !== undefined) params.set('search', search);
  for (const label of labelNamesFromFlag(flags)) params.append('labels', label);
  if (cursor !== undefined) params.set('cursor', cursor);
  if (completedFrom !== undefined) params.set('completedFrom', completedFrom);
  if (completedBefore !== undefined) params.set('completedBefore', completedBefore);
  const query = params.toString();
  printJson(await requestJson(`/v2/projects/${canonicalProjectPath(flags)}/tasks/completed${query ? `?${query}` : ''}`));
}

async function readTaskDetail(flags) {
  const projectId = canonicalProjectPath(flags);
  const taskId = encodeURIComponent(requireFlag(flags, 'taskId'));
  printJson(await requestJson(`/v2/projects/${projectId}/tasks/${taskId}`));
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
    path: ['task', 'dependencies', 'remove'],
    flags: ['taskId', 'dependsOn'],
    usage: 'openforge task dependencies remove --task-id <id> --depends-on <task-id>',
    handler: removeTaskDependency,
  },
  {
    path: ['task', 'dependencies', 'clear'],
    flags: ['taskId'],
    usage: 'openforge task dependencies clear --task-id <id>',
    handler: clearTaskDependencies,
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
    flags: ['projectId', 'search', 'label', 'cursor', 'completedFrom', 'completedBefore'],
    usage: 'openforge task completed --project-id <id> [--search <text>] [--label <name>] [--cursor <cursor>] [--completed-from <unix-seconds> --completed-before <unix-seconds>]',
    handler: readCompletedTasks,
  },
  {
    path: ['task', 'detail'],
    flags: ['projectId', 'taskId'],
    usage: 'openforge task detail --project-id <id> --task-id <id>',
    handler: readTaskDetail,
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
];
