<script lang="ts">
  import { Plus, Search } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { commandHeld, mergingTaskIds } from '../../lib/stores'
  import type { BoardFilter } from '../../lib/boardFilters'
  import { getDependencyWaitLabel } from '../../lib/taskDependencies'
  import { getTaskReasonText } from '../../lib/taskStatePresentation'
  import { computeTaskState } from '../../lib/taskState'
  import { isAgentOutputUnread } from '../../lib/agentOutputAcknowledgement'
  import TaskListItem from './TaskListItem.svelte'
  import TaskInspectorPanel from '../task-detail/TaskInspectorPanel.svelte'
  import TaskContextMenu from '../shared/tasks/TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
  import BoardTextFilter from './BoardTextFilter.svelte'
  import BacklogLabelFilterDropdown from './BacklogLabelFilterDropdown.svelte'
  import BacklogReadyFilterToggle from './BacklogReadyFilterToggle.svelte'
  import { createOutOfFocusController } from './outOfFocusController.svelte'
  import { createFocusBoardFilterController } from './focusBoardFilterController.svelte'
  import { createFocusBoardInteractionController } from './focusBoardInteractionController.svelte'
  import type { TaskDetail, TaskReference, TaskAttentionRow, AgentSession, PullRequestInfo } from '../../lib/types'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: TaskDetail[]
    taskDetailsById?: Map<string, TaskDetail>
    dependencyReferenceTasks?: TaskReference[]
    activeSessions: Map<string, AgentSession>
    ticketPrs: Map<string, PullRequestInfo[]>
    attentionRows?: TaskAttentionRow[]
    attentionRowsLoaded?: boolean
    onOpenTask: (taskId: string, projectId?: string | null) => void | Promise<void>
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onNewTask?: () => void
    onOpenCommandSearch?: () => void
    onRunAction: (data: { taskId: string; actionPrompt: string; promptPrefix?: string | null }) => void
  }

  let {
    projectId,
    projectName,
    tasks,
    taskDetailsById = new Map(),
    dependencyReferenceTasks = [],
    activeSessions,
    ticketPrs,
    attentionRows = [],
    attentionRowsLoaded = true,
    onOpenTask,
    onEditTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onNewTask,
    onOpenCommandSearch,
    onRunAction,
  }: Props = $props()
  const outOfFocusController = createOutOfFocusController({
    onProjectAttentionChanged: () => onProjectAttentionChanged?.(),
  })
  let dependencyResolutionTasks = $derived([...tasks, ...dependencyReferenceTasks])
  type TaskRow = {
    task: TaskDetail
    taskIndex: number
  }

  const FILTER_OPTIONS = [
    { value: 'focus' as BoardFilter, label: 'Focus', shortcut: '⌘1' },
    { value: 'in-flight' as BoardFilter, label: 'In Flight', shortcut: '⌘2' },
    { value: 'out-of-focus' as BoardFilter, label: 'Out of Focus', shortcut: '⌘3' },
    { value: 'backlog' as BoardFilter, label: 'Backlog', shortcut: '⌘4' },
  ] as const

  const FILTER_SECTION_LABELS: Record<BoardFilter, string> = {
    focus: 'Needs attention',
    'in-flight': 'In flight',
    'out-of-focus': 'Out of focus',
    backlog: 'Backlog',
  }

  let outOfFocusTaskIds = $derived(outOfFocusController.taskIds)
  let projectAttentionRows = $derived(
    projectId ? attentionRows.filter((row) => row.project_id === projectId) : [],
  )
  let attentionTaskIds = $derived(new Set(projectAttentionRows.map((row) => row.task_id)))
  let attentionByTaskId = $derived(new Map(projectAttentionRows.map((row) => [row.task_id, row])))
  let attentionOrder = $derived(new Map(projectAttentionRows.map((row, index) => [row.task_id, index])))
  let boardMetadataReady = $derived(outOfFocusController.isReadyFor(projectId) && attentionRowsLoaded)
  let tasksWithReadyAttentionMetadata = $derived.by(() =>
    boardMetadataReady ? tasks : tasks.filter((task) => task.status === 'backlog'),
  )

  const filterController = createFocusBoardFilterController({
    getProjectId: () => projectId,
    getTasks: () => tasks,
    getTasksWithReadyAttentionMetadata: () => tasksWithReadyAttentionMetadata,
    getDependencyResolutionTasks: () => dependencyResolutionTasks,
    getActiveSessions: () => activeSessions,
    getAttentionTaskIds: () => attentionTaskIds,
    getAttentionOrder: () => attentionOrder,
    getOutOfFocusTaskIds: () => outOfFocusTaskIds,
  })

  let activeFilter = $derived(filterController.activeFilter)
  let readyOnly = $derived(filterController.readyOnly)
  let readyCount = $derived(filterController.readyCount)
  let selectedLabelIds = $derived(filterController.selectedLabelIds)
  let visibleTasks = $derived(filterController.visibleTasks)
  let filterCounts = $derived(filterController.filterCounts)
  let labelCounts = $derived(filterController.labelCounts)
  let visibleFilterLabels = $derived(filterController.visibleFilterLabels)
  let visibleRows = $derived.by<TaskRow[]>(() =>
    visibleTasks.map((task, taskIndex) => ({ task, taskIndex })),
  )

  const interactionController = createFocusBoardInteractionController({
    getProjectId: () => projectId,
    getVisibleTasks: () => visibleTasks,
    setActiveFilter: filterController.setActiveFilter,
    onOpenTask: (taskId) => onOpenTask(taskId),
    onRunAction: (data) => onRunAction(data),
  })

  let selectedTaskIdLocal = $derived(interactionController.selectedTaskId)
  let selectedTask = $derived(interactionController.selectedTask)
  let selectedTaskDetail = $derived(selectedTaskIdLocal ? taskDetailsById.get(selectedTaskIdLocal) ?? null : null)
  let recentlyViewedTaskId = $derived(interactionController.recentlyViewedTaskId)
  let contextMenu = $derived(interactionController.contextMenu)

  $effect(() => {
    outOfFocusController.selectProject(projectId)
  })

