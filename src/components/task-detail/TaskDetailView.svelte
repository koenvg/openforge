<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { createTaskTerminalPaneLifecycle } from '@openforge-app/terminal-runtime'
  import { Play } from '@lucide/svelte'
  import { activeProjectId, activeSessions, commandHeld, completingTasks, currentView, selectedTaskId, startingTasks, taskActiveView, taskRuntimeInfo } from '../../lib/stores'
  import { getProjectConfig, getTaskWorkspace, openInEditor, writePty } from '../../lib/ipc'
  import type { TaskRunAppRegistration } from './taskRunAppController'
  import { createTaskRunAppController, INITIAL_TASK_RUN_APP_STATE } from './taskRunAppController'
  import { confirmTerminalTaskAction, runCompleteTask } from '../../lib/completeTask'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import { useAppRouter } from '../../lib/router.svelte'
  import { isInputFocused } from '../../lib/domUtils'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { TERMINAL_PLUGIN_ID } from '../../lib/terminalPlugin'
  import { useShortcutRegistry } from '../../lib/shortcuts.svelte'
  import { getTaskPaneShortcut } from '../../lib/taskPaneShortcuts'
  import { createTaskPaneController } from './taskPaneController'
  import { releaseAllForTask } from '../../lib/terminalPool'
  // Session + shell lifecycle must come from the terminal PLUGIN runtime (the one
  // rendering the task-view terminal), not the app pool — see liveTerminalPool.
  import { getShellLifecycleState, getTaskTerminalTabsSession } from '../../lib/liveTerminalPool'
  import type { Task } from '../../lib/types'
  import AgentPanel from './AgentPanel.svelte'
  import AgentStatusPill from './AgentStatusPill.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
  }

  let { task, onRunAction, onEdit, onOpenTask, onTaskUpdated, onRunAppRegistrationChange }: Props = $props()

  const titleRename = createTaskTitleRename(() => task, () => onTaskUpdated?.())

  function focusAndSelect(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
  const router = useAppRouter()

  let activeView = $state('agent')
  let workspacePath = $state<string | null>(null)
  let lastTaskId = ''
  let runAppState = $state({ ...INITIAL_TASK_RUN_APP_STATE })
  const taskShortcuts = useShortcutRegistry()

  const PANEL_HIDDEN_STORAGE_PREFIX = 'task-info-panel-hidden:'

  function readPanelHidden(taskId: string): boolean {
    try {
      return localStorage.getItem(`${PANEL_HIDDEN_STORAGE_PREFIX}${taskId}`) === '1'
    } catch {
      return false
    }
  }

  let panelHidden = $state(false)

  function togglePanel() {
    panelHidden = !panelHidden
    try {
      localStorage.setItem(`${PANEL_HIDDEN_STORAGE_PREFIX}${task.id}`, panelHidden ? '1' : '0')
    } catch {
      // ignore persistence failures (e.g. storage disabled)
    }
  }

  const taskPaneController = createTaskPaneController({
    activeViews: taskActiveView,
    shortcuts: taskShortcuts,
    onActiveViewChange: (viewId) => { activeView = viewId },
    onTogglePanel: togglePanel,
  })
  const taskRunAppController = createTaskRunAppController({
    getProjectConfig,
    getSession: getTaskTerminalTabsSession,
    getShellLifecycleState,
    writePty,
    openTerminalView: openTerminalViewForTask,
    onStateChange: (state) => { runAppState = state },
    onError: (operation, error) => {
      const description = operation === 'load-config' ? 'load run command' : 'run app command'
      console.error(`[TaskDetailView] Failed to ${description}:`, error)
    },
  })

  let displayTitle = $derived(getTaskTitle(task))
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )
  let pluginTaskPaneTabs = $derived(resolveContributions(enabledPluginContributionSources).taskPaneTabs)
  let sortedTaskPaneTabs = $state<ResolvedTab[]>([])
  let terminalTaskPaneTab = $derived(
    sortedTaskPaneTabs.find((tab) => tab.pluginId === TERMINAL_PLUGIN_ID && tab.contributionId === 'terminal') ?? null
  )

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))
  let isCompleting = $derived($completingTasks.has(task.id))

  const taskTerminalLifecycle = createTaskTerminalPaneLifecycle<string>({
    getInitialWorkspacePath: (taskId) => get(taskRuntimeInfo).get(taskId)?.workspacePath ?? null,
    getTaskWorkspace: async (taskId) => {
      try {
        const workspace = await getTaskWorkspace(taskId)
        return get(taskRuntimeInfo).get(taskId)?.workspacePath ?? workspace?.workspace_path ?? null
      } catch (lookupError) {
        const runtimeWorkspacePath = get(taskRuntimeInfo).get(taskId)?.workspacePath ?? null
        if (runtimeWorkspacePath !== null) {
          return runtimeWorkspacePath
        }
        throw lookupError
      }
    },
    getWorkspacePath: (path) => path,
    releaseAllForTask,
    setWorkspacePath: (path) => { workspacePath = path },
    onWorkspaceResolved: (taskId, path) => {
      taskPaneController.handleWorkspaceResolved(taskId, path)
    },
    onWorkspaceLookupError: (taskId, lookupError) => {
      console.error(`[TaskDetailView] Failed to load workspace for ${taskId}:`, lookupError)
    },
  })

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      panelHidden = readPanelHidden(taskId)
    }

    taskTerminalLifecycle.syncTask(taskId)
  })

  $effect(() => {
    taskPaneController.sync({
      taskId: task.id,
      workspacePath,
      tabs: pluginTaskPaneTabs,
    })
    sortedTaskPaneTabs = [...taskPaneController.tabs]
  })

  $effect(() => {
    const runtimeWorkspacePath = $taskRuntimeInfo.get(task.id)?.workspacePath ?? null
    if (runtimeWorkspacePath !== null && runtimeWorkspacePath !== workspacePath) {
      workspacePath = runtimeWorkspacePath
    }
  })

  $effect(() => {
    taskRunAppController.sync({
      taskId: task.id,
      projectId: $activeProjectId,
      workspacePath,
      terminalViewId: terminalTaskPaneTab?.namespacedId ?? null,
      onRegistrationChange: onRunAppRegistrationChange,
    })
  })
  let canRunApp = $derived(runAppState.available)
  let isRunningApp = $derived(runAppState.isLaunching)
  let runAppTitle = $derived(runAppState.title)


  onDestroy(() => {
    taskPaneController.destroy()
    taskTerminalLifecycle.destroy()
    taskRunAppController.destroy()
  })

  function handleBack() {
    router.resetToBoard()
  }

  function openInVsCode() {
    if (workspacePath === null) return
    void openInEditor(workspacePath)
  }

  async function handleComplete() {
    if (isCompleting || !confirmTerminalTaskAction('Complete')) {
      return
    }
    if (await runCompleteTask(task.id)) {
      router.resetToBoard()
    }
  }

  function openTerminalViewForTask(taskId: string, terminalViewId: string): void {
    taskPaneController.selectForTask(taskId, terminalViewId)
    if (get(currentView) !== 'board' || get(selectedTaskId) !== taskId) {
      router.navigateToTask(taskId)
    }
  }

  async function handleRunApp(): Promise<void> {
    await taskRunAppController.run()
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function handleTaskDetailKeydown(e: KeyboardEvent) {
    taskShortcuts.handleKeydown(e)
    if (e.defaultPrevented) {
      e.stopPropagation()
      return
    }

    if (isInputFocused()) return

    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault()
      e.stopPropagation()
      handleBack()
      return
    }
    if (e.key === 'h' && workspacePath !== null) {
      e.preventDefault()
      e.stopPropagation()
      taskPaneController.select('agent')
      return
    }
    if (e.key === 'l' && workspacePath !== null) {
      e.preventDefault()
      e.stopPropagation()
      taskPaneController.select('review')
      return
    }
  }

