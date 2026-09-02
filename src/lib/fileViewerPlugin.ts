import { executePluginCommand } from './plugin/pluginActivationLifecycle'
import { FILE_VIEWER_PLUGIN_ID } from './fileViewerView'

/** File-viewer-owned command for revealing a project-relative path. Payload: { path: string }. */
export const FILE_VIEWER_REVEAL_FILE_COMMAND_ID = 'revealFile'

export async function revealFileInFileViewer(path: string): Promise<boolean> {
  return executePluginCommand(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_REVEAL_FILE_COMMAND_ID, { path })
}

export async function revealFileInTaskFiles(taskId: string, path: string, suffix: string): Promise<boolean> {
  return executePluginCommand(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_REVEAL_FILE_COMMAND_ID, { path, taskId, suffix })
}
