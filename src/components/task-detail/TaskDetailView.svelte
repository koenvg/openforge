<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { createTaskTerminalPaneLifecycle } from '@openforge-app/terminal-runtime'
  import { ArrowLeft, PanelRightClose, PanelRightOpen, Pencil, Play } from '@lucide/svelte'
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
  import TaskInspectorPanel from './TaskInspectorPanel.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string, projectId?: string | null) => void | Promise<void>
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
  let mountedViews = $state<Set<string>>(new Set(['agent']))
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
      mountedViews = new Set(['agent'])
    }

    taskTerminalLifecycle.syncTask(taskId)
  })

  $effect(() => {
    const viewId = activeView
    if (!mountedViews.has(viewId)) {
      mountedViews = new Set(mountedViews).add(viewId)
    }
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
  <header
    data-testid="task-workbench-toolbar"
    class="of-task-workbench-toolbar flex h-[52px] shrink-0 items-center overflow-x-auto overflow-y-hidden border-b border-base-300 bg-base-100 px-4"
  >
    <div class="relative flex h-full min-w-max flex-1 items-center gap-2">
      <button class="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content" aria-label="Back to task board" onclick={handleBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Back</span>
      </button>
      <span class="h-5 w-px shrink-0 bg-base-300" aria-hidden="true"></span>
      <span class="shrink-0 font-mono text-[0.8125rem] font-semibold text-primary">{task.id}</span>
      {#if titleRename.editing}
        <input
          class="input input-sm input-bordered h-9 min-h-9 min-w-32 max-w-72 text-base font-semibold"
          aria-label="Task title"
          value={titleRename.draft}
          oninput={(e) => titleRename.draft = e.currentTarget.value}
          onkeydown={titleRename.handleKeydown}
          onblur={() => titleRename.finish(true)}
          use:focusAndSelect
        />
      {:else}
        <div class="flex min-w-24 max-w-72 items-center gap-1">
          <h1 class="m-0 min-w-0 truncate text-base font-semibold text-base-content" title={displayTitle}>{displayTitle}</h1>
          <button
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content"
            aria-label="Rename task"
            onclick={() => titleRename.start()}
          ><Pencil size={14} aria-hidden="true" /></button>
        </div>
      {/if}

      {#if workspacePath !== null}
        <nav class="absolute left-1/2 top-0 z-10 flex h-full -translate-x-1/2 items-center gap-0.5 bg-base-100" aria-label="Task workbench tabs">
          <button
            class="h-full min-w-16 border-b-2 px-3 text-[13px] font-semibold capitalize transition-colors {activeView === 'agent' ? 'border-primary bg-primary/5 text-primary' : 'border-transparent text-base-content/65 hover:bg-base-200/70 hover:text-base-content'}"
            aria-pressed={activeView === 'agent'}
            onclick={() => taskPaneController.select('agent')}
          >agent {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘1</kbd>{/if}</button>
          <button
            class="h-full min-w-16 border-b-2 px-3 text-[13px] font-semibold capitalize transition-colors {activeView === 'review' ? 'border-primary bg-primary/5 text-primary' : 'border-transparent text-base-content/65 hover:bg-base-200/70 hover:text-base-content'}"
            aria-pressed={activeView === 'review'}
            onclick={() => taskPaneController.select('review')}
          >review {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘2</kbd>{/if}</button>
          {#each sortedTaskPaneTabs as tab, index (tab.namespacedId)}
            <button
              class="h-full min-w-16 border-b-2 px-3 text-[13px] font-semibold transition-colors {activeView === tab.namespacedId ? 'border-primary bg-primary/5 text-primary' : 'border-transparent text-base-content/65 hover:bg-base-200/70 hover:text-base-content'}"
              aria-pressed={activeView === tab.namespacedId}
              onclick={() => taskPaneController.select(tab.namespacedId)}
            >{tab.title}{#if $commandHeld && getTaskPaneShortcut(index) !== null}<kbd class="kbd kbd-xs opacity-50">{getTaskPaneShortcut(index)}</kbd>{/if}</button>
          {/each}
        </nav>

        <div class="ml-auto flex shrink-0 items-center gap-2">
          <AgentStatusPill taskId={task.id} />
          <button
            class="btn btn-ghost btn-sm min-h-9 shrink-0 gap-1.5 text-base-content/65 hover:text-base-content"
            aria-label="Run app locally"
            title={runAppTitle}
            disabled={!canRunApp || isRunningApp}
            onclick={handleRunApp}
          >
            {#if isRunningApp}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            {:else}
              <Play class="h-3.5 w-3.5" aria-hidden="true" />
            {/if}
            <span class="of-toolbar-compact-label">Run app</span>
          </button>
          <button
            class="btn btn-ghost btn-sm min-h-9 shrink-0 gap-2 text-base-content/65 hover:text-base-content"
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onclick={openInVsCode}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>
            <span class="of-toolbar-compact-label">Open in VS Code</span>
          </button>
        </div>
      {/if}

      {#if task.status === 'backlog'}
        <button
          class="btn btn-primary btn-sm min-h-9 shrink-0"
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
          variant="outline"
          class="min-h-9 shrink-0 border-primary px-4 text-primary"
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

      {#if activeView === 'agent' && workspacePath !== null}
        <button
          class="btn btn-ghost btn-sm min-h-9 shrink-0 gap-2 {!panelHidden ? 'bg-primary/5 text-primary' : 'text-base-content/60'}"
          aria-label={panelHidden ? 'Show task info panel' : 'Hide task info panel'}
          title={panelHidden ? 'Show details' : 'Hide details'}
          aria-pressed={!panelHidden}
          onclick={togglePanel}
        >
          {#if panelHidden}<PanelRightOpen size={16} aria-hidden="true" />{:else}<PanelRightClose size={16} aria-hidden="true" />{/if}
          <span>Details</span>
          {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘/</kbd>{/if}
        </button>
      {/if}
    </div>
  </header>

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
      {#if mountedViews.has(tab.namespacedId) && workspacePath !== null}
        <div
          data-testid={`plugin-workbench-${tab.namespacedId}`}
          aria-hidden={activeView !== tab.namespacedId}
          class="min-h-0 overflow-hidden {activeView === tab.namespacedId ? 'relative z-[1] flex flex-1' : 'pointer-events-none invisible absolute inset-0 flex'}"
        >
          <PluginSlot
            slotType="taskPaneTabs"
            slotId={tab.namespacedId}
            taskId={task.id}
            projectId={$activeProjectId}
          />
        </div>
      {/if}
    {/each}
  </div>
</div>
