<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { activeProjectId, activeSessions, commandHeld, currentView, selectedTaskId, startingTasks, taskActiveView, taskRuntimeInfo } from '../../lib/stores'
  import { zenMode, isZenActive } from '../../lib/zenMode'
  import type { TaskRunAppRegistration } from './taskRunAppController'
  import { INITIAL_TASK_RUN_APP_STATE } from './taskRunAppController'
  import { useAppRouter } from '../../lib/router.svelte'
  import { isInputFocused } from '../../lib/domUtils'
  import { markAgentOutputViewed } from '../../lib/ipc'
  import {
    createAgentOutputAcknowledgementController,
    isAgentOutputUnread,
    type AcknowledgedAgentOutput,
  } from '../../lib/agentOutputAcknowledgement'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { TERMINAL_PLUGIN_ID } from '../../lib/terminalPlugin'
  import { useShortcutRegistry } from '../../lib/shortcuts.svelte'
  import { createTaskPaneController } from './taskPaneController'
  import type { TaskDetailHostLifecycleState } from './taskDetailHostLifecycle'
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
    hostLifecycle?: TaskDetailHostLifecycleState
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string, projectId?: string | null) => void | Promise<void>
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
    windowFocused?: boolean
  }

  let {
    task,
    onRunAction,
    hostLifecycle,
    onEdit,
    onOpenTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onRunAppRegistrationChange,
    windowFocused = true,
  }: Props = $props()

  const router = useAppRouter()
  const taskShortcuts = useShortcutRegistry()
  let activeView = $state('agent')
  let mountedViews = $state<Set<string>>(new Set(['agent']))
  let workspacePath = $state<string | null>(null)
  let lastTaskId = ''
  let panelHidden = $state(false)
  let runAppState = $state({ ...INITIAL_TASK_RUN_APP_STATE })
  let runAppRegistration = $state<TaskRunAppRegistration | null>(null)
  let agentTerminalReady = $state(false)

  const agentOutputAcknowledgement = createAgentOutputAcknowledgementController({
    markViewed: markAgentOutputViewed,
    onViewed: handleAgentOutputViewed,
    onError: (error) => {
      console.error('[TaskDetailView] Failed to mark Agent output viewed:', error)
    },
  })

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
  let hasUnreadAgentOutput = $derived(currentSession
    ? isAgentOutputUnread(
        currentSession.status,
        currentSession.output_revision,
        currentSession.viewed_output_revision,
      )
    : false)
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))
  // True only on the agent tab: hides the toolbar + info panel and centers the
  // terminal at a fixed max width. This view only mounts while its task is open
  // on the board, so those two inputs are fixed here. See lib/zenMode.ts.
  let zenActive = $derived(isZenActive({
    zenMode: $zenMode,
    currentView: 'board',
    selectedTaskId: task.id,
    activeView,
  }))
  // In zen the workbench is the full-screen cloud backdrop and centers the terminal
  // card on it; otherwise it just fills the row as before.
  let agentWorkbenchClass = $derived(
    activeView === 'agent'
      ? `relative z-[1] flex flex-1${zenActive ? ' justify-center zen-cloud-backdrop' : ''}`
      : 'pointer-events-none invisible absolute inset-0 flex',
  )
  // In zen drop the base-200 frame so the card's own rounded border is the only one,
  // and cap the width; otherwise keep the original padded panel. Horizontal padding
  // only, so the card fills 100% of the height; no overflow-hidden so the side drop
  // shadow can spill onto the cloud.
  let agentMainClass = $derived(
    zenActive
      ? 'relative flex min-w-0 px-8 w-full max-w-[1400px]'
      : 'relative flex min-w-0 flex-1 overflow-hidden bg-base-200/50 p-3',
  )

  $effect(() => {
    if (task.id === lastTaskId) return
    lastTaskId = task.id
    agentTerminalReady = false
    mountedViews = new Set(['agent'])
  })

  $effect(() => {
    if (!hostLifecycle) return
    workspacePath = hostLifecycle.workspacePath
    runAppState = hostLifecycle.runAppState
  })

  $effect(() => {
    const session = currentSession
    void agentOutputAcknowledgement.update({
      visibleTaskId: $selectedTaskId ?? task.id,
      agentPaneActive: activeView === 'agent',
      terminalReady: agentTerminalReady,
      windowFocusedAndDocumentVisible: windowFocused,
      session: session
        ? {
            id: session.id,
            taskId: session.ticket_id,
            status: session.status,
            outputRevision: session.output_revision,
            viewedOutputRevision: session.viewed_output_revision,
          }
        : null,
    })
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
    agentOutputAcknowledgement.dispose()
  })

  function handleAgentOutputViewed(output: AcknowledgedAgentOutput): void {
    activeSessions.update((sessions) => {
      const session = sessions.get(output.taskId)
      if (
        !session
        || session.id !== output.sessionId
        || session.output_revision !== output.outputRevision
        || session.viewed_output_revision >= output.outputRevision
      ) {
        return sessions
      }

      const updated = new Map(sessions)
      updated.set(output.taskId, {
        ...session,
        viewed_output_revision: output.outputRevision,
      })
      return updated
    })

    void Promise.resolve(onProjectAttentionChanged?.()).catch((error) => {
      console.error('[TaskDetailView] Failed to refresh Task Attention:', error)
    })
  }

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
    if (hostLifecycle) {
      await hostLifecycle.runApp()
      return
    }
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

{#if !hostLifecycle}
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
{/if}

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  {#if !zenActive}
    <TaskDetailToolbar
      {task}
      {workspacePath}
      {activeView}
      tabs={sortedTaskPaneTabs}
      {hasUnreadAgentOutput}
      bind:panelHidden
      {runAppState}
      {onRunAction}
      onBack={handleBack}
      onSelectView={(viewId) => taskPaneController.select(viewId)}
      onRunApp={handleRunApp}
      {onTaskUpdated}
      {onProjectAttentionChanged}
    />
  {/if}

  <div data-testid="upper-area" class="relative flex flex-1 min-h-0 overflow-hidden">
    <div
      data-testid="agent-workbench"
      aria-hidden={activeView !== 'agent'}
      class="min-h-0 overflow-hidden {agentWorkbenchClass}"
    >
      <main class={agentMainClass} aria-label="Agent terminal workbench">
        <div class="min-h-0 min-w-0 flex-1">
          {#key task.id}
            <AgentPanel
              taskId={task.id}
              {isStarting}
              isActive={activeView === 'agent'}
              onTerminalReadyChange={(ready) => { agentTerminalReady = ready }}
            />
          {/key}
        </div>
        {#if $commandHeld}
          <kbd class="kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10">E</kbd>
        {/if}
      </main>
      {#if !panelHidden && !zenActive}
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
