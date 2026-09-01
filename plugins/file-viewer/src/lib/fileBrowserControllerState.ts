import type { FileBrowserWorkspaceState } from './fileExplorer'
import type { FileBrowserWorkspaceIdentity, FileBrowserWorkspaceSource } from './workspaceSource'

export interface FileBrowserControllerState {
  getWorkspaceSource(): FileBrowserWorkspaceSource | null
  getWorkspaceState(workspaceIdentity: FileBrowserWorkspaceIdentity): FileBrowserWorkspaceState
  updateWorkspaceState(
    workspaceIdentity: FileBrowserWorkspaceIdentity,
    updater: (state: FileBrowserWorkspaceState) => FileBrowserWorkspaceState,
  ): void
}

export function formatFileBrowserError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
