import type { ResolvedViewReplacement } from './contributionResolver'
import {
  CORE_VIEW_REPLACEMENT_PROVIDER_ID,
  INHERIT_VIEW_REPLACEMENT_PROVIDER_ID,
  createViewReplacementProviderPreferences,
  isViewReplacementProviderAvailable,
  parseGlobalViewReplacementProviderId,
  parseProjectViewReplacementProviderId,
  resolveViewReplacementProviderAvailability,
  type ViewReplacementProviderAvailability,
  type ViewReplacementProviderUnavailableReason,
} from './viewReplacementProviders'

export const CORE_PROJECT_DASHBOARD_PROVIDER_ID = CORE_VIEW_REPLACEMENT_PROVIDER_ID
export const INHERIT_PROJECT_DASHBOARD_PROVIDER_ID = INHERIT_VIEW_REPLACEMENT_PROVIDER_ID
export const PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY = 'project_dashboard_provider'

const preferences = createViewReplacementProviderPreferences({
  configKey: PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
})

export const globalProjectDashboardProviderId = preferences.globalProviderId
export const globalProjectDashboardProviderLoaded = preferences.globalProviderLoaded
export const projectDashboardProviderIds = preferences.projectProviderIds
export const loadGlobalProjectDashboardProviderId = preferences.loadGlobalProviderId
export const setGlobalProjectDashboardProviderId = preferences.setGlobalProviderId
export const loadProjectDashboardProviderId = preferences.loadProjectProviderId
export const reloadProjectDashboardProviderId = preferences.reloadProjectProviderId
export const setProjectDashboardProviderId = preferences.setProjectProviderId
export const clearProjectDashboardProviderIds = preferences.clearProviderIds

export const parseGlobalProjectDashboardProviderId = parseGlobalViewReplacementProviderId
export const parseProjectDashboardProviderId = parseProjectViewReplacementProviderId

export type ProjectDashboardProviderUnavailableReason = ViewReplacementProviderUnavailableReason
export type ProjectDashboardProviderAvailability = ViewReplacementProviderAvailability

export function resolveProjectDashboardProvider(
  configuredId: string,
  providers: readonly ResolvedViewReplacement[],
): { configuredId: string; provider: ResolvedViewReplacement | null } {
  if (configuredId === CORE_PROJECT_DASHBOARD_PROVIDER_ID) {
    return { configuredId, provider: null }
  }
  const provider = providers.find(
    candidate => candidate.target === 'project.dashboard' && candidate.qualifiedId === configuredId,
  ) ?? null
  return { configuredId, provider }
}

export function resolveProjectDashboardProviderAvailability(
  projectPreferenceId: string,
  globalDefaultId: string,
  providers: readonly ResolvedViewReplacement[],
  pluginEntries: ReadonlyMap<string, { state: string }>,
): ProjectDashboardProviderAvailability {
  return resolveViewReplacementProviderAvailability(
    'project.dashboard',
    projectPreferenceId,
    globalDefaultId,
    providers,
    pluginEntries,
  )
}

export function isProjectDashboardProviderAvailable(
  provider: ResolvedViewReplacement,
  pluginEntries: ReadonlyMap<string, { state: string }>,
): boolean {
  return isViewReplacementProviderAvailable('project.dashboard', provider, pluginEntries)
}
