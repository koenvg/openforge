<script lang="ts">
  import { ArrowLeft, ChevronDown, PanelRightClose, PanelRightOpen, Pencil, Play } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { onMount } from 'svelte'
  import { activeProjectId, commandHeld, completingTasks, startingTasks } from '../../lib/stores'
  import { confirmTerminalTaskAction, runCompleteTask } from '../../lib/completeTask'
  import { getTaskActionPresentation } from '../../lib/actionPalettePresentation'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { hasVsCodeProtocolHandler, openInEditor } from '../../lib/ipc'
  import { createOutOfFocusController } from '../focus-board/outOfFocusController.svelte'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import type { TaskDetail } from '../../lib/types'
  import type { TaskRunAppState } from './taskRunAppController'
  import AnchoredMenu from '../shared/ui/AnchoredMenu.svelte'
  import ContextMenuItem from '../shared/ui/ContextMenuItem.svelte'
  import TaskPaneNavigation from './TaskPaneNavigation.svelte'
  import AgentStatusPill from './AgentStatusPill.svelte'

  interface Props {
    task: TaskDetail
    workspacePath: string | null
    activeView: string
    tabs: readonly ResolvedTab[]
    hasUnreadAgentOutput?: boolean
    panelHidden?: boolean
    runAppState: TaskRunAppState
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
    onBack: () => void
    onSelectView: (viewId: string) => void
    onRunApp: () => void | Promise<void>
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
  }

  let {
    task,
    workspacePath,
    activeView,
    tabs,
    hasUnreadAgentOutput = false,
    panelHidden = $bindable(false),
    runAppState,
    onRunAction,
    onBack,
    onSelectView,
    onRunApp,
    onTaskUpdated,
    onProjectAttentionChanged,
  }: Props = $props()

  const PANEL_HIDDEN_STORAGE_PREFIX = 'task-info-panel-hidden:'
  const titleRename = createTaskTitleRename(() => task, () => onTaskUpdated?.())
  const setAsidePresentation = getTaskActionPresentation('set-aside-task')
  const returnPresentation = getTaskActionPresentation('return-to-board')
  const outOfFocusController = createOutOfFocusController({
    onProjectAttentionChanged: () => onProjectAttentionChanged?.(),
  })
  let lastTaskId = ''
  let persistedTaskId = ''
  let vsCodeProtocolAvailable = $state(false)
  let moreActionsOpen = $state(false)
  let moreActionsTrigger = $state<HTMLButtonElement | null>(null)
  let displayTitle = $derived(getTaskTitle(task))
  let isStarting = $derived($startingTasks.has(task.id))
  let isCompleting = $derived($completingTasks.has(task.id))
  let isOutOfFocus = $derived(outOfFocusController.taskIds.has(task.id))

  function focusAndSelect(node: HTMLInputElement): void {
    node.focus()
    node.select()
  }

  function readPanelHidden(taskId: string): boolean {
    try {
      return localStorage.getItem(`${PANEL_HIDDEN_STORAGE_PREFIX}${taskId}`) === '1'
    } catch {
      return false
    }
  }

  function persistPanelHidden(taskId: string, hidden: boolean): void {
    try {
      localStorage.setItem(`${PANEL_HIDDEN_STORAGE_PREFIX}${taskId}`, hidden ? '1' : '0')
    } catch {
      // Storage can be disabled without affecting the current panel state.
    }
  }

  function togglePanel(): void {
    panelHidden = !panelHidden
  }

  async function handleComplete(): Promise<void> {
    if (isCompleting || !confirmTerminalTaskAction('Complete')) return
    if (await runCompleteTask(task.id)) onBack()
  }

  function toggleMoreActions(): void {
    moreActionsOpen = !moreActionsOpen
  }

  async function handleSetAside(): Promise<void> {
    moreActionsOpen = false
    await outOfFocusController.setAside(task.id)
  }

  async function handleReturnToBoard(): Promise<void> {
    moreActionsOpen = false
    await outOfFocusController.returnToBoard(task.id)
  }

  function openInVsCode(): void {
    if (workspacePath !== null) void openInEditor(workspacePath)
  }

  $effect(() => {
    outOfFocusController.selectProject($activeProjectId)
  })

  $effect(() => {
    if (task.id === lastTaskId) return
    lastTaskId = task.id
    moreActionsOpen = false
    panelHidden = readPanelHidden(task.id)
    persistedTaskId = task.id
  })

  $effect(() => {
    if (persistedTaskId === task.id) persistPanelHidden(task.id, panelHidden)
  })

  onMount(() => {
    let cancelled = false
    void hasVsCodeProtocolHandler().then(
      (available) => {
        if (!cancelled) vsCodeProtocolAvailable = available
      },
      (error) => {
        console.error('[TaskDetailView] Failed to check the VS Code protocol handler:', error)
      },
    )

    return () => {
      cancelled = true
    }
  })
