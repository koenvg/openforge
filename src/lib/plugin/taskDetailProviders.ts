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

export const CORE_TASK_DETAIL_PROVIDER_ID = CORE_VIEW_REPLACEMENT_PROVIDER_ID
export const INHERIT_TASK_DETAIL_PROVIDER_ID = INHERIT_VIEW_REPLACEMENT_PROVIDER_ID
export const TASK_DETAIL_PROVIDER_CONFIG_KEY = 'task_detail_provider'

const preferences = createViewReplacementProviderPreferences({
  configKey: TASK_DETAIL_PROVIDER_CONFIG_KEY,
})

export const globalTaskDetailProviderId = preferences.globalProviderId
export const globalTaskDetailProviderLoaded = preferences.globalProviderLoaded
export const projectTaskDetailProviderIds = preferences.projectProviderIds
export const loadGlobalTaskDetailProviderId = preferences.loadGlobalProviderId
export const setGlobalTaskDetailProviderId = preferences.setGlobalProviderId
export const loadProjectTaskDetailProviderId = preferences.loadProjectProviderId
export const reloadProjectTaskDetailProviderId = preferences.reloadProjectProviderId
export const setProjectTaskDetailProviderId = preferences.setProjectProviderId
export const clearTaskDetailProviderIds = preferences.clearProviderIds

export const parseGlobalTaskDetailProviderId = parseGlobalViewReplacementProviderId
export const parseProjectTaskDetailProviderId = parseProjectViewReplacementProviderId

export type TaskDetailProviderUnavailableReason = ViewReplacementProviderUnavailableReason
export type TaskDetailProviderAvailability = ViewReplacementProviderAvailability

export function resolveTaskDetailProviderAvailability(
  projectPreferenceId: string,
  globalDefaultId: string,
  providers: readonly ResolvedViewReplacement[],
  pluginEntries: ReadonlyMap<string, { state: string }>,
): TaskDetailProviderAvailability {
  return resolveViewReplacementProviderAvailability(
    'task.detail',
    projectPreferenceId,
    globalDefaultId,
    providers,
    pluginEntries,
  )
}

export function isTaskDetailProviderAvailable(
  provider: ResolvedViewReplacement,
  pluginEntries: ReadonlyMap<string, { state: string }>,
): boolean {
  return isViewReplacementProviderAvailable('task.detail', provider, pluginEntries)
}
