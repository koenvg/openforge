import { get } from 'svelte/store'
import {
  fsReadDir,
  fsReadFile,
  fsWriteFile,
  fsSearchFiles,
  taskFsReadDir,
  taskFsReadFile,
  taskFsSearchFiles,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  listOpenCodeCommands,
  setProjectConfig,
} from '../ipc'
import { activeProjectId } from '../stores'
import type { PluginHostCommandEntries } from './pluginHostCommandRegistry'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type ProjectHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'listProjects'
  | 'getProject'
  | 'listCommandCatalog'
  | 'readDir'
  | 'readFile'
  | 'writeFile'
  | 'searchFiles'
  | 'readTaskDir'
  | 'readTaskFile'
  | 'searchTaskFiles'
  | 'getAttention'
  | 'getProjectConfig'
  | 'setProjectConfig'
>>

async function getProject(projectId: string) {
  return (await getProjects()).find((project) => project.id === projectId) ?? null
}

function listCommandCatalog(request?: { projectId?: string | null }) {
  // The Claude catalog is project-scoped in the sidecar; with no project there
  // are no project-independent entries to return yet, so yield an empty list.
  return request?.projectId ? listOpenCodeCommands(request.projectId) : Promise.resolve([])
}

function readProjectDir(request: { projectId: string; path?: string | null }) {
  return fsReadDir(request.projectId, request.path ?? null)
}

function readProjectFile(request: { projectId: string; path: string }) {
  return fsReadFile(request.projectId, request.path)
}

function writeProjectFile(request: { projectId: string; path: string; content: string }) {
  return fsWriteFile(request.projectId, request.path, request.content)
}

function searchProjectFiles(request: { projectId: string; query: string; limit?: number }) {
  return fsSearchFiles(request.projectId, request.query, request.limit)
}

function readTaskDir(request: { taskId: string; path?: string | null }) {
  return taskFsReadDir(request.taskId, request.path ?? null)
}

function readTaskFile(request: { taskId: string; path: string }) {
  return taskFsReadFile(request.taskId, request.path)
}

function searchTaskFiles(request: { taskId: string; query: string; limit?: number }) {
  return taskFsSearchFiles(request.taskId, request.query, request.limit)
}

function setProjectConfigValue(projectId: string, key: string, value: unknown) {
  return setProjectConfig(projectId, key, typeof value === 'string' ? value : JSON.stringify(value))
}

export function createPluginProjectHostCapabilities(): ProjectHostCapabilities {
  return {
    listProjects: () => getProjects(),
    getProject,
    listCommandCatalog,
    readDir: readProjectDir,
    readFile: readProjectFile,
    writeFile: writeProjectFile,
    searchFiles: searchProjectFiles,
    readTaskDir,
    readTaskFile,
    searchTaskFiles,
    getAttention: () => getProjectAttention(),
    getProjectConfig: (projectId, key) => getProjectConfig(projectId, key),
    setProjectConfig: setProjectConfigValue,
  }
}

export const projectCommandHandlers: PluginHostCommandEntries = [
  ['getProjectContext', (payload) => {
    const projectId = typeof payload?.projectId === 'string' ? payload.projectId : get(activeProjectId)
    return { projectId }
  }],
  ['fsReadDir', (payload) => readProjectDir({
    projectId: String(payload?.projectId ?? ''),
    path: typeof payload?.dirPath === 'string' ? payload.dirPath : null,
  })],
  ['fsReadFile', (payload) => readProjectFile({
    projectId: String(payload?.projectId ?? ''),
    path: String(payload?.filePath ?? ''),
  })],
  ['getProjectConfig', (payload) =>
    getProjectConfig(String(payload?.projectId ?? ''), String(payload?.key ?? ''))],
  ['setProjectConfig', (payload) => setProjectConfigValue(
    String(payload?.projectId ?? ''),
    String(payload?.key ?? ''),
    String(payload?.value ?? ''),
  )],
]
