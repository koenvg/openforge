<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { activeProjectId, activeSessions, commandHeld, currentView, selectedTaskId, startingTasks, taskActiveView, taskRuntimeInfo } from '../../lib/stores'
  import type { TaskRunAppRegistration } from './taskRunAppController'
  import { INITIAL_TASK_RUN_APP_STATE } from './taskRunAppController'
  import { useAppRouter } from '../../lib/router.svelte'
  import { isInputFocused } from '../../lib/domUtils'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { TERMINAL_PLUGIN_ID } from '../../lib/terminalPlugin'
  import { useShortcutRegistry } from '../../lib/shortcuts.svelte'
  import { createTaskPaneController } from './taskPaneController'
  import type { TaskDetail } from '../../lib/types'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInspectorPanel from './TaskInspectorPanel.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'
  import TaskDetailLifecycle from './TaskDetailLifecycle.svelte'
  import TaskDetailToolbar from './TaskDetailToolbar.svelte'

  interface Props {
    task: TaskDetail
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string, projectId?: string | null) => void | Promise<void>
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
  }

  let { task, onRunAction, onEdit, onOpenTask, onTaskUpdated, onProjectAttentionChanged, onRunAppRegistrationChange }: Props = $props()

  const router = useAppRouter()
  const taskShortcuts = useShortcutRegistry()
  let activeView = $state('agent')
  let mountedViews = $state<Set<string>>(new Set(['agent']))
  let workspacePath = $state<string | null>(null)
  let lastTaskId = ''
  let panelHidden = $state(false)
  let runAppState = $state({ ...INITIAL_TASK_RUN_APP_STATE })
  let runAppRegistration = $state<TaskRunAppRegistration | null>(null)

  const taskPaneController = createTaskPaneController({
    activeViews: taskActiveView,
    shortcuts: taskShortcuts,
    onActiveViewChange: (viewId) => { activeView = viewId },
    onTogglePanel: () => { panelHidden = !panelHidden },
  })

  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined),
  )
  let pluginTaskPaneTabs = $derived(resolveContributions(enabledPluginContributionSources).taskPaneTabs)
  let sortedTaskPaneTabs = $state<ResolvedTab[]>([])
  let terminalTaskPaneTab = $derived(
    sortedTaskPaneTabs.find((tab) => tab.pluginId === TERMINAL_PLUGIN_ID && tab.contributionId === 'terminal') ?? null,
  )
  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))

  $effect(() => {
    if (task.id === lastTaskId) return
    lastTaskId = task.id
    mountedViews = new Set(['agent'])
  })

  $effect(() => {
    const viewId = activeView
    if (!mountedViews.has(viewId)) mountedViews = new Set(mountedViews).add(viewId)
  })

  $effect(() => {
    taskPaneController.sync({
      taskId: task.id,
      workspacePath,
      tabs: pluginTaskPaneTabs,
    })
    sortedTaskPaneTabs = [...taskPaneController.tabs]
  })

  onDestroy(() => {
    taskPaneController.destroy()
  })

  function handleBack(): void {
    router.resetToBoard()
  }

  function handleWorkspaceResolved(taskId: string, path: string | null): void {
    taskPaneController.handleWorkspaceResolved(taskId, path)
  }

  function handleRunAppRegistrationChange(registration: TaskRunAppRegistration | null): void {
    runAppRegistration = registration
    onRunAppRegistrationChange?.(registration)
  }

  function openTerminalViewForTask(taskId: string, terminalViewId: string): void {
    taskPaneController.selectForTask(taskId, terminalViewId)
    if (get(currentView) !== 'board' || get(selectedTaskId) !== taskId) router.navigateToTask(taskId)
  }

  async function handleRunApp(): Promise<void> {
    await runAppRegistration?.run()
  }

  function handleSendToAgent(prompt: string): void {
    onRunAction({ taskId: task.id, actionPrompt: prompt })
  }

  function handleTaskDetailKeydown(event: KeyboardEvent): void {
    taskShortcuts.handleKeydown(event)
    if (event.defaultPrevented) {
      event.stopPropagation()
      return
    }

    if (isInputFocused()) return
    if (event.metaKey || event.ctrlKey || event.altKey) return

    if (event.key === 'Escape' || event.key === 'q') {
      event.preventDefault()
      event.stopPropagation()
      handleBack()
      return
    }
    if (event.key === 'h' && workspacePath !== null) {
      event.preventDefault()
      event.stopPropagation()
      taskPaneController.select('agent')
      return
    }
    if (event.key === 'l' && workspacePath !== null) {
      event.preventDefault()
      event.stopPropagation()
      taskPaneController.select('review')
    }
  }
