import { writable } from 'svelte/store'
import { getProjectConfig, setProjectConfig } from '../ipc'
import type { ResolvedViewReplacement } from './contributionResolver'
import { getRegisteredRenderableComponent } from './componentRegistry'

export const CORE_PROJECT_DASHBOARD_PROVIDER_ID = 'core'
export const PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY = 'project_dashboard_provider'

export const projectDashboardProviderIds = writable<Map<string, string>>(new Map())

const pendingLoads = new Map<string, Promise<string>>()
const loadGenerations = new Map<string, number>()

export function parseProjectDashboardProviderId(value: unknown): string {
  if (value === CORE_PROJECT_DASHBOARD_PROVIDER_ID) return value
  if (typeof value !== 'string' || !/^\S+\.\S+$/.test(value) || value.includes(':')) {
    return CORE_PROJECT_DASHBOARD_PROVIDER_ID
  }
  return value
}

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

export type ProjectDashboardProviderUnavailableReason =
  | 'missing-contribution'
  | 'missing-component'
  | 'plugin-error'

export interface ProjectDashboardProviderAvailability {
  configuredId: string
  configuredProvider: ResolvedViewReplacement | null
  provider: ResolvedViewReplacement | null
  unavailableReason: ProjectDashboardProviderUnavailableReason | null
}

type ProjectDashboardPluginEntry = { state: string }

export function resolveProjectDashboardProviderAvailability(
  configuredId: string,
  providers: readonly ResolvedViewReplacement[],
  pluginEntries: ReadonlyMap<string, ProjectDashboardPluginEntry>,
): ProjectDashboardProviderAvailability {
  if (configuredId === CORE_PROJECT_DASHBOARD_PROVIDER_ID) {
    return { configuredId, configuredProvider: null, provider: null, unavailableReason: null }
  }

  const configuredProvider = resolveProjectDashboardProvider(configuredId, providers).provider
  if (!configuredProvider) {
    return { configuredId, configuredProvider: null, provider: null, unavailableReason: 'missing-contribution' }
  }
  if (pluginEntries.get(configuredProvider.pluginId)?.state === 'error') {
    return { configuredId, configuredProvider, provider: null, unavailableReason: 'plugin-error' }
  }

  const component = getRegisteredRenderableComponent(
    'viewReplacements',
    `${configuredProvider.pluginId}:${configuredProvider.contributionId}`,
  )
  if (!component) {
    return { configuredId, configuredProvider, provider: null, unavailableReason: 'missing-component' }
  }
  return { configuredId, configuredProvider, provider: configuredProvider, unavailableReason: null }
}

export function isProjectDashboardProviderAvailable(
  provider: ResolvedViewReplacement,
  pluginEntries: ReadonlyMap<string, ProjectDashboardPluginEntry>,
): boolean {
  return resolveProjectDashboardProviderAvailability(
    provider.qualifiedId,
    [provider],
    pluginEntries,
  ).provider !== null
}

export function loadProjectDashboardProviderId(projectId: string): Promise<string> {
  const existing = pendingLoads.get(projectId)
  if (existing) return existing

  const generation = (loadGenerations.get(projectId) ?? 0) + 1
  loadGenerations.set(projectId, generation)
  const pending = (async () => {
    const providerId = parseProjectDashboardProviderId(
      await getProjectConfig(projectId, PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY),
    )
    if (loadGenerations.get(projectId) === generation) {
      projectDashboardProviderIds.update((current) => {
        const next = new Map(current)
        next.set(projectId, providerId)
        return next
      })
    }
    return providerId
  })()
  pendingLoads.set(projectId, pending)
  void pending.then(
    () => { if (pendingLoads.get(projectId) === pending) pendingLoads.delete(projectId) },
    () => { if (pendingLoads.get(projectId) === pending) pendingLoads.delete(projectId) },
  )
  return pending
}

export async function setProjectDashboardProviderId(projectId: string, providerId: string): Promise<void> {
  const parsed = parseProjectDashboardProviderId(providerId)
  loadGenerations.set(projectId, (loadGenerations.get(projectId) ?? 0) + 1)
  await setProjectConfig(projectId, PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY, parsed)
  projectDashboardProviderIds.update((current) => {
    const next = new Map(current)
    next.set(projectId, parsed)
    return next
  })
}

export function clearProjectDashboardProviderIds(): void {
  pendingLoads.clear()
  loadGenerations.clear()
  projectDashboardProviderIds.set(new Map())
}
