<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { Plus, Search } from '@lucide/svelte'
  import { get } from 'svelte/store'
  import { backlogLabelFilters, commandHeld, focusBoardFilters, lastViewedTaskId, mergingTaskIds } from '../../lib/stores'
  import { filterTasks, getFilterCounts, taskMatchesTextFilter } from '../../lib/boardFilters'
  import type { BoardFilter } from '../../lib/boardFilters'
  import { getDependencyWaitLabel } from '../../lib/taskDependencies'
  import { getTaskReasonText } from '../../lib/taskStatePresentation'
  import { computeTaskState } from '../../lib/taskState'
  import { sortBySessionActivity } from '../../lib/taskSort'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { getHTMLElementAt } from '../../lib/domUtils'
  import { getProjectTaskLabels } from '../../lib/ipc'
  import { getBacklogLabelCounts, getLabelsWithBacklogItems, getTaskLabels, pruneSelectedBacklogLabelIds, taskMatchesAnySelectedLabel } from '../../lib/taskLabels'
  import TaskListItem from './TaskListItem.svelte'
  import TaskInspectorPanel from '../task-detail/TaskInspectorPanel.svelte'
  import TaskContextMenu from '../shared/tasks/TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
  import BoardTextFilter from './BoardTextFilter.svelte'
  import { createOutOfFocusController } from './outOfFocusController.svelte'
  import type { Task, TaskAttentionRow, AgentSession, PullRequestInfo, TaskLabel } from '../../lib/types'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: Task[]
    dependencyReferenceTasks?: Task[]
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
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null; promptPrefix?: string | null }) => void
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


  let selectedTaskIdLocal: string | null = $state(null)
  // Which card the user just returned from — snapshot once at init (before it's
  // cleared), used both to seed selection/focus on mount and to play the one-shot pop.
  // The {#each} is keyed by task.id, so existing cards aren't remounted on data
  // refresh and the pop won't replay.
  let recentlyViewedTaskId = $state<string | null>(get(lastViewedTaskId))
  let restoredRecentlyViewedTask = $state(false)
  let paneHasFocus = $state(false)
  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })
  let projectLabels = $state<TaskLabel[]>([])
  let fallbackFilter: BoardFilter = $state('focus')
  let previousProjectId: string | null | undefined = undefined
  let labelLoadRequest = 0
  let labelLoadProjectId: string | null = null
  let textFilterQuery = $state('')

  let activeFilter = $derived.by(() => {
    if (!projectId) return fallbackFilter
    return $focusBoardFilters.get(projectId) ?? 'focus'
  })

  let selectedLabelIds = $derived.by(() => {
    if (!projectId) return new Set<number>()
    return $backlogLabelFilters.get(projectId) ?? new Set<number>()
  })

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

  let visibleTasks = $derived.by(() => {
    const tasksToFilter = activeFilter === 'backlog' ? tasks : tasksWithReadyAttentionMetadata
    const filtered = filterTasks(tasksToFilter, activeFilter, attentionTaskIds, outOfFocusTaskIds)
    const labelFiltered = activeFilter === 'backlog'
      ? filtered.filter((task) => taskMatchesAnySelectedLabel(task, selectedLabelIds))
      : filtered
    const textFiltered = labelFiltered.filter((task) => taskMatchesTextFilter(task, textFilterQuery))

    if (activeFilter === 'focus') {
      return textFiltered.slice().sort((left, right) =>
        (attentionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
          - (attentionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      )
    }
    return sortBySessionActivity(textFiltered, activeSessions)
  })

  let visibleRows = $derived.by<TaskRow[]>(() =>
    visibleTasks.map((task, taskIndex) => ({ task, taskIndex })),
  )

  let navigableCount = $derived(visibleTasks.length)

  let filterCounts = $derived.by(() =>
    getFilterCounts(tasksWithReadyAttentionMetadata, attentionTaskIds, outOfFocusTaskIds),
  )
  let displayProjectLabels = $derived.by(() => {
    const labelsById = new Map(projectLabels.map((label) => [label.id, label]))
    for (const task of tasks) {
      for (const label of getTaskLabels(task)) {
        labelsById.set(label.id, label)
      }
    }
    return Array.from(labelsById.values()).sort((a, b) => a.name.localeCompare(b.name))
  })
  let labelCounts = $derived.by(() => getBacklogLabelCounts(tasks, displayProjectLabels))
  let visibleFilterLabels = $derived.by(() => getLabelsWithBacklogItems(displayProjectLabels, labelCounts))

  let selectedTask = $derived.by(() => {
    if (!selectedTaskIdLocal) return null
    return visibleTasks.find(t => t.id === selectedTaskIdLocal) ?? null
  })

  function setActiveFilter(filter: BoardFilter) {
    if (!projectId) {
      fallbackFilter = filter
      return
    }
    const nextFilters = new Map($focusBoardFilters)
    nextFilters.set(projectId, filter)
    focusBoardFilters.set(nextFilters)
  }

  $effect(() => {
    const currentProjectId = projectId
    const isInitialProject = previousProjectId === undefined
    if (!isInitialProject && currentProjectId !== previousProjectId) {
      backlogLabelFilters.set(new Map())
      selectedTaskIdLocal = null
      textFilterQuery = ''
    }
    previousProjectId = currentProjectId

    if (!currentProjectId) {
      labelLoadProjectId = null
      projectLabels = []
      return
    }
    if (labelLoadProjectId === currentProjectId) return

    labelLoadProjectId = currentProjectId
    projectLabels = []
    const requestId = ++labelLoadRequest
    getProjectTaskLabels(currentProjectId)
      .then((labels) => {
        if (requestId === labelLoadRequest && labelLoadProjectId === currentProjectId) projectLabels = labels
      })
      .catch(() => {
        if (requestId === labelLoadRequest && labelLoadProjectId === currentProjectId) projectLabels = []
      })
  })

  $effect(() => {
    if (selectedTaskIdLocal && !visibleTasks.find(t => t.id === selectedTaskIdLocal)) {
      selectedTaskIdLocal = null
    }
  })

  $effect(() => {
    if (!projectId || selectedLabelIds.size === 0) return

    const prunedSelectedIds = pruneSelectedBacklogLabelIds(selectedLabelIds, visibleFilterLabels)
    if (prunedSelectedIds.size === selectedLabelIds.size) return

    const nextFilters = new Map($backlogLabelFilters)
    if (prunedSelectedIds.size > 0) {
      nextFilters.set(projectId, prunedSelectedIds)
    } else {
      nextFilters.delete(projectId)
    }
    backlogLabelFilters.set(nextFilters)
  })

  const vim = useVimNavigation({
    getItemCount: () => navigableCount,
    onSelect: (index) => {
      const task = visibleTasks[index]
      if (task) onOpenTask(task.id)
    },
    onBack: () => {
      selectedTaskIdLocal = null
    },
    onAction: (index) => {
      const task = visibleTasks[index]
      if (task) onRunAction({ taskId: task.id, actionPrompt: '', agent: null })
    },
  })

  onMount(() => {
    // Returning from a task detail view: focus that task so it becomes the selected
    // card. The focusedIndex effects below sync selectedTaskIdLocal and scroll it into
    // view. Falls back to the default first-card focus when it isn't currently visible.
    if (recentlyViewedTaskId) {
      const idx = visibleTasks.findIndex((t) => t.id === recentlyViewedTaskId)
      if (idx >= 0) {
        vim.setFocusedIndex(idx)
        restoredRecentlyViewedTask = true
      }
    }
    if (get(lastViewedTaskId) !== null) {
      lastViewedTaskId.set(null)
    }
  })

  $effect(() => {
    if (restoredRecentlyViewedTask || !recentlyViewedTaskId) return

    const idx = visibleTasks.findIndex((t) => t.id === recentlyViewedTaskId)
    if (idx >= 0) {
      vim.setFocusedIndex(idx)
      restoredRecentlyViewedTask = true
    }
  })

  $effect(() => {
    const count = navigableCount
    if (count === 0) return
    if (vim.focusedIndex >= count) {
      vim.setFocusedIndex(count - 1)
    }
  })

  $effect(() => {
    const idx = vim.focusedIndex
    untrack(() => {
      const items = document.querySelectorAll('[data-vim-item]')
      const el = getHTMLElementAt(items, idx)
      el?.scrollIntoView?.({ block: 'nearest' })
    })
  })

  $effect(() => {
    const idx = vim.focusedIndex
    const task = visibleTasks[idx]
    if (task) {
      selectedTaskIdLocal = task.id
    }
  })


  $effect(() => {
    outOfFocusController.selectProject(projectId)
  })

  function handleBoardKeydown(e: KeyboardEvent) {
    // CMD+1/2/3/4 filter chip shortcuts (works even when pane has focus)
    if (e.metaKey && !e.shiftKey && !e.altKey) {
      const filterMap: Record<string, BoardFilter> = { '1': 'focus', '2': 'in-flight', '3': 'out-of-focus', '4': 'backlog' }
      const filter = filterMap[e.key]
      if (filter) {
        e.preventDefault()
        setActiveFilter(filter)
        selectedTaskIdLocal = null
        vim.setFocusedIndex(0)
        return
      }
    }

    if (paneHasFocus) return
    vim.handleKeydown(e)
  }

  function toggleLabelFilter(labelId: number) {
    if (!projectId) return
    const nextSelectedIds = new Set(selectedLabelIds)
    if (nextSelectedIds.has(labelId)) {
      nextSelectedIds.delete(labelId)
    } else {
      nextSelectedIds.add(labelId)
    }
    const nextFilters = new Map($backlogLabelFilters)
    if (nextSelectedIds.size > 0) {
      nextFilters.set(projectId, nextSelectedIds)
    } else {
      nextFilters.delete(projectId)
    }
    backlogLabelFilters.set(nextFilters)
    selectedTaskIdLocal = null
    vim.setFocusedIndex(0)
  }

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }


</script>

<div class="of-board-theme flex h-full flex-col bg-base-100">
  <header class="shrink-0 border-b border-base-300 bg-base-100 px-8 py-2">
    <div class="flex min-w-0 flex-wrap items-center gap-4 xl:flex-nowrap">
      <div class="w-60 shrink-0">
        <h1 class="truncate text-base font-semibold leading-5 tracking-[-0.01em] text-base-content">{projectName}</h1>
      </div>

      <button
        type="button"
        class="of-field flex h-9 min-w-64 max-w-[30rem] flex-1 items-center gap-2.5 px-3 text-left text-xs text-base-content/55"
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
              class="join-item relative min-h-8 border border-base-300 bg-base-100 px-3 text-xs font-medium transition-colors {activeFilter === opt.value
                ? 'z-10 border-primary bg-primary/[0.03] text-primary ring-1 ring-primary/20'
                : 'text-base-content/65 hover:bg-base-200/60 hover:text-base-content'}"
              aria-pressed={activeFilter === opt.value}
              onclick={() => {
                setActiveFilter(opt.value)
                selectedTaskIdLocal = null
                vim.setFocusedIndex(0)
              }}
            >
              <span>{opt.label} <span class="ml-1 text-[10px] opacity-60">{filterCounts[opt.value]}</span></span>
              {#if $commandHeld}
                <kbd class="kbd kbd-xs ml-1 opacity-60">{opt.shortcut}</kbd>
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
              onclick={() => toggleLabelFilter(label.id)}
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

        {#if visibleTasks.length === 0 && textFilterQuery.trim()}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center" role="status">
            <Search size={24} class="text-base-content/35" aria-hidden="true" />
            <p class="text-sm font-medium text-base-content/70">No tasks match ‘{textFilterQuery.trim()}’.</p>
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
                isFocused={vim.focusedIndex === row.taskIndex}
                justViewed={recentlyViewedTaskId === task.id}
                isMerging={$mergingTaskIds.has(task.id)}
                onSelect={() => {
                  if (selectedTaskIdLocal === task.id) {
                    onOpenTask(task.id)
                  } else {
                    selectedTaskIdLocal = task.id
                    vim.setFocusedIndex(row.taskIndex)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, task.id)}
                {onTaskUpdated}
              />
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="w-[clamp(420px,31vw,820px)] flex-shrink-0" onfocusin={() => paneHasFocus = true} onfocusout={() => paneHasFocus = false}>
      <TaskInspectorPanel
        task={selectedTask}
        allTasks={tasks}
        {dependencyReferenceTasks}
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
      bind:query={textFilterQuery}
      matchingCount={visibleTasks.length}
      shortcutBlocked={contextMenu.visible}
      onBoardKeydown={handleBoardKeydown}
    />
  {/key}

  <TaskContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    taskId={contextMenu.taskId}
    onClose={() => contextMenu = { ...contextMenu, visible: false }}
    onStart={(taskId, promptPrefix) => onRunAction({ taskId, actionPrompt: '', agent: null, promptPrefix })}
    onEdit={onEditTask}
    onDelete={() => contextMenu = { ...contextMenu, visible: false }}
    {outOfFocusTaskIds}
    onMoveToOutOfFocus={outOfFocusController.setAside}
    onReturnToBoard={outOfFocusController.returnToBoard}
  />
</div>
