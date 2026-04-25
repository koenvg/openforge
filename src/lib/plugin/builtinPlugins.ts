import { FILE_VIEWER_PLUGIN_MANIFEST } from '../fileViewerPlugin'
import { GITHUB_SYNC_PLUGIN_MANIFEST } from '../githubSyncPlugin'
import { SKILLS_VIEWER_PLUGIN_MANIFEST } from '../skillsViewerPlugin'
import { TERMINAL_PLUGIN_MANIFEST } from '../terminalPlugin'
import type { PluginManifest } from './types'

export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = [
  FILE_VIEWER_PLUGIN_MANIFEST,
  GITHUB_SYNC_PLUGIN_MANIFEST,
  SKILLS_VIEWER_PLUGIN_MANIFEST,
  TERMINAL_PLUGIN_MANIFEST,
]
