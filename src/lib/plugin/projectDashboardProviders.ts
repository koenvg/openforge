import { writable } from 'svelte/store'
import { clearProjectConfig, getConfig, getProjectConfig, setConfig, setProjectConfig } from '../ipc'
import type { ResolvedViewReplacement } from './contributionResolver'
import { getRegisteredRenderableComponent } from './componentRegistry'

export const CORE_PROJECT_DASHBOARD_PROVIDER_ID = 'core'
export const INHERIT_PROJECT_DASHBOARD_PROVIDER_ID = 'inherit'
export const PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY = 'project_dashboard_provider'

export const globalProjectDashboardProviderId = writable<string>(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
export const globalProjectDashboardProviderLoaded = writable(false)
export const projectDashboardProviderIds = writable<Map<string, string>>(new Map())

let pendingGlobalLoad: Promise<string> | null = null
let globalLoadGeneration = 0
const pendingProjectLoads = new Map<string, Promise<string>>()
const projectLoadGenerations = new Map<string, number>()

function isQualifiedProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^\S+\.\S+$/.test(value) && !value.includes(':')
}

export function parseGlobalProjectDashboardProviderId(value: unknown): string {
  if (value === CORE_PROJECT_DASHBOARD_PROVIDER_ID || isQualifiedProviderId(value)) return value
  return CORE_PROJECT_DASHBOARD_PROVIDER_ID
}

