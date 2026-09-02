import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'

export type FileBrowserWorkspaceIdentity = `${string}:${string}`

export interface FileBrowserWorkspaceSource {
  readonly identity: FileBrowserWorkspaceIdentity
  readDirectory(path: string | null): Promise<FileEntry[]>
  readFile(path: string): Promise<FileContent>
  searchFiles(query: string, limit: number): Promise<string[]>
}

export function projectWorkspaceIdentity(projectId: string): FileBrowserWorkspaceIdentity {
  return `project:${projectId}`
}

export function taskWorkspaceIdentity(taskId: string): FileBrowserWorkspaceIdentity {
  return `task:${taskId}`
}

export function createProjectWorkspaceSource(
  api: FrontendOpenForgeAPI,
  projectId: string,
): FileBrowserWorkspaceSource {
  return {
    identity: projectWorkspaceIdentity(projectId),
    readDirectory: (path) => api.fs.readDir({ projectId, path }),
    readFile: (path) => api.fs.readFile({ projectId, path }),
    searchFiles: (query, limit) => api.fs.searchFiles({ projectId, query, limit }),
  }
}

export function createTaskWorkspaceSource(
  api: FrontendOpenForgeAPI,
  taskId: string,
): FileBrowserWorkspaceSource {
  return {
    identity: taskWorkspaceIdentity(taskId),
    readDirectory: (path) => api.fs.task.readDir({ taskId, path }),
    readFile: (path) => api.fs.task.readFile({ taskId, path }),
    searchFiles: (query, limit) => api.fs.task.searchFiles({ taskId, query, limit }),
  }
}
