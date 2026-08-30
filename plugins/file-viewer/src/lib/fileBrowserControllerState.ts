import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { FileBrowserProjectState } from './fileExplorer'

export interface FileBrowserControllerState {
  api: FrontendOpenForgeAPI
  getProjectId(): string | null
  getProjectState(projectId: string): FileBrowserProjectState
  updateProjectState(
    projectId: string,
    updater: (state: FileBrowserProjectState) => FileBrowserProjectState,
  ): void
}

export function formatFileBrowserError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
