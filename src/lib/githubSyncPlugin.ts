import packageJson from '../../plugins/github-sync/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const GITHUB_SYNC_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const GITHUB_SYNC_PLUGIN_ID = GITHUB_SYNC_PLUGIN_MANIFEST.id
export const GITHUB_SYNC_VIEW_ID = 'pr_review'
export const GITHUB_SYNC_VIEW_KEY: PluginViewKey = makePluginViewKey(GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_VIEW_ID)

// The all-repos PR view (same component, scoped 'global'). Opening it tells the
// poller to poll every repo; otherwise polling is scoped to the active repo.
export const GITHUB_SYNC_GLOBAL_VIEW_ID = 'pr_review_global'
export const GITHUB_SYNC_GLOBAL_VIEW_KEY: PluginViewKey = makePluginViewKey(GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_ID)