export function parseProjectDashboardProviderId(value: unknown): string {
  if (
    value === INHERIT_PROJECT_DASHBOARD_PROVIDER_ID
    || value === CORE_PROJECT_DASHBOARD_PROVIDER_ID
    || isQualifiedProviderId(value)
  ) return value
  return INHERIT_PROJECT_DASHBOARD_PROVIDER_ID
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
  | 'inactive-plugin'
  | 'missing-component'
  | 'plugin-error'

export interface ProjectDashboardProviderAvailability {
  projectPreferenceId: string
  globalDefaultId: string
  configuredId: string
  configuredProvider: ResolvedViewReplacement | null
  provider: ResolvedViewReplacement | null
  unavailableReason: ProjectDashboardProviderUnavailableReason | null
}

type ProjectDashboardPluginEntry = { state: string }

export function resolveProjectDashboardProviderAvailability(
  projectPreferenceId: string,
  globalDefaultId: string,
  providers: readonly ResolvedViewReplacement[],
  pluginEntries: ReadonlyMap<string, ProjectDashboardPluginEntry>,
): ProjectDashboardProviderAvailability {
  const parsedProjectPreferenceId = parseProjectDashboardProviderId(projectPreferenceId)
  const parsedGlobalDefaultId = parseGlobalProjectDashboardProviderId(globalDefaultId)
  const configuredId = parsedProjectPreferenceId === INHERIT_PROJECT_DASHBOARD_PROVIDER_ID
    ? parsedGlobalDefaultId
    : parsedProjectPreferenceId
  const base = {
    projectPreferenceId: parsedProjectPreferenceId,
    globalDefaultId: parsedGlobalDefaultId,
    configuredId,
  }

  if (configuredId === CORE_PROJECT_DASHBOARD_PROVIDER_ID) {
    return { ...base, configuredProvider: null, provider: null, unavailableReason: null }
  }

  const configuredProvider = resolveProjectDashboardProvider(configuredId, providers).provider
  if (!configuredProvider) {
    return { ...base, configuredProvider: null, provider: null, unavailableReason: 'missing-contribution' }
  }

  const pluginState = pluginEntries.get(configuredProvider.pluginId)?.state
  if (pluginState === 'error') {
    return { ...base, configuredProvider, provider: null, unavailableReason: 'plugin-error' }
  }
  if (pluginState !== 'active') {
    return { ...base, configuredProvider, provider: null, unavailableReason: 'inactive-plugin' }
  }

  const component = getRegisteredRenderableComponent(
    'viewReplacements',
    `${configuredProvider.pluginId}:${configuredProvider.contributionId}`,
  )
  if (!component) {
    return { ...base, configuredProvider, provider: null, unavailableReason: 'missing-component' }
  }
  return { ...base, configuredProvider, provider: configuredProvider, unavailableReason: null }
}

export function isProjectDashboardProviderAvailable(
  provider: ResolvedViewReplacement,
  pluginEntries: ReadonlyMap<string, ProjectDashboardPluginEntry>,
): boolean {
  return resolveProjectDashboardProviderAvailability(
    provider.qualifiedId,
    CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    [provider],
    pluginEntries,
  ).provider !== null
}

export function loadGlobalProjectDashboardProviderId(): Promise<string> {
  if (pendingGlobalLoad) return pendingGlobalLoad

  const generation = ++globalLoadGeneration
  const pending = (async () => {
    const providerId = parseGlobalProjectDashboardProviderId(
      await getConfig(PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY),
    )
    if (globalLoadGeneration === generation) {
      globalProjectDashboardProviderId.set(providerId)
      globalProjectDashboardProviderLoaded.set(true)
    }
    return providerId
  })()
  pendingGlobalLoad = pending
  void pending.then(
    () => { if (pendingGlobalLoad === pending) pendingGlobalLoad = null },
    () => { if (pendingGlobalLoad === pending) pendingGlobalLoad = null },
  )
  return pending
}

export async function setGlobalProjectDashboardProviderId(providerId: string): Promise<void> {
  const parsed = parseGlobalProjectDashboardProviderId(providerId)
  globalLoadGeneration += 1
  await setConfig(PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY, parsed)
  globalProjectDashboardProviderId.set(parsed)
  globalProjectDashboardProviderLoaded.set(true)
}

export function loadProjectDashboardProviderId(projectId: string): Promise<string> {
  const existing = pendingProjectLoads.get(projectId)
  if (existing) return existing

  const generation = (projectLoadGenerations.get(projectId) ?? 0) + 1
  projectLoadGenerations.set(projectId, generation)
  const pending = (async () => {
    const providerId = parseProjectDashboardProviderId(
      await getProjectConfig(projectId, PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY),
    )
    if (projectLoadGenerations.get(projectId) === generation) {
      projectDashboardProviderIds.update((current) => {
        const next = new Map(current)
        next.set(projectId, providerId)
        return next
      })
    }
    return providerId
  })()
  pendingProjectLoads.set(projectId, pending)
  void pending.then(
    () => { if (pendingProjectLoads.get(projectId) === pending) pendingProjectLoads.delete(projectId) },
    () => { if (pendingProjectLoads.get(projectId) === pending) pendingProjectLoads.delete(projectId) },
  )
  return pending
}

export function reloadProjectDashboardProviderId(projectId: string): Promise<string> {
  pendingProjectLoads.delete(projectId)
  return loadProjectDashboardProviderId(projectId)
}

export async function setProjectDashboardProviderId(projectId: string, providerId: string): Promise<void> {
  const parsed = parseProjectDashboardProviderId(providerId)
  projectLoadGenerations.set(projectId, (projectLoadGenerations.get(projectId) ?? 0) + 1)
  if (parsed === INHERIT_PROJECT_DASHBOARD_PROVIDER_ID) {
    await clearProjectConfig(projectId, PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY)
  } else {
    await setProjectConfig(projectId, PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY, parsed)
  }
  projectDashboardProviderIds.update((current) => {
    const next = new Map(current)
    next.set(projectId, parsed)
    return next
  })
}

export function clearProjectDashboardProviderIds(): void {
  pendingGlobalLoad = null
  globalLoadGeneration += 1
  pendingProjectLoads.clear()
  projectLoadGenerations.clear()
  globalProjectDashboardProviderId.set(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
  globalProjectDashboardProviderLoaded.set(false)
  projectDashboardProviderIds.set(new Map())
}