</script>

<div class="of-board-theme flex h-full flex-col bg-[var(--of-canvas)]">
  <header class="shrink-0 border-b border-[var(--of-border)] bg-[var(--of-surface)] px-8 py-2">
    <div class="flex min-w-0 flex-wrap items-center gap-4 xl:flex-nowrap">
      <div class="w-60 shrink-0">
        <h1 class="truncate text-base font-semibold leading-5 tracking-[-0.01em] text-[var(--of-text)]">{projectName}</h1>
      </div>

      <Button
        type="button"
        variant="secondary"
        class="board-search min-w-64 max-w-[30rem] flex-1 justify-start gap-2.5 text-left"
        aria-label="Search tasks or use a command"
        onclick={() => onOpenCommandSearch?.()}
      >
        <Search size={16} aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">Search tasks or use a command</span>
        <kbd class="kbd kbd-xs shrink-0 border-[var(--of-border)] bg-[var(--of-surface-subtle)] text-[var(--of-text-secondary)]">⌘K</kbd>
      </Button>
      <Button type="button" class="shrink-0 gap-2" onclick={() => onNewTask?.()}>
        <Plus size={16} aria-hidden="true" />
        New task
        {#if $commandHeld}
          <kbd aria-hidden="true" class="kbd kbd-xs border-[var(--of-on-accent)] bg-transparent text-[var(--of-on-accent)] opacity-75">⌘N</kbd>
        {/if}
      </Button>

      <div class="ml-auto flex shrink-0 items-center" role="group" aria-label="Board filters">
        <div class="flex gap-1">
          {#each FILTER_OPTIONS as opt}
            <Button
              type="button"
              size="sm"
              variant={activeFilter === opt.value ? 'outline' : 'ghost'}
              class="board-filter relative {activeFilter === opt.value ? 'board-filter--active' : 'board-filter--interactive'}"
              aria-pressed={activeFilter === opt.value}
              onclick={() => interactionController.activateFilter(opt.value)}
            >
              <span class="board-filter-content">{opt.label} <span class="ml-1 text-[10px] opacity-60">{filterCounts[opt.value]}</span></span>
              {#if $commandHeld}
                <kbd class="kbd kbd-xs ml-1 opacity-60">{opt.shortcut}</kbd>
              {/if}
            </Button>
          {/each}
        </div>
      </div>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-8 pb-6 pr-6 {activeFilter === 'backlog' && filterCounts.backlog > 0 ? 'pt-4' : 'pt-6'}">
      {#if activeFilter === 'backlog' && filterCounts.backlog > 0}
        <div class="flex flex-wrap items-center gap-2 border-b border-[var(--of-border)] py-2">
          <BacklogReadyFilterToggle
            active={readyOnly}
            {readyCount}
            onToggle={() => {
              filterController.toggleReadyFilter()
              interactionController.resetToFirstTask()
            }}
          />
          {#if visibleFilterLabels.length > 0}
            <BacklogLabelFilterDropdown
              labels={visibleFilterLabels}
              {labelCounts}
              {selectedLabelIds}
              onToggle={(labelId) => {
                filterController.toggleLabelFilter(labelId)
                interactionController.resetToFirstTask()
              }}
            />
          {/if}
        </div>
      {/if}

      <div class="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto" role="region" aria-label="Task list">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-base font-semibold text-[var(--of-text)]">{FILTER_SECTION_LABELS[activeFilter]}</h2>
            <Badge class="font-mono">{filterCounts[activeFilter]}</Badge>
          </div>
          <span class="text-sm text-[var(--of-text-muted)]">Select a task to keep its context visible</span>
        </div>

        {#if visibleTasks.length === 0 && filterController.textFilterQuery.trim()}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center" role="status">
            <Search size={24} class="text-[var(--of-icon-muted)]" aria-hidden="true" />
            <p class="text-sm font-medium text-[var(--of-text-secondary)]">No tasks match ‘{filterController.textFilterQuery.trim()}’.</p>
            <p class="text-xs text-[var(--of-text-muted)]">Try a different filter or press Escape to clear it.</p>
          </div>
        {:else if visibleTasks.length === 0 && activeFilter === 'backlog' && (readyOnly || selectedLabelIds.size > 0)}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center" role="status">
            <Search size={24} class="text-[var(--of-icon-muted)]" aria-hidden="true" />
            <p class="text-sm font-medium text-[var(--of-text-secondary)]">No tasks match the active Backlog filters.</p>
            <p class="text-xs text-[var(--of-text-muted)]">Change or clear a filter to see more tasks.</p>
          </div>
        {:else if visibleTasks.length === 0}
          <FocusEmptyState filter={activeFilter} />
        {:else}
          {#each visibleRows as row (row.task.id)}
            {@const task = row.task}
            {@const session = activeSessions.get(task.id) ?? null}
            {@const pullRequests = ticketPrs.get(task.id) ?? []}
            {@const attentionRow = attentionByTaskId.get(task.id)}
            {@const state = attentionRow?.state ?? computeTaskState(task, session, pullRequests)}
            <div>
              <TaskListItem
                {task}
                {state}
                {session}
                {pullRequests}
                reasonText={attentionRow?.reason ?? getTaskReasonText(state, pullRequests)}
                hasUnreadAgentOutput={attentionRow?.has_unread_agent_output
                  ?? (session ? isAgentOutputUnread(session.status, session.output_revision, session.viewed_output_revision) : false)}
                dependencyHint={activeFilter === 'backlog' ? getDependencyWaitLabel(task, dependencyResolutionTasks) : null}
                showLabels={activeFilter === 'backlog'}
                isSelected={selectedTaskIdLocal === task.id}
                isFocused={interactionController.focusedIndex === row.taskIndex}
                justViewed={recentlyViewedTaskId === task.id}
                isMerging={$mergingTaskIds.has(task.id)}
                onSelect={() => interactionController.selectTask(task, row.taskIndex)}
                onContextMenu={(event) => interactionController.openContextMenu(event, task.id)}
                {onTaskUpdated}
              />
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div
      class="w-[clamp(420px,31vw,820px)] flex-shrink-0"
      onfocusin={() => interactionController.setPaneHasFocus(true)}
      onfocusout={() => interactionController.setPaneHasFocus(false)}
    >
      <TaskInspectorPanel
        task={selectedTaskDetail ?? selectedTask}
        allTasks={tasks}
        {dependencyReferenceTasks}
        {onTaskUpdated}
        onEditTask={onEditTask}
        onOpenLinkedTask={onOpenTask}
        onOpenFullView={() => {
          if (selectedTaskIdLocal) onOpenTask(selectedTaskIdLocal)
        }}
      />
    </div>
  </div>

  {#key projectId}
    <BoardTextFilter
      bind:query={filterController.textFilterQuery}
      matchingCount={visibleTasks.length}
      shortcutBlocked={contextMenu.visible}
      onBoardKeydown={interactionController.handleBoardKeydown}
    />
  {/key}

  <TaskContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    taskId={contextMenu.taskId}
    onClose={interactionController.closeContextMenu}
    onStart={(taskId, promptPrefix) => onRunAction({ taskId, actionPrompt: '', promptPrefix })}
    onEdit={onEditTask}
    onDelete={interactionController.closeContextMenu}
    {outOfFocusTaskIds}
    onMoveToOutOfFocus={outOfFocusController.setAside}
    onReturnToBoard={outOfFocusController.returnToBoard}
  />
</div>

<style>
  :global(.board-filter--active) {
    z-index: 10;
    color: var(--of-accent);
  }

  :global(.board-filter--interactive) {
    color: var(--of-text-secondary);
  }

  .board-filter-content {
    transition: opacity var(--of-duration-standard) var(--of-ease-standard);
    will-change: opacity;
  }

  :global(.board-filter--interactive) .board-filter-content {
    opacity: 0.65;
  }

  :global(.board-filter--interactive:hover) .board-filter-content {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .board-filter-content {
      transition: none;
    }
  }
</style>
