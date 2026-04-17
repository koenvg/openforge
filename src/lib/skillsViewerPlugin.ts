import manifestJson from '../../plugins/skills-viewer/manifest.json'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const SKILLS_VIEWER_PLUGIN_MANIFEST: PluginManifest = manifestJson
export const SKILLS_VIEWER_PLUGIN_ID = SKILLS_VIEWER_PLUGIN_MANIFEST.id
export const SKILLS_VIEWER_VIEW_ID = 'skills'
export const SKILLS_VIEWER_VIEW_KEY: PluginViewKey = makePluginViewKey(SKILLS_VIEWER_PLUGIN_ID, SKILLS_VIEWER_VIEW_ID)
