<script lang="ts">
  import type { Project, TaskDetail, TaskReference } from '../../lib/types'
  import { getPluginRenderProps } from '../../lib/plugin/pluginRegistry'
  import { createViewReplacementHostState } from '../../lib/plugin/viewReplacementHostState.svelte'
  import {
    globalTaskDetailProviderId,
    globalTaskDetailProviderLoaded,
    loadGlobalTaskDetailProviderId,
    loadProjectTaskDetailProviderId,
    projectTaskDetailProviderIds,
  } from '../../lib/plugin/taskDetailProviders'
  import TaskDetailHostLifecycle from './TaskDetailHostLifecycle.svelte'
  import type { TaskDetailHostLifecycleState } from './taskDetailHostLifecycle'
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
    windowFocused?: boolean
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
    windowFocused = true,
  }: Props = $props()

  const providerState = createViewReplacementHostState({
    target: 'task.detail',
    hostName: 'TaskDetailProviderHost',
    getProjectId: () => project?.id ?? null,
    getLogicalIdentity: () => `${project?.id ?? ''}:${task.id}`,
    preferences: {
      globalProviderId: globalTaskDetailProviderId,
      globalProviderLoaded: globalTaskDetailProviderLoaded,
      projectProviderIds: projectTaskDetailProviderIds,
      loadGlobalProviderId: loadGlobalTaskDetailProviderId,
      loadProjectProviderId: loadProjectTaskDetailProviderId,
    },
    reportProviderFailure,
  })

  let resolvedContributions = $derived(providerState.contributions)
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
    const diagnostic = new Error(`Task detail provider ${providerId} from plugin ${pluginId} failed to ${phase}`, { cause: error })
    console.error(`[TaskDetailProviderHost] ${diagnostic.message}:`, error)
  }

</script>

{#snippet coreTaskDetail(hostLifecycle: TaskDetailHostLifecycleState)}
  <TaskDetailView
    {task}
    {hostLifecycle}
    {windowFocused}
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
      {#if selectedProvider && project && providerFailed}
        {@render coreTaskDetail(hostLifecycle)}
      {:else if selectedProvider && resolvedComponent && componentReady && project}
        {@const TaskWorkspace = resolvedComponent}
        {@const renderProps = getPluginRenderProps(selectedProvider.pluginId, {
          projectId: project.id,
          taskId: task.id,
        })}
        {#key `${project.id}:${task.id}:${selectedProvider.qualifiedId}`}
          <svelte:boundary onerror={providerState.handleRenderError}>
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
