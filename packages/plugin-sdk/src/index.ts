// Re-export all plugin types from the host
export { isValidShortcutFormat, normalizeShortcut, validatePluginManifest } from '../../../src/lib/plugin/manifest'
export {
  MAX_SUPPORTED_API_VERSION,
  type PluginActivationResult,
  type PluginBackgroundService,
  type PluginCommandContribution,
  type PluginContext,
  type PluginContributionPoints,
  type PluginEntry,
  type PluginManifest,
  type PluginSettingsSection,
  type PluginSidebarPanelContribution,
  type PluginState,
  type PluginTaskPaneTabContribution,
  type PluginViewContribution,
  type PluginViewKey,
} from '../../../src/lib/plugin/types'

// SDK-specific exports
export { PluginContextImpl } from './context'
export { isPluginCommandContribution, isPluginViewContribution } from './helpers'