</script>

<svelte:window onkeydown={handleTaskDetailKeydown} />

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
    <header class="flex flex-col border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
      <div class="flex items-center gap-3 px-6 py-3.5">
        <button class="btn btn-ghost btn-sm text-sm text-secondary border border-base-300 shrink-0 px-2.5 h-7" onclick={handleBack}>
          <span aria-hidden="true">&lt; </span><span>back</span>
        </button>
        <span class="text-base-content/20 select-none">|</span>
        <span class="text-[0.8125rem] font-semibold text-primary font-mono shrink-0">{task.id}</span>
        {#if titleRename.editing}
          <input
            class="input input-sm input-bordered text-lg font-semibold flex-1 min-w-0"
            aria-label="Task title"
            value={titleRename.draft}
            oninput={(e) => titleRename.draft = e.currentTarget.value}
            onkeydown={titleRename.handleKeydown}
            onblur={() => titleRename.finish(true)}
            use:focusAndSelect
          />
        {:else}
          <div class="flex items-center gap-1 min-w-0 flex-1">
            <h1 class="text-lg font-semibold text-base-content m-0 overflow-hidden text-ellipsis whitespace-nowrap min-w-0" title={displayTitle}>{displayTitle}</h1>
            <button
              class="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/50 hover:text-base-content"
              aria-label="Rename task"
              onclick={() => titleRename.start()}
            >✎</button>
          </div>
        {/if}
        {#if task.status === 'backlog'}
          <button
            class="btn btn-primary btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
            disabled={isStarting}
            onclick={() => onRunAction({ taskId: task.id, actionPrompt: '', agent: null })}
          >
            {#if isStarting}
              <span class="loading loading-spinner loading-xs"></span>
              Starting...
            {:else}
              Start Task
            {/if}
          </button>
        {:else if task.status === 'doing'}
          <Button
            size="sm"
            class="shrink-0 shadow-sm hover:shadow-md transition-shadow"
            disabled={isCompleting}
            onclick={handleComplete}
          >
            {#if isCompleting}
              <span class="loading loading-spinner loading-xs"></span>
              Completing…
            {:else}
              Complete
            {/if}
          </Button>
        {/if}
      </div>
    </header>

    <div class="flex items-center justify-between h-10 px-6 border-b border-base-300 shrink-0">
      {#if workspacePath !== null}
        <div class="flex items-center gap-1">
          <button
            class="btn btn-ghost btn-xs gap-1.5 {activeView === 'agent' ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            aria-pressed={activeView === 'agent'}
            onclick={() => taskPaneController.select('agent')}
          >agent {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘1</kbd>{/if}</button>
          <button
            class="btn btn-ghost btn-xs gap-1.5 {activeView === 'review' ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            aria-pressed={activeView === 'review'}
            onclick={() => taskPaneController.select('review')}
          >review {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘2</kbd>{/if}</button>
          {#each sortedTaskPaneTabs as tab, index (tab.namespacedId)}
            <button
              class="btn btn-ghost btn-xs gap-1.5 {activeView === tab.namespacedId ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
              aria-pressed={activeView === tab.namespacedId}
              onclick={() => taskPaneController.select(tab.namespacedId)}
            >{tab.title}{#if $commandHeld && getTaskPaneShortcut(index) !== null}<kbd class="kbd kbd-xs opacity-50">{getTaskPaneShortcut(index)}</kbd>{/if}</button>
          {/each}
          <span class="mx-1 text-base-content/20 select-none" aria-hidden="true">|</span>
          <button
            class="btn btn-ghost btn-xs gap-1.5 text-base-content/50 border border-base-300 shrink-0 hover:text-base-content"
            aria-label="Run app locally"
            title={runAppTitle}
            disabled={!canRunApp || isRunningApp}
            onclick={handleRunApp}
          >
            {#if isRunningApp}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            {:else}
              <Play class="w-3.5 h-3.5" aria-hidden="true" />
            {/if}
            Run app
          </button>
          <button
            class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onclick={openInVsCode}
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>
          </button>
        </div>
      {:else}
        <div></div>
      {/if}
      <div class="flex items-center gap-3 min-w-0">
        {#if workspacePath !== null}
          <AgentStatusPill taskId={task.id} />
        {/if}
        {#if activeView === 'agent' && workspacePath !== null}
          <button
            class="btn btn-ghost btn-xs gap-1.5 text-base-content/50 border border-base-300 shrink-0"
            aria-label={panelHidden ? 'Show task info panel' : 'Hide task info panel'}
            aria-pressed={!panelHidden}
            onclick={togglePanel}
          >{panelHidden ? 'show info' : 'hide info'}{#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘/</kbd>{/if}</button>
        {/if}
      </div>
    </div>

  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
    {#if activeView === 'agent' || activeView === 'review'}
      <div data-testid="upper-area" class="flex flex-1 min-h-0 overflow-hidden max-[800px]:flex-col">
        {#if activeView === 'review'}
          {#key task.id}
            <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
          {/key}
        {:else}
          <div class="relative flex-1 min-h-0 p-5 overflow-hidden max-[800px]:p-4">
            {#key task.id}
              <AgentPanel taskId={task.id} {isStarting} />
            {/key}
            {#if $commandHeld}
              <kbd class="kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10">E</kbd>
            {/if}
          </div>
          {#if !panelHidden}
            <ResizablePanel storageKey="task-detail-sidebar" defaultWidth={360} minWidth={200} maxWidth={600} side="right">
              <div
                data-testid="task-info-scroll-container"
                data-scroll-owner="task-info-panel"
                class="h-full min-h-0 overflow-y-auto bg-base-200 border-l border-base-300"
              >
                <TaskInfoPanel
                  task={task}
                  {workspacePath}
                  allowCommentAddressing={true}
                  onEditPrompt={onEdit ? () => onEdit?.(task.id) : undefined}
                  onOpenDependentTask={onOpenTask}
                />
              </div>
            </ResizablePanel>
          {/if}
        {/if}
      </div>
    {/if}

    {#if activeView !== 'agent' && activeView !== 'review' && taskPaneController.isPluginView(activeView) && workspacePath !== null}
      <div class="flex flex-col flex-1 overflow-hidden">
        <PluginSlot
          slotType="taskPaneTabs"
          slotId={activeView}
          taskId={task.id}
          projectId={$activeProjectId}
        />
      </div>
    {/if}
  </div>
</div>
