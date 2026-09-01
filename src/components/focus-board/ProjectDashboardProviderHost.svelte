<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import type { PluginProjectDashboardReplacementProps } from '@openforge-app/plugin-sdk/frontend'
  import type { AgentSession, Project, PullRequestInfo, TaskAttentionRow, TaskDetail, TaskReference } from '../../lib/types'
  import { getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import {
    CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
    globalProjectDashboardProviderId,
    globalProjectDashboardProviderLoaded,
    loadGlobalProjectDashboardProviderId,
    loadProjectDashboardProviderId,
    projectDashboardProviderIds,
    resolveProjectDashboardProviderAvailability,
  } from '../../lib/plugin/projectDashboardProviders'
  import { setPluginRuntimeError } from '../../lib/plugin/pluginInstallState'
  import { getPluginRenderProps } from '../../lib/plugin/pluginRegistry'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import FocusBoard from './FocusBoard.svelte'

  interface Props {
    project: Project | null
    tasks: TaskDetail[]
    taskDetailsById?: Map<string, TaskDetail>
    dependencyReferenceTasks?: TaskReference[]
    activeSessions: Map<string, AgentSession>
    ticketPrs: Map<string, PullRequestInfo[]>
    attentionRows?: TaskAttentionRow[]
    attentionRowsLoaded?: boolean
    isLoading: boolean
    onOpenTask: (taskId: string, projectId?: string | null) => void | Promise<void>
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onNewTask?: () => void
    onOpenCommandSearch?: () => void
    onRunAction: (data: { taskId: string; actionPrompt: string; promptPrefix?: string | null }) => void
  }

  let {
    project,
    tasks,
    taskDetailsById = new Map(),
    dependencyReferenceTasks = [],
    activeSessions,
    ticketPrs,
    attentionRows = [],
    attentionRowsLoaded = true,
    isLoading,
    onOpenTask,
    onEditTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onNewTask,
    onOpenCommandSearch,
    onRunAction,
  }: Props = $props()

  let resolvedComponent = $state<Component<PluginProjectDashboardReplacementProps> | null>(null)
  let failedProviderId = $state<string | null>(null)
  let loadRunId = 0

  let contributionSources = $derived(
    Array.from($enabledPluginIds)
      .map(pluginId => $runtimeContributionSources.get(pluginId))
      .filter(source => source !== undefined),
  )
  let dashboardProviders = $derived(resolveContributions(contributionSources).viewReplacements)
  let projectProviderPreferenceLoaded = $derived(
    !project || $projectDashboardProviderIds.has(project.id),
  )
  let projectProviderPreferenceId = $derived(
    project && projectProviderPreferenceLoaded
      ? ($projectDashboardProviderIds.get(project.id) ?? INHERIT_PROJECT_DASHBOARD_PROVIDER_ID)
      : CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  )
  let providerResolution = $derived(resolveProjectDashboardProviderAvailability(
    projectProviderPreferenceId,
    $globalProjectDashboardProviderId,
    dashboardProviders,
    $installedPlugins,
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
      ? `${project?.id ?? ''}:${selectedProvider.qualifiedId}:available`
      : providerResolution.configuredProvider
        ? `${project?.id ?? ''}:${providerResolution.configuredProvider.qualifiedId}:${providerResolution.unavailableReason}`
        : `core:${project?.id ?? ''}`,
  )

  $effect(() => {
    if (!$globalProjectDashboardProviderLoaded) {
      void loadGlobalProjectDashboardProviderId().catch((error) => {
        console.error('[ProjectDashboardProviderHost] Failed to load global provider default:', error)
      })
    }
    const projectId = project?.id
    if (projectId && !$projectDashboardProviderIds.has(projectId)) {
      void loadProjectDashboardProviderId(projectId).catch((error) => {
        console.error(`[ProjectDashboardProviderHost] Failed to load provider preference for ${projectId}:`, error)
      })
    }
  })

  $effect(() => {
    void providerSignature
    const provider = selectedProvider
    const componentSource = selectedComponentSource
    const runId = ++loadRunId
    resolvedComponent = null
    failedProviderId = null

    if (!project || !provider || !componentSource) return

    void (async () => {
      try {
        const component = await resolvePluginComponent(componentSource)
        if (runId === loadRunId) resolvedComponent = component as Component<PluginProjectDashboardReplacementProps>
      } catch (error) {
        if (runId !== loadRunId) return
        reportProviderFailure(provider.pluginId, provider.qualifiedId, 'load', error)
        failedProviderId = provider.qualifiedId
      }
    })()
  })

  onDestroy(() => {
    loadRunId += 1
  })

  function reportProviderFailure(
    pluginId: string,
    providerId: string,
    phase: 'load' | 'render',
    error: unknown,
  ): void {
    const diagnostic = new Error(`Dashboard provider ${providerId} failed to ${phase}`, { cause: error })
    console.error(`[ProjectDashboardProviderHost] ${diagnostic.message}:`, error)
    setPluginRuntimeError(pluginId, diagnostic)
  }

  function handleRenderError(pluginId: string, providerId: string, error: unknown): void {
    reportProviderFailure(pluginId, providerId, 'render', error)
    failedProviderId = providerId
  }
</script>

{#snippet coreDashboard()}
  <div class="flex-1 overflow-hidden">
    {#if isLoading && tasks.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading tasks...</span>
      </div>
    {:else}
      <FocusBoard
        projectId={project?.id ?? null}
        projectName={project?.name ?? ''}
        {tasks}
        {taskDetailsById}
        {dependencyReferenceTasks}
        {activeSessions}
        {ticketPrs}
        {attentionRows}
        {attentionRowsLoaded}
        {onOpenTask}
        {onEditTask}
        {onTaskUpdated}
        {onProjectAttentionChanged}
        {onOpenCommandSearch}
        {onNewTask}
        {onRunAction}
      />
    {/if}
  </div>
{/snippet}

{#if selectedProvider && resolvedComponent && project && failedProviderId !== selectedProvider.qualifiedId}
  {@const Dashboard = resolvedComponent}
  {@const renderProps = getPluginRenderProps(selectedProvider.pluginId, { projectId: project.id })}
  <svelte:boundary onerror={(error) => handleRenderError(
    selectedProvider.pluginId,
    selectedProvider.qualifiedId,
    error,
  )}>
    {#snippet failed(_error, _reset)}
      {@render coreDashboard()}
    {/snippet}
    <Dashboard
      {...renderProps}
      {project}
      onOpenTask={(taskId) => onOpenTask(taskId, project.id)}
      onComposeTask={() => onNewTask?.()}
      onOpenCommandSearch={() => onOpenCommandSearch?.()}
    />
  </svelte:boundary>
{:else}
  {@render coreDashboard()}
{/if}
