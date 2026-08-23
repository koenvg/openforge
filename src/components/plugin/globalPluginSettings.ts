import type { PluginEntry } from '../../lib/plugin/types'

export function pluginActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isBuiltInPlugin(plugin: PluginEntry): boolean {
  return plugin.isBuiltin === true || plugin.sourceKind === 'builtin'
}

export function pluginSourceLabel(plugin: PluginEntry): string {
  if (plugin.sourceSpec) return plugin.sourceSpec
  if (plugin.isBuiltin) return 'Built-in plugin'
  return plugin.installPath ?? 'Unknown source'
}
