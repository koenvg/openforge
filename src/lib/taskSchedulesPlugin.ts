import packageJson from '../../plugins/task-schedules/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const TASK_SCHEDULES_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const TASK_SCHEDULES_PLUGIN_ID = TASK_SCHEDULES_PLUGIN_MANIFEST.id
export const TASK_SCHEDULES_VIEW_ID = 'schedules'
export const TASK_SCHEDULES_VIEW_KEY: PluginViewKey = makePluginViewKey(TASK_SCHEDULES_PLUGIN_ID, TASK_SCHEDULES_VIEW_ID)
