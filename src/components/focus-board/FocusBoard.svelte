<script lang="ts">
  import { Plus, Search } from '@lucide/svelte'
  import { commandHeld, mergingTaskIds } from '../../lib/stores'
  import type { BoardFilter } from '../../lib/boardFilters'
  import { getDependencyWaitLabel } from '../../lib/taskDependencies'
  import { getTaskReasonText } from '../../lib/taskStatePresentation'
  import { computeTaskState } from '../../lib/taskState'
  import TaskListItem from './TaskListItem.svelte'
  import TaskInspectorPanel from '../task-detail/TaskInspectorPanel.svelte'
  import TaskContextMenu from '../shared/tasks/TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
  import BoardTextFilter from './BoardTextFilter.svelte'
  import { createOutOfFocusController } from './outOfFocusController.svelte'
  import { createFocusBoardFilterController } from './focusBoardFilterController.svelte'
  import { createFocusBoardInteractionController } from './focusBoardInteractionController.svelte'
  import type { Task, TaskRelationshipReference, TaskAttentionRow, AgentSession, PullRequestInfo } from '../../lib/types'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: Task[]
    dependencyReferenceTasks?: TaskRelationshipReference[]
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
    task: Task
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
    getActiveSessions: () => activeSessions,
    getAttentionTaskIds: () => attentionTaskIds,
    getAttentionOrder: () => attentionOrder,
    getOutOfFocusTaskIds: () => outOfFocusTaskIds,
  })

  let activeFilter = $derived(filterController.activeFilter)
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
  let recentlyViewedTaskId = $derived(interactionController.recentlyViewedTaskId)
  let contextMenu = $derived(interactionController.contextMenu)

  $effect(() => {
    outOfFocusController.selectProject(projectId)
  })

</script>

<div class="of-board-theme flex h-full flex-col bg-base-100">
  <header class="shrink-0 border-b border-base-300 bg-base-100 px-8 py-2">
    <div class="flex min-w-0 flex-wrap items-center gap-4 xl:flex-nowrap">
      <div class="w-60 shrink-0">
        <h1 class="truncate text-base font-semibold leading-5 tracking-[-0.01em] text-base-content">{projectName}</h1>
      </div>

      <button
        type="button"
        class="composited-hover-layer board-search of-field flex h-9 min-w-64 max-w-[30rem] flex-1 items-center gap-2.5 px-3 text-left text-xs text-base-content/55"
        aria-label="Search tasks or use a command"
        onclick={() => onOpenCommandSearch?.()}
      >
        <Search size={16} aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">Search tasks or use a command</span>
        <kbd class="kbd kbd-xs shrink-0 border-base-300 bg-base-200 text-base-content/55">⌘K</kbd>
      </button>

      <button type="button" class="btn btn-primary h-9 min-h-9 shrink-0 px-3.5 text-xs" onclick={() => onNewTask?.()}>
        <Plus size={16} aria-hidden="true" />
        New task
        {#if $commandHeld}
          <kbd aria-hidden="true" class="kbd kbd-xs border-primary-content/25 bg-primary-content/10 text-primary-content/75">⌘N</kbd>
        {/if}
      </button>

      <div class="ml-auto flex shrink-0 items-center" role="group" aria-label="Board filters">
        <div class="join">
          {#each FILTER_OPTIONS as opt}
            <button
              type="button"
              class="board-filter join-item relative min-h-8 border border-base-300 bg-base-100 px-3 text-xs font-medium {activeFilter === opt.value
                ? 'z-10 border-primary bg-primary/[0.03] text-primary ring-1 ring-primary/20'
                : 'composited-hover-layer board-filter--interactive text-base-content'}"
              aria-pressed={activeFilter === opt.value}
              onclick={() => interactionController.activateFilter(opt.value)}
            >
              <span class="board-filter-content">{opt.label} <span class="ml-1 text-[10px] opacity-60">{filterCounts[opt.value]}</span></span>
              {#if $commandHeld}
                <kbd class="kbd kbd-xs ml-1 opacity-60 {activeFilter === opt.value ? '' : 'text-base-content/65'}">{opt.shortcut}</kbd>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-8 py-6 pr-6">
      {#if activeFilter === 'backlog' && visibleFilterLabels.length > 0}
        <div class="flex flex-wrap items-center gap-2 border-b border-base-300 py-2" role="group" aria-label="Backlog label filters">
          <span class="text-xs font-semibold text-base-content/50">Labels</span>
          {#each visibleFilterLabels as label (label.id)}
            <button
              class="badge badge-sm gap-1 {selectedLabelIds.has(label.id) ? 'badge-primary' : 'badge-ghost'}"
              aria-pressed={selectedLabelIds.has(label.id)}
              onclick={() => {
                filterController.toggleLabelFilter(label.id)
                interactionController.resetToFirstTask()
              }}
            >
              <span>{label.name}</span>
              <span class="opacity-70">{labelCounts.get(label.id) ?? 0}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto" role="region" aria-label="Task list">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-base font-semibold text-base-content">{FILTER_SECTION_LABELS[activeFilter]}</h2>
            <span class="badge badge-ghost badge-sm font-mono text-xs">{filterCounts[activeFilter]}</span>
          </div>
          <span class="text-sm text-base-content/45">Select a task to keep its context visible</span>
        </div>

        {#if visibleTasks.length === 0 && filterController.textFilterQuery.trim()}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center" role="status">
            <Search size={24} class="text-base-content/35" aria-hidden="true" />
            <p class="text-sm font-medium text-base-content/70">No tasks match ‘{filterController.textFilterQuery.trim()}’.</p>
            <p class="text-xs text-base-content/45">Try a different filter or press Escape to clear it.</p>
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
        task={selectedTask}
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
  .board-search {
    --composited-hover-border: 1px solid color-mix(in srgb, var(--of-text) 24%, var(--of-divider));
    transition-property: opacity, transform;
  }

  .board-search:hover {
    border-color: var(--of-divider);
  }

  .board-filter--interactive {
    --composited-hover-background: color-mix(in oklch, var(--color-base-200) 60%, transparent);
  }

  .board-filter-content {
    transition: opacity 200ms ease;
    will-change: opacity;
  }

  .board-filter--interactive .board-filter-content {
    opacity: 0.65;
  }

  .board-filter--interactive:hover .board-filter-content {
    opacity: 1;
  }
</style>
