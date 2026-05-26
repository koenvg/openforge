import packageJson from '../../plugins/file-viewer/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { executePluginCommand } from './plugin/pluginActivationLifecycle'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const FILE_VIEWER_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const FILE_VIEWER_PLUGIN_ID = FILE_VIEWER_PLUGIN_MANIFEST.id
export const FILE_VIEWER_VIEW_ID = 'files'
export const FILE_VIEWER_VIEW_KEY: PluginViewKey = makePluginViewKey(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_VIEW_ID)
/** File-viewer-owned command for revealing a project-relative path. Payload: { path: string }. */
export const FILE_VIEWER_REVEAL_FILE_COMMAND_ID = 'revealFile'

export async function revealFileInFileViewer(path: string): Promise<boolean> {
  return executePluginCommand(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_REVEAL_FILE_COMMAND_ID, { path })
}
