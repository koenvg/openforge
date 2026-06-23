import packageJson from '../../plugins/roadmap/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const ROADMAP_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const ROADMAP_PLUGIN_ID = ROADMAP_PLUGIN_MANIFEST.id
export const ROADMAP_VIEW_ID = 'roadmap'
export const ROADMAP_VIEW_KEY: PluginViewKey = makePluginViewKey(ROADMAP_PLUGIN_ID, ROADMAP_VIEW_ID)
