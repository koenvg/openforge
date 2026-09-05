<script lang="ts">
  import { ArrowLeft, ChevronDown, PanelRightClose, PanelRightOpen, Pencil, Play } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
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
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'
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
  let displayTitle = $derived(getTaskTitle(task))
  let isStarting = $derived($startingTasks.has(task.id))
  let isCompleting = $derived($completingTasks.has(task.id))
  let isOutOfFocus = $derived(outOfFocusController.taskIds.has(task.id))
  let moreActionItems = $derived([{
    value: isOutOfFocus ? 'return-to-board' : 'set-aside',
    label: isOutOfFocus ? returnPresentation.label : setAsidePresentation.label,
  }])


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

  async function handleMoreAction(value: string): Promise<void> {
    if (value === 'return-to-board') {
      await handleReturnToBoard()
    } else if (value === 'set-aside') {
      await handleSetAside()
    }
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

<header data-testid="task-workbench-toolbar" class="of-task-workbench-toolbar">
  <div class="toolbar-content">
    <Button type="button" size="md" variant="ghost" class="toolbar-back-button" aria-label="Back to task board" onclick={onBack}>
      <ArrowLeft size={16} aria-hidden="true" />
      <span>Back</span>
    </Button>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <span class="toolbar-task-id">{task.id}</span>
    {#if titleRename.editing}
      <div class="toolbar-title-editor">
        <TextField
          label="Task title"
          class="toolbar-title-input"
          value={titleRename.draft}
          autofocus
          onfocus={(event) => event.currentTarget.select()}
          onValueChange={(value) => { titleRename.draft = value }}
          onkeydown={titleRename.handleKeydown}
          onblur={() => titleRename.finish(true)}
        />
      </div>
    {:else}
      <div class="toolbar-title">
        <h1 title={displayTitle}>{displayTitle}</h1>
        <IconButton type="button" size="sm" variant="ghost" label="Rename task" onclick={() => titleRename.start()}>
          <Pencil size={14} aria-hidden="true" />
        </IconButton>
      </div>
    {/if}

    {#if workspacePath !== null || tabs.length > 0}
      <TaskPaneNavigation {activeView} {tabs} {hasUnreadAgentOutput} commandHeld={$commandHeld} onSelect={onSelectView} />
    {/if}

    {#if workspacePath !== null}
      <div class="toolbar-secondary-actions">
        <AgentStatusPill taskId={task.id} />
        <Button
          type="button"
          size="md"
          variant="ghost"
          class="toolbar-action"
          aria-label="Run app locally"
          title={runAppState.title}
          disabled={!runAppState.available || runAppState.isLaunching}
          onclick={onRunApp}
        >
          {#if runAppState.isLaunching}
            <span class="toolbar-spinner" aria-hidden="true"></span>
          {:else}
            <Play class="toolbar-action-icon" aria-hidden="true" />
          {/if}
          <span class="of-toolbar-compact-label">Run app</span>
        </Button>
        {#if vsCodeProtocolAvailable}
          <Button
            type="button"
            size="md"
            variant="ghost"
            class="toolbar-action"
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onclick={openInVsCode}
          >
            <svg viewBox="0 0 24 24" class="toolbar-action-icon" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>
            <span class="of-toolbar-compact-label">Open in VS Code</span>
          </Button>
        {/if}
      </div>
    {/if}

    {#if task.status === 'backlog'}
      <Button
        type="button"
        size="md"
        variant="primary"
        class="toolbar-primary-action"
        disabled={isStarting}
        onclick={() => onRunAction({ taskId: task.id, actionPrompt: '' })}
      >
        {#if isStarting}
          <span class="toolbar-spinner" aria-hidden="true"></span>
          Starting...
        {:else}
          Start Task
        {/if}
      </Button>
    {:else if task.status === 'doing'}
      <div class="toolbar-complete-actions">
        <Button type="button" size="md" variant="outline" disabled={isCompleting} onclick={handleComplete}>
          {#if isCompleting}
            <span class="toolbar-spinner" aria-hidden="true"></span>
            Completing…
          {:else}
            Complete
          {/if}
        </Button>
        <AnchoredMenu
          label="More task actions"
          items={moreActionItems}
          bind:open={moreActionsOpen}
          side="bottom"
          align="end"
          class="toolbar-more-menu"
          onSelect={(value) => { void handleMoreAction(value) }}
        >
          {#snippet trigger()}
            <ChevronDown size={14} class="toolbar-disclosure-icon {moreActionsOpen ? 'rotate-180' : ''}" aria-hidden="true" />
          {/snippet}
        </AnchoredMenu>
      </div>
    {/if}

    {#if activeView === 'agent' && workspacePath !== null}
      <Button
        type="button"
        size="md"
        variant="ghost"
        class="toolbar-details-button"
        aria-label={panelHidden ? 'Show task info panel' : 'Hide task info panel'}
        title={panelHidden ? 'Show details' : 'Hide details'}
        aria-pressed={!panelHidden}
        onclick={togglePanel}
      >
        {#if panelHidden}<PanelRightOpen size={16} aria-hidden="true" />{:else}<PanelRightClose size={16} aria-hidden="true" />{/if}
        <span>Details</span>
        {#if $commandHeld}<kbd class="toolbar-shortcut">⌘/</kbd>{/if}
      </Button>
    {/if}
  </div>
</header>

<style>
  .of-task-workbench-toolbar {
    isolation: isolate;
    height: calc(var(--of-control-height) + var(--of-space4));
    flex-shrink: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 var(--of-space4);
    border-bottom: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface);
    color: var(--of-text);
  }

  .toolbar-content {
    position: relative;
    display: flex;
    min-width: max-content;
    height: 100%;
    flex: 1;
    align-items: center;
    gap: var(--of-space2);
  }

  :global(.toolbar-back-button),
  :global(.toolbar-action),
  :global(.toolbar-details-button) {
    flex-shrink: 0;
    gap: var(--of-space2);
    color: var(--of-text-secondary);
  }

  .toolbar-divider {
    width: var(--of-border-width);
    height: var(--of-space6);
    flex-shrink: 0;
    background: var(--of-border);
  }

  .toolbar-task-id {
    flex-shrink: 0;
    color: var(--of-accent);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-semibold);
  }

  .toolbar-title-editor {
    width: 18rem;
  }

  .toolbar-title-editor :global(.of-text-field) {
    display: block;
  }

  .toolbar-title-editor :global(label) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .toolbar-title-editor :global(.toolbar-title-input) {
    width: 100%;
    font-size: var(--of-text-md);
    font-weight: var(--of-weight-semibold);
  }

  .toolbar-title {
    display: flex;
    min-width: var(--of-control-height-touch);
    max-width: 18rem;
    align-items: center;
    gap: var(--of-space1);
  }

  .toolbar-title h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--of-text);
    font-size: var(--of-text-md);
    font-weight: var(--of-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-secondary-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--of-space2);
    margin-left: auto;
  }

  .of-task-workbench-toolbar :global(.toolbar-action-icon) {
    width: var(--of-space4);
    height: var(--of-space4);
  }

  :global(.toolbar-primary-action),
  .toolbar-complete-actions {
    flex-shrink: 0;
  }

  .toolbar-complete-actions {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: var(--of-space1);
  }

  :global(.toolbar-details-button[aria-pressed='true']) {
    border-color: var(--of-border-interactive);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
  }

  .of-task-workbench-toolbar :global(.toolbar-disclosure-icon) {
    transition: transform var(--of-duration-standard) var(--of-ease-standard);
  }

  .toolbar-spinner {
    display: inline-block;
    width: var(--of-space3);
    height: var(--of-space3);
    border: var(--of-border-width) solid currentColor;
    border-right-color: transparent;
    border-radius: var(--of-radius-round);
    animation: toolbar-spin var(--of-duration-deliberate) linear infinite;
  }

  .toolbar-shortcut {
    padding: 0 var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
    background: var(--of-surface-subtle);
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }

  @keyframes toolbar-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .of-task-workbench-toolbar :global(.toolbar-disclosure-icon) {
      transition: none;
    }

    .toolbar-spinner {
      animation-duration: 1ms;
    }
  }
</style>
