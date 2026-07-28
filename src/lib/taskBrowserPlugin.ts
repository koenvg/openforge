import packageJson from '../../plugins/task-browser/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import type { PluginManifest } from './plugin/types'

export const TASK_BROWSER_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const TASK_BROWSER_PLUGIN_ID = TASK_BROWSER_PLUGIN_MANIFEST.id
