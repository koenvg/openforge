import type { LoadedPluginModule } from './pluginLoader'
import { FILE_VIEWER_PLUGIN_ID } from '../fileViewerPlugin'
import { GITHUB_SYNC_PLUGIN_ID } from '../githubSyncPlugin'
import { TERMINAL_PLUGIN_ID } from '../terminalPlugin'
import { TASK_SCHEDULES_PLUGIN_ID } from '../taskSchedulesPlugin'
import fileViewerPlugin from '../../../plugins/file-viewer/src/index'
import githubSyncPlugin from '../../../plugins/github-sync/src/index'
import terminalPlugin from '../../../plugins/terminal/src/index'
import taskSchedulesPlugin from '../../../plugins/task-schedules/src/index'

const BUILTIN_PLUGIN_MODULES: Record<string, LoadedPluginModule> = {
  [FILE_VIEWER_PLUGIN_ID]: fileViewerPlugin,
  [GITHUB_SYNC_PLUGIN_ID]: githubSyncPlugin,
  [TERMINAL_PLUGIN_ID]: terminalPlugin,
  [TASK_SCHEDULES_PLUGIN_ID]: taskSchedulesPlugin,
}

export function getBuiltinPluginModule(pluginId: string): LoadedPluginModule | undefined {
  return BUILTIN_PLUGIN_MODULES[pluginId]
}
