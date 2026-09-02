import { writable } from 'svelte/store'
import { clearProjectConfig, getConfig, getProjectConfig, setConfig, setProjectConfig } from '../ipc'
import type { ResolvedViewReplacement } from './contributionResolver'
import { getRegisteredRenderableComponent } from './componentRegistry'

export const CORE_VIEW_REPLACEMENT_PROVIDER_ID = 'core'
export const INHERIT_VIEW_REPLACEMENT_PROVIDER_ID = 'inherit'

export type ViewReplacementProviderUnavailableReason =
  | 'missing-contribution'
  | 'inactive-plugin'
  | 'missing-component'
  | 'plugin-error'

export interface ViewReplacementProviderAvailability {
  projectPreferenceId: string
  globalDefaultId: string
  configuredId: string
  configuredProvider: ResolvedViewReplacement | null
  provider: ResolvedViewReplacement | null
  unavailableReason: ViewReplacementProviderUnavailableReason | null
}

type PluginEntry = { state: string }

export function isQualifiedViewReplacementProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^\S+\.\S+$/.test(value) && !value.includes(':')
}

export function parseGlobalViewReplacementProviderId(value: unknown): string {
  if (value === CORE_VIEW_REPLACEMENT_PROVIDER_ID || isQualifiedViewReplacementProviderId(value)) return value
  return CORE_VIEW_REPLACEMENT_PROVIDER_ID
}

export function parseProjectViewReplacementProviderId(value: unknown): string {
  if (
    value === INHERIT_VIEW_REPLACEMENT_PROVIDER_ID
    || value === CORE_VIEW_REPLACEMENT_PROVIDER_ID
    || isQualifiedViewReplacementProviderId(value)
  ) return value
  return INHERIT_VIEW_REPLACEMENT_PROVIDER_ID
}

export function resolveViewReplacementProviderAvailability(
  target: ResolvedViewReplacement['target'],
  projectPreferenceId: string,
  globalDefaultId: string,
  providers: readonly ResolvedViewReplacement[],
  pluginEntries: ReadonlyMap<string, PluginEntry>,
): ViewReplacementProviderAvailability {
  const parsedProjectPreferenceId = parseProjectViewReplacementProviderId(projectPreferenceId)
  const parsedGlobalDefaultId = parseGlobalViewReplacementProviderId(globalDefaultId)
  const configuredId = parsedProjectPreferenceId === INHERIT_VIEW_REPLACEMENT_PROVIDER_ID
    ? parsedGlobalDefaultId
    : parsedProjectPreferenceId
  const base = {
    projectPreferenceId: parsedProjectPreferenceId,
    globalDefaultId: parsedGlobalDefaultId,
    configuredId,
  }

  if (configuredId === CORE_VIEW_REPLACEMENT_PROVIDER_ID) {
    return { ...base, configuredProvider: null, provider: null, unavailableReason: null }
  }

  const configuredProvider = providers.find(
    candidate => candidate.target === target && candidate.qualifiedId === configuredId,
  ) ?? null
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

export function isViewReplacementProviderAvailable(
  target: ResolvedViewReplacement['target'],
  provider: ResolvedViewReplacement,
  pluginEntries: ReadonlyMap<string, PluginEntry>,
): boolean {
  return resolveViewReplacementProviderAvailability(
    target,
    provider.qualifiedId,
    CORE_VIEW_REPLACEMENT_PROVIDER_ID,
    [provider],
    pluginEntries,
  ).provider !== null
}

interface ViewReplacementProviderPreferencesOptions {
  configKey: string
}

export function createViewReplacementProviderPreferences(
  options: ViewReplacementProviderPreferencesOptions,
) {
  const globalProviderId = writable<string>(CORE_VIEW_REPLACEMENT_PROVIDER_ID)
  const globalProviderLoaded = writable(false)
  const projectProviderIds = writable<Map<string, string>>(new Map())

  let pendingGlobalLoad: Promise<string> | null = null
  let globalLoadGeneration = 0
  const pendingProjectLoads = new Map<string, Promise<string>>()
  const projectLoadGenerations = new Map<string, number>()

  function loadGlobalProviderId(): Promise<string> {
    if (pendingGlobalLoad) return pendingGlobalLoad

    const generation = ++globalLoadGeneration
    const pending = (async () => {
      const providerId = parseGlobalViewReplacementProviderId(await getConfig(options.configKey))
      if (globalLoadGeneration === generation) {
        globalProviderId.set(providerId)
        globalProviderLoaded.set(true)
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

  async function setGlobalProviderId(providerId: string): Promise<void> {
    const parsed = parseGlobalViewReplacementProviderId(providerId)
    globalLoadGeneration += 1
    await setConfig(options.configKey, parsed)
    globalProviderId.set(parsed)
    globalProviderLoaded.set(true)
  }

  function loadProjectProviderId(projectId: string): Promise<string> {
    const existing = pendingProjectLoads.get(projectId)
    if (existing) return existing

    const generation = (projectLoadGenerations.get(projectId) ?? 0) + 1
    projectLoadGenerations.set(projectId, generation)
    const pending = (async () => {
      const providerId = parseProjectViewReplacementProviderId(
        await getProjectConfig(projectId, options.configKey),
      )
      if (projectLoadGenerations.get(projectId) === generation) {
        projectProviderIds.update((current) => {
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

  function reloadProjectProviderId(projectId: string): Promise<string> {
    pendingProjectLoads.delete(projectId)
    return loadProjectProviderId(projectId)
  }

  async function setProjectProviderId(projectId: string, providerId: string): Promise<void> {
    const parsed = parseProjectViewReplacementProviderId(providerId)
    projectLoadGenerations.set(projectId, (projectLoadGenerations.get(projectId) ?? 0) + 1)
    if (parsed === INHERIT_VIEW_REPLACEMENT_PROVIDER_ID) {
      await clearProjectConfig(projectId, options.configKey)
    } else {
      await setProjectConfig(projectId, options.configKey, parsed)
    }
    projectProviderIds.update((current) => {
      const next = new Map(current)
      next.set(projectId, parsed)
      return next
    })
  }

  function clearProviderIds(): void {
    pendingGlobalLoad = null
    globalLoadGeneration += 1
    pendingProjectLoads.clear()
    projectLoadGenerations.clear()
    globalProviderId.set(CORE_VIEW_REPLACEMENT_PROVIDER_ID)
    globalProviderLoaded.set(false)
    projectProviderIds.set(new Map())
  }

  return {
    globalProviderId,
    globalProviderLoaded,
    projectProviderIds,
    loadGlobalProviderId,
    setGlobalProviderId,
    loadProjectProviderId,
    reloadProjectProviderId,
    setProjectProviderId,
    clearProviderIds,
  }
}
