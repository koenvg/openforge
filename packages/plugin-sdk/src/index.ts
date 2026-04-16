// Re-export all plugin types from the host
export type {
  PluginManifest,
  PluginContext,
  PluginActivationResult,
  PluginContributionPoints,
  PluginViewContribution,
  PluginTaskPaneTabContribution,
  PluginSidebarPanelContribution,
  PluginCommandContribution,
  PluginSettingsSection,
  PluginBackgroundService,
  PluginState,
  PluginEntry,
  PluginViewKey,
} from '../../src/lib/plugin/types'

export { MAX_SUPPORTED_API_VERSION } from '../../src/lib/plugin/types'
export { validatePluginManifest, isValidShortcutFormat, normalizeShortcut } from '../../src/lib/plugin/manifest'

// SDK-specific exports
export { PluginContextImpl } from './context'
export { isPluginViewContribution, isPluginCommandContribution } from './helpers'
