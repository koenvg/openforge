import type { ReplaceableViewTarget } from '@openforge-app/plugin-sdk'
import type {
  PluginProjectDashboardReplacementProps,
  PluginTaskDetailReplacementProps,
} from '@openforge-app/plugin-sdk/frontend'
import { onDestroy, type Component } from 'svelte'
import { fromStore, type Readable } from 'svelte/store'
import { getRegisteredRenderableComponent, resolvePluginComponent } from './componentRegistry'
import { resolveContributions } from './contributionResolver'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from './pluginStore'
import {
  CORE_VIEW_REPLACEMENT_PROVIDER_ID,
  INHERIT_VIEW_REPLACEMENT_PROVIDER_ID,
  resolveViewReplacementProviderAvailability,
} from './viewReplacementProviders'

interface ViewReplacementProviderPreferences {
  globalProviderId: Readable<string>
  globalProviderLoaded: Readable<boolean>
  projectProviderIds: Readable<Map<string, string>>
  loadGlobalProviderId: () => Promise<string>
  loadProjectProviderId: (projectId: string) => Promise<string>
}

export interface ViewReplacementHostPropsByTarget {
  'project.dashboard': PluginProjectDashboardReplacementProps
  'task.detail': PluginTaskDetailReplacementProps
}

interface ViewReplacementHostStateOptions<Target extends ReplaceableViewTarget> {
  target: Target
  hostName: string
  getProjectId: () => string | null
  getLogicalIdentity: () => string
  preferences: ViewReplacementProviderPreferences
  reportProviderFailure: (
    pluginId: string,
    providerId: string,
    phase: 'load' | 'render',
    error: unknown,
  ) => void
}

export function createViewReplacementHostState<Target extends ReplaceableViewTarget>(
  options: ViewReplacementHostStateOptions<Target>,
) {
  const enabledPluginIdsState = fromStore(enabledPluginIds)
  const installedPluginsState = fromStore(installedPlugins)
  const contributionSourcesState = fromStore(runtimeContributionSources)
  const globalProviderIdState = fromStore(options.preferences.globalProviderId)
  const globalProviderLoadedState = fromStore(options.preferences.globalProviderLoaded)
  const projectProviderIdsState = fromStore(options.preferences.projectProviderIds)

  let resolvedComponent = $state<Component<ViewReplacementHostPropsByTarget[Target]> | null>(null)
  let resolvedProviderSignature = $state<string | null>(null)
  let failedProviderSignature = $state<string | null>(null)
  let loadRunId = 0

  let contributions = $derived(resolveContributions(
    Array.from(enabledPluginIdsState.current)
      .map(pluginId => contributionSourcesState.current.get(pluginId))
      .filter(source => source !== undefined),
  ))
  let projectId = $derived(options.getProjectId())
  let logicalIdentity = $derived(options.getLogicalIdentity())
  let projectProviderPreferenceLoaded = $derived(
    !projectId || projectProviderIdsState.current.has(projectId),
  )
  let projectProviderPreferenceId = $derived(
    projectId && projectProviderPreferenceLoaded
      ? (projectProviderIdsState.current.get(projectId) ?? INHERIT_VIEW_REPLACEMENT_PROVIDER_ID)
      : CORE_VIEW_REPLACEMENT_PROVIDER_ID,
  )
  let providerResolution = $derived(resolveViewReplacementProviderAvailability(
    options.target,
    projectProviderPreferenceId,
    globalProviderIdState.current,
    contributions.viewReplacements,
    installedPluginsState.current,
  ))
  let selectedProvider = $derived(providerResolution.provider)
  let selectedComponentSource = $derived(selectedProvider
    ? getRegisteredRenderableComponent(
        'viewReplacements',
        `${selectedProvider.pluginId}:${selectedProvider.contributionId}`,
      )
    : undefined)
  let providerSignature = $derived(
    selectedProvider
      ? `${logicalIdentity}:${selectedProvider.qualifiedId}:available`
      : providerResolution.configuredProvider
        ? `${logicalIdentity}:${providerResolution.configuredProvider.qualifiedId}:${providerResolution.unavailableReason}`
        : `core:${logicalIdentity}`,
  )

  $effect(() => {
    if (!globalProviderLoadedState.current) {
      void options.preferences.loadGlobalProviderId().catch((error) => {
        console.error(`[${options.hostName}] Failed to load global provider default:`, error)
      })
    }

    if (projectId && !projectProviderIdsState.current.has(projectId)) {
      void options.preferences.loadProjectProviderId(projectId).catch((error) => {
        console.error(`[${options.hostName}] Failed to load provider preference for ${projectId}:`, error)
      })
    }
  })

  $effect(() => {
    const signature = providerSignature
    const provider = selectedProvider
    const componentSource = selectedComponentSource
    const currentProjectId = projectId
    const runId = ++loadRunId
    resolvedComponent = null
    resolvedProviderSignature = null
    failedProviderSignature = null

    if (!currentProjectId || !provider || !componentSource) return

    void (async () => {
      try {
        const component = await resolvePluginComponent(componentSource)
        if (runId === loadRunId) {
          resolvedComponent = component as Component<ViewReplacementHostPropsByTarget[Target]>
          resolvedProviderSignature = signature
        }
      } catch (error) {
        if (runId !== loadRunId) return
        options.reportProviderFailure(provider.pluginId, provider.qualifiedId, 'load', error)
        failedProviderSignature = signature
      }
    })()
  })

  onDestroy(() => {
    loadRunId += 1
  })

  function handleRenderError(error: unknown): void {
    if (!selectedProvider) return
    options.reportProviderFailure(
      selectedProvider.pluginId,
      selectedProvider.qualifiedId,
      'render',
      error,
    )
    failedProviderSignature = providerSignature
  }

  return {
    get contributions() { return contributions },
    get selectedProvider() { return selectedProvider },
    get resolvedComponent() { return resolvedComponent },
    get componentReady() {
      return resolvedComponent !== null && resolvedProviderSignature === providerSignature
    },
    get providerFailed() { return failedProviderSignature === providerSignature },
    handleRenderError,
  }
}

export type ViewReplacementHostState<Target extends ReplaceableViewTarget> = ReturnType<
  typeof createViewReplacementHostState<Target>
>