</script>

<header
  data-testid="task-workbench-toolbar"
  class="of-task-workbench-toolbar isolate flex h-[52px] shrink-0 items-center overflow-x-auto overflow-y-hidden border-b border-base-300 bg-base-100 px-4"
>
  <div class="relative flex h-full min-w-max flex-1 items-center gap-2">
    <button class="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content" aria-label="Back to task board" onclick={onBack}>
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
        oninput={(event) => titleRename.draft = event.currentTarget.value}
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

    {#if workspacePath !== null || tabs.length > 0}
      <TaskPaneNavigation {activeView} {tabs} {hasUnreadAgentOutput} commandHeld={$commandHeld} onSelect={onSelectView} />
    {/if}

    {#if workspacePath !== null}
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <AgentStatusPill taskId={task.id} />
        <button
          class="btn btn-ghost btn-sm min-h-9 shrink-0 gap-1.5 text-base-content/65 hover:text-base-content"
          aria-label="Run app locally"
          title={runAppState.title}
          disabled={!runAppState.available || runAppState.isLaunching}
          onclick={onRunApp}
        >
          {#if runAppState.isLaunching}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {:else}
            <Play class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
          <span class="of-toolbar-compact-label">Run app</span>
        </button>
        {#if vsCodeProtocolAvailable}
          <button
            class="btn btn-ghost btn-sm min-h-9 shrink-0 gap-2 text-base-content/65 hover:text-base-content"
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onclick={openInVsCode}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>
            <span class="of-toolbar-compact-label">Open in VS Code</span>
          </button>
        {/if}
      </div>
    {/if}

    {#if task.status === 'backlog'}
      <button
        class="btn btn-primary btn-sm min-h-9 shrink-0"
        disabled={isStarting}
        onclick={() => onRunAction({ taskId: task.id, actionPrompt: '' })}
      >
        {#if isStarting}
          <span class="loading loading-spinner loading-xs"></span>
          Starting...
        {:else}
          Start Task
        {/if}
      </button>
    {:else if task.status === 'doing'}
      <div class="relative flex shrink-0 items-stretch">
        <Button
          size="sm"
          variant="outline"
          class="min-h-9 rounded-r-none border-r-0 border-primary px-4 text-primary"
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
        <button
          bind:this={moreActionsTrigger}
          type="button"
          class="btn btn-outline btn-sm min-h-9 rounded-l-none border-primary px-1.5 text-primary"
          aria-label="More task actions"
          aria-haspopup="menu"
          aria-expanded={moreActionsOpen}
          onclick={toggleMoreActions}
        >
          <ChevronDown size={14} class="transition-transform duration-200 {moreActionsOpen ? 'rotate-180' : ''}" aria-hidden="true" />
        </button>
        <AnchoredMenu detached visible={moreActionsOpen} trigger={moreActionsTrigger} onClose={() => { moreActionsOpen = false }}>
          {#if isOutOfFocus}
            <ContextMenuItem label={returnPresentation.label} onclick={handleReturnToBoard} />
          {:else}
            <ContextMenuItem label={setAsidePresentation.label} onclick={handleSetAside} />
          {/if}
        </AnchoredMenu>
      </div>
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
