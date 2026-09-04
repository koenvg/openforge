<script lang="ts">
  import type { AgentSession, Project, PullRequestInfo, TaskAttentionRow, TaskDetail, TaskReference } from '../../lib/types'
  import { getPluginRenderProps } from '../../lib/plugin/pluginRegistry'
  import { createViewReplacementHostState } from '../../lib/plugin/viewReplacementHostState.svelte'
  import {
    globalProjectDashboardProviderId,
    globalProjectDashboardProviderLoaded,
    loadGlobalProjectDashboardProviderId,
    loadProjectDashboardProviderId,
    projectDashboardProviderIds,
  } from '../../lib/plugin/projectDashboardProviders'
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

  const providerState = createViewReplacementHostState({
    target: 'project.dashboard',
    hostName: 'ProjectDashboardProviderHost',
    getProjectId: () => project?.id ?? null,
    getLogicalIdentity: () => project?.id ?? '',
    preferences: {
      globalProviderId: globalProjectDashboardProviderId,
      globalProviderLoaded: globalProjectDashboardProviderLoaded,
      projectProviderIds: projectDashboardProviderIds,
      loadGlobalProviderId: loadGlobalProjectDashboardProviderId,
      loadProjectProviderId: loadProjectDashboardProviderId,
    },
    reportProviderFailure,
  })

  let selectedProvider = $derived(providerState.selectedProvider)
  let resolvedComponent = $derived(providerState.resolvedComponent)
  let componentReady = $derived(providerState.componentReady)
  let providerFailed = $derived(providerState.providerFailed)
  function reportProviderFailure(
    pluginId: string,
    providerId: string,
    phase: 'load' | 'render',
    error: unknown,
  ): void {
    const diagnostic = new Error(`Dashboard provider ${providerId} from plugin ${pluginId} failed to ${phase}`, { cause: error })
    console.error(`[ProjectDashboardProviderHost] ${diagnostic.message}:`, error)
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

{#if selectedProvider && resolvedComponent && componentReady && project && !providerFailed}
  {@const Dashboard = resolvedComponent}
  {@const renderProps = getPluginRenderProps(selectedProvider.pluginId, { projectId: project.id })}
  <svelte:boundary onerror={providerState.handleRenderError}>
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
