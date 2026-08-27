import type { LoadedPluginModule } from './pluginLoader'
import { FILE_VIEWER_PLUGIN_ID } from '../fileViewerView'
import { GITHUB_SYNC_PLUGIN_ID } from '../githubSyncPlugin'
import { TASK_BROWSER_PLUGIN_ID } from '../taskBrowserPlugin'
import { TASK_SCHEDULES_PLUGIN_ID } from '../taskSchedulesPlugin'
import { TERMINAL_PLUGIN_ID } from '../terminalPlugin'
import fileViewerPlugin from '../../../plugins/file-viewer/src/index'
import githubSyncPlugin from '../../../plugins/github-sync/src/index'
import taskBrowserPlugin from '../../../plugins/task-browser/src/index'
import taskSchedulesPlugin from '../../../plugins/task-schedules/src/index'
import terminalPlugin from '../../../plugins/terminal/src/index'
import { configureTerminalSessionClient } from '../../../plugins/terminal/src/lib/terminalPool'
import { regularTerminalSessions } from '../terminalSessionService'

configureTerminalSessionClient(regularTerminalSessions)

const BUILTIN_PLUGIN_MODULES: Record<string, LoadedPluginModule> = {
  [FILE_VIEWER_PLUGIN_ID]: fileViewerPlugin,
  [GITHUB_SYNC_PLUGIN_ID]: githubSyncPlugin,
  [TASK_BROWSER_PLUGIN_ID]: taskBrowserPlugin,
  [TASK_SCHEDULES_PLUGIN_ID]: taskSchedulesPlugin,
  [TERMINAL_PLUGIN_ID]: terminalPlugin,
}

export function getBuiltinPluginModule(pluginId: string): LoadedPluginModule | undefined {
  return BUILTIN_PLUGIN_MODULES[pluginId]
}
