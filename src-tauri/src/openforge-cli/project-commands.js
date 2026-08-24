import { requireFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

async function listProjects() {
  printJson(await requestJson('/projects'));
}

async function listProjectLabels(flags) {
  const projectId = encodeURIComponent(requireFlag(flags, 'projectId'));
  printJson(await requestJson(`/project/${projectId}/labels`));
}

export const PROJECT_LIST_COMMAND_SPEC = {
  path: ['project', 'list'],
  flags: [],
  usage: 'openforge project list',
  handler: listProjects,
};

export const PROJECT_LABELS_COMMAND_SPEC = {
  path: ['project', 'labels', 'list'],
  flags: ['projectId'],
  usage: 'openforge project labels list --project-id <id>',
  handler: listProjectLabels,
};