</script>

<svelte:window onkeydown={handleTaskDetailKeydown} />

<TaskDetailLifecycle
  taskId={task.id}
  projectId={$activeProjectId}
  runtimeWorkspacePath={$taskRuntimeInfo.get(task.id)?.workspacePath ?? null}
  terminalViewId={terminalTaskPaneTab?.namespacedId ?? null}
  onWorkspacePathChange={(path) => { workspacePath = path }}
  onWorkspaceResolved={handleWorkspaceResolved}
  onRunAppStateChange={(state) => { runAppState = state }}
  onRunAppRegistrationChange={handleRunAppRegistrationChange}
  onOpenTerminalView={openTerminalViewForTask}
/>

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  <TaskDetailToolbar
    {task}
    {workspacePath}
    {activeView}
    tabs={sortedTaskPaneTabs}
    bind:panelHidden
    {runAppState}
    {onRunAction}
    onBack={handleBack}
    onSelectView={(viewId) => taskPaneController.select(viewId)}
    onRunApp={handleRunApp}
    {onTaskUpdated}
    {onProjectAttentionChanged}
  />

  <div data-testid="upper-area" class="relative flex flex-1 min-h-0 overflow-hidden">
    <div
      data-testid="agent-workbench"
      aria-hidden={activeView !== 'agent'}
      class="min-h-0 overflow-hidden {activeView === 'agent' ? 'relative z-[1] flex flex-1' : 'pointer-events-none invisible absolute inset-0 flex'}"
    >
      <main class="relative flex min-w-0 flex-1 overflow-hidden bg-base-200/50 p-3" aria-label="Agent terminal workbench">
        <div class="min-h-0 min-w-0 flex-1">
          {#key task.id}
            <AgentPanel taskId={task.id} {isStarting} isActive={activeView === 'agent'} />
          {/key}
        </div>
        {#if $commandHeld}
          <kbd class="kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10">E</kbd>
        {/if}
      </main>
      {#if !panelHidden}
        <ResizablePanel storageKey="task-detail-sidebar" defaultWidth={360} minWidth={280} maxWidth={520} side="right">
          <div
            data-testid="task-info-scroll-container"
            data-scroll-owner="task-info-panel"
            class="h-full min-h-0"
          >
            <TaskInspectorPanel
              {task}
              {workspacePath}
              onEditTask={onEdit}
              onOpenLinkedTask={onOpenTask}
              onTaskUpdated={() => onTaskUpdated?.()}
              allowRename={false}
            />
          </div>
        </ResizablePanel>
      {/if}
    </div>

    {#if mountedViews.has('review')}
      <div
        data-testid="review-workbench"
        aria-hidden={activeView !== 'review'}
        class="min-h-0 overflow-hidden {activeView === 'review' ? 'relative z-[1] flex flex-1' : 'pointer-events-none invisible absolute inset-0 flex'}"
      >
        {#key task.id}
          <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
        {/key}
      </div>
    {/if}

    {#each sortedTaskPaneTabs as tab (tab.namespacedId)}
      {#if mountedViews.has(tab.namespacedId)}
        <div
          data-testid={`plugin-workbench-${tab.namespacedId}`}
          aria-hidden={activeView !== tab.namespacedId}
          class="min-h-0 overflow-hidden {activeView === tab.namespacedId ? 'relative z-[1] flex flex-1' : 'pointer-events-none invisible absolute inset-0 flex'}"
        >
          <PluginSlot
            slotType="taskPaneTabs"
            slotId={tab.namespacedId}
            taskId={task.id}
            {task}
            projectId={$activeProjectId}
          />
        </div>
      {/if}
    {/each}
  </div>
</div>
