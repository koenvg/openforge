<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import type { PluginTaskDetailReplacementProps } from '@openforge-app/plugin-sdk/frontend'
  import type { Project, TaskDetail, TaskReference } from '../../lib/types'
  import { getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import {
    CORE_TASK_DETAIL_PROVIDER_ID,
    INHERIT_TASK_DETAIL_PROVIDER_ID,
    globalTaskDetailProviderId,
    globalTaskDetailProviderLoaded,
    loadGlobalTaskDetailProviderId,
    loadProjectTaskDetailProviderId,
    projectTaskDetailProviderIds,
    resolveTaskDetailProviderAvailability,
  } from '../../lib/plugin/taskDetailProviders'
  import TaskDetailHostLifecycle from './TaskDetailHostLifecycle.svelte'
  import type { TaskDetailHostLifecycleState } from './taskDetailHostLifecycle'
  import { getPluginRenderProps } from '../../lib/plugin/pluginRegistry'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import type { TaskRunAppRegistration } from './taskRunAppController'
  import TaskDetailView from './TaskDetailView.svelte'

  interface Props {
    project: Project | null
    task: TaskDetail
    relatedTasks?: TaskReference[]
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string, projectId?: string | null) => void | Promise<void>
    onOpenTaskActions?: () => void
    onRefreshTask?: () => void | Promise<void>
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
  }

  let {
    project,
    task,
    relatedTasks = [],
    onRunAction,
    onEdit,
    onOpenTask,
    onOpenTaskActions,
    onRefreshTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onRunAppRegistrationChange,
  }: Props = $props()

  let resolvedComponent = $state<Component<PluginTaskDetailReplacementProps> | null>(null)
  let resolvedProviderSignature = $state<string | null>(null)
  let failedProviderId = $state<string | null>(null)
  let loadRunId = 0

  let contributionSources = $derived(
    Array.from($enabledPluginIds)
      .map(pluginId => $runtimeContributionSources.get(pluginId))
      .filter(source => source !== undefined),
  )
  let resolvedContributions = $derived(resolveContributions(contributionSources))
  let taskDetailProviders = $derived(resolvedContributions.viewReplacements)
  let projectProviderPreferenceLoaded = $derived(
    !project || $projectTaskDetailProviderIds.has(project.id),
  )
  let projectProviderPreferenceId = $derived(
    project && projectProviderPreferenceLoaded
      ? ($projectTaskDetailProviderIds.get(project.id) ?? INHERIT_TASK_DETAIL_PROVIDER_ID)
      : CORE_TASK_DETAIL_PROVIDER_ID,
  )
  let providerResolution = $derived(resolveTaskDetailProviderAvailability(
    projectProviderPreferenceId,
    $globalTaskDetailProviderId,
    taskDetailProviders,
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
    selectedProvider && project
      ? `${project.id}:${task.id}:${selectedProvider.qualifiedId}:available`
      : providerResolution.configuredProvider
        ? `${project?.id ?? ''}:${task.id}:${providerResolution.configuredProvider.qualifiedId}:${providerResolution.unavailableReason}`
        : `core:${project?.id ?? ''}:${task.id}`,
  )

  $effect(() => {
    if (!$globalTaskDetailProviderLoaded) {
      void loadGlobalTaskDetailProviderId().catch((error) => {
        console.error('[TaskDetailProviderHost] Failed to load global provider default:', error)
      })
    }
    const projectId = project?.id
    if (projectId && !$projectTaskDetailProviderIds.has(projectId)) {
      void loadProjectTaskDetailProviderId(projectId).catch((error) => {
        console.error(`[TaskDetailProviderHost] Failed to load provider preference for ${projectId}:`, error)
      })
    }
  })

  $effect(() => {
    const signature = providerSignature
    const provider = selectedProvider
    const componentSource = selectedComponentSource
    const runId = ++loadRunId
    resolvedComponent = null
    resolvedProviderSignature = null
    failedProviderId = null

    if (!project || !provider || !componentSource) return

    void (async () => {
      try {
        const component = await resolvePluginComponent(componentSource)
        if (runId === loadRunId) {
          resolvedComponent = component as Component<PluginTaskDetailReplacementProps>
          resolvedProviderSignature = signature
        }
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
    const diagnostic = new Error(`Task detail provider ${providerId} from plugin ${pluginId} failed to ${phase}`, { cause: error })
    console.error(`[TaskDetailProviderHost] ${diagnostic.message}:`, error)
  }

  function handleRenderError(pluginId: string, providerId: string, error: unknown): void {
    reportProviderFailure(pluginId, providerId, 'render', error)
    failedProviderId = providerId
  }
</script>

{#snippet coreTaskDetail(hostLifecycle: TaskDetailHostLifecycleState)}
  <TaskDetailView
    {task}
    {hostLifecycle}
    {onRunAction}
    {onEdit}
    {onOpenTask}
    {onTaskUpdated}
    {onProjectAttentionChanged}
  />
{/snippet}

{#key `${project?.id ?? ''}:${task.id}`}
  <TaskDetailHostLifecycle
    taskId={task.id}
    projectId={project?.id ?? null}
    taskPaneTabs={resolvedContributions.taskPaneTabs}
    {onRunAppRegistrationChange}
  >
    {#snippet children(hostLifecycle)}
{#if selectedProvider && project && failedProviderId === selectedProvider.qualifiedId}
  {@render coreTaskDetail(hostLifecycle)}
{:else if selectedProvider
  && resolvedComponent
  && resolvedProviderSignature === providerSignature
  && project}
  {@const TaskWorkspace = resolvedComponent}
  {@const renderProps = getPluginRenderProps(selectedProvider.pluginId, {
    projectId: project.id,
    taskId: task.id,
  })}
  {#key `${project.id}:${task.id}:${selectedProvider.qualifiedId}`}
    <svelte:boundary onerror={(error) => handleRenderError(
      selectedProvider.pluginId,
      selectedProvider.qualifiedId,
      error,
    )}>
      {#snippet failed(_error, _reset)}
        {@render coreTaskDetail(hostLifecycle)}
      {/snippet}
      <TaskWorkspace
        {...renderProps}
        {project}
        {task}
        {relatedTasks}
        onOpenTask={(taskId, projectId) => onOpenTask?.(taskId, projectId)}
        onEditTask={() => onEdit?.(task.id)}
        onOpenTaskActions={() => onOpenTaskActions?.()}
        onRefreshTask={() => onRefreshTask?.()}
      />
    </svelte:boundary>
  {/key}
{:else if selectedProvider}
  <div class="flex h-full flex-1 items-center justify-center text-base-content/50" aria-label="Loading task workspace">
    <span class="loading loading-spinner loading-md text-primary"></span>
  </div>
{:else}
  {@render coreTaskDetail(hostLifecycle)}
{/if}
    {/snippet}
  </TaskDetailHostLifecycle>
{/key}
