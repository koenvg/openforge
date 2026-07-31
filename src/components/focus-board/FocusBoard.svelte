<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { backlogLabelFilters, commandHeld, focusBoardFilters, lastViewedTaskId, outOfFocusTaskIdsByProject, mergingTaskIds } from '../../lib/stores'
  import { filterTasks, getFilterCounts, loadOutOfFocusTaskIds, saveOutOfFocusTaskIds } from '../../lib/boardFilters'
  import type { BoardFilter } from '../../lib/boardFilters'
  import { getDependencyWaitLabel } from '../../lib/taskDependencies'
  import { getTaskReasonText } from '../../lib/taskStatePresentation'
  import { computeTaskState } from '../../lib/taskState'
  import { sortBySessionActivity } from '../../lib/taskSort'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { getHTMLElementAt, isInputFocused } from '../../lib/domUtils'
  import { getProjectTaskLabels } from '../../lib/ipc'
  import { getBacklogLabelCounts, getLabelsWithBacklogItems, getTaskLabels, pruneSelectedBacklogLabelIds, taskMatchesAnySelectedLabel } from '../../lib/taskLabels'
  import TaskListItem from './TaskListItem.svelte'
  import TaskDetailPane from './TaskDetailPane.svelte'
  import TaskContextMenu from '../shared/tasks/TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
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
    onOpenTask: (taskId: string) => void
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { projectId, projectName, tasks, dependencyReferenceTasks = [], activeSessions, ticketPrs, attentionRows = [], attentionRowsLoaded = true, onOpenTask, onEditTask, onTaskUpdated, onProjectAttentionChanged, onRunAction }: Props = $props()
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
  let loadedOutOfFocusProjectId: string | null = $state(null)
  let fallbackFilter: BoardFilter = $state('focus')
  let previousProjectId: string | null | undefined = undefined
  let labelLoadRequest = 0
  let labelLoadProjectId: string | null = null
  let outOfFocusLoadRequest = 0

  let activeFilter = $derived.by(() => {
    if (!projectId) return fallbackFilter
    return $focusBoardFilters.get(projectId) ?? 'focus'
  })

  let selectedLabelIds = $derived.by(() => {
    if (!projectId) return new Set<number>()
    return $backlogLabelFilters.get(projectId) ?? new Set<number>()
  })

  let outOfFocusTaskIds = $derived.by(() => {
    if (!projectId) return new Set<string>()
    return $outOfFocusTaskIdsByProject.get(projectId) ?? new Set<string>()
  })
  let projectAttentionRows = $derived(
    projectId ? attentionRows.filter((row) => row.project_id === projectId) : [],
  )
  let attentionTaskIds = $derived(new Set(projectAttentionRows.map((row) => row.task_id)))
  let attentionByTaskId = $derived(new Map(projectAttentionRows.map((row) => [row.task_id, row])))
  let attentionOrder = $derived(new Map(projectAttentionRows.map((row, index) => [row.task_id, index])))

  let boardMetadataReady = $derived(
    (!projectId || loadedOutOfFocusProjectId === projectId) && attentionRowsLoaded,
  )

  let tasksWithReadyAttentionMetadata = $derived.by(() =>
    boardMetadataReady ? tasks : tasks.filter((task) => task.status === 'backlog'),
  )

  let visibleTasks = $derived.by(() => {
    const tasksToFilter = activeFilter === 'backlog' ? tasks : tasksWithReadyAttentionMetadata
    const filtered = filterTasks(tasksToFilter, activeFilter, attentionTaskIds, outOfFocusTaskIds)
    const labelFiltered = activeFilter === 'backlog'
      ? filtered.filter((task) => taskMatchesAnySelectedLabel(task, selectedLabelIds))
      : filtered

    if (activeFilter === 'focus') {
      return labelFiltered.slice().sort((left, right) =>
        (attentionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
          - (attentionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      )
    }
    return sortBySessionActivity(labelFiltered, activeSessions)
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
    const currentProjectId = projectId
    const requestId = ++outOfFocusLoadRequest

    loadedOutOfFocusProjectId = null
    if (!currentProjectId) {
      loadedOutOfFocusProjectId = null
      return
    }

    loadOutOfFocusTaskIds(currentProjectId)
      .then((taskIds) => {
        if (requestId !== outOfFocusLoadRequest) return
        outOfFocusTaskIdsByProject.update((current) => {
          const next = new Map(current)
          if (taskIds.size > 0) {
            next.set(currentProjectId, taskIds)
          } else {
            next.delete(currentProjectId)
          }
          return next
        })
        loadedOutOfFocusProjectId = currentProjectId
      })
      .catch(() => {
        if (requestId !== outOfFocusLoadRequest) return
        outOfFocusTaskIdsByProject.update((current) => {
          const next = new Map(current)
          next.delete(currentProjectId)
          return next
        })
        loadedOutOfFocusProjectId = currentProjectId
      })
  })

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return

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

  function setTaskOutOfFocus(taskId: string, shouldBeOutOfFocus: boolean) {
    if (!projectId) return

    const currentProjectId = projectId
    let nextTaskIds = new Set<string>()
    outOfFocusTaskIdsByProject.update((current) => {
      const next = new Map(current)
      nextTaskIds = new Set(next.get(currentProjectId) ?? new Set<string>())
      if (shouldBeOutOfFocus) {
        nextTaskIds.add(taskId)
      } else {
        nextTaskIds.delete(taskId)
      }
      if (nextTaskIds.size > 0) {
        next.set(currentProjectId, nextTaskIds)
      } else {
        next.delete(currentProjectId)
      }
      return next
    })

    saveOutOfFocusTaskIds(currentProjectId, nextTaskIds)
      .then(() => onProjectAttentionChanged?.())
      .catch((err: unknown) => {
        console.error('Failed to save Out of Focus tasks:', err)
      })
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-5 h-full p-7 bg-base-200/50">
  <div class="flex flex-col gap-2">
    <span class="font-mono text-[10px] font-semibold text-base-content/40 tracking-widest uppercase">BOARD</span>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-base-content">{projectName}</h1>
        <p class="text-sm text-base-content/50">Focus on what needs attention first, with context always visible.</p>
      </div>
      <div class="flex items-center gap-2">
        {#each FILTER_OPTIONS as opt}
          <button
            class="rounded-[18px] px-3 py-2 text-xs font-medium transition-colors {activeFilter === opt.value
              ? 'bg-base-100 border border-base-300 shadow-sm text-base-content'
              : 'bg-base-200 text-base-content/50 hover:text-base-content/70'}"
            aria-pressed={activeFilter === opt.value}
            onclick={() => {
              setActiveFilter(opt.value)
              selectedTaskIdLocal = null
              vim.setFocusedIndex(0)
            }}
          >
            <span>{opt.label} {filterCounts[opt.value]}</span>
            {#if $commandHeld}
              <kbd class="kbd kbd-xs opacity-50 ml-1">{opt.shortcut}</kbd>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="flex gap-6 flex-1 min-h-0">
    <div class="flex flex-col gap-4 flex-1 min-w-0 min-h-0">
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
        {#if activeFilter === 'focus' || activeFilter === 'out-of-focus'}
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-base-content/70">Needs attention</span>
              <span class="badge badge-ghost badge-sm">{filterCounts[activeFilter]}</span>
            </div>
            <span class="text-xs text-base-content/40">Quiet by default · select for context</span>
          </div>
        {/if}

        {#if visibleTasks.length === 0}
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

    <div class="w-2/5 flex-shrink-0" onfocusin={() => paneHasFocus = true} onfocusout={() => paneHasFocus = false}>
      <TaskDetailPane
        task={selectedTask}
        allTasks={tasks}
        {dependencyReferenceTasks}
        pullRequests={selectedTask ? ticketPrs.get(selectedTask.id) ?? [] : []}
        onEditTask={onEditTask}
        onOpenLinkedTask={onOpenTask}
        onOpenFullView={() => {
          if (selectedTaskIdLocal) onOpenTask(selectedTaskIdLocal)
        }}
      />
    </div>
  </div>

  <TaskContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    taskId={contextMenu.taskId}
    onClose={() => contextMenu = { ...contextMenu, visible: false }}
    onStart={(taskId) => onRunAction({ taskId, actionPrompt: '', agent: null })}
    onEdit={onEditTask}
    onDelete={() => contextMenu = { ...contextMenu, visible: false }}
    {outOfFocusTaskIds}
    onMoveToOutOfFocus={(taskId) => setTaskOutOfFocus(taskId, true)}
    onReturnToBoard={(taskId) => setTaskOutOfFocus(taskId, false)}
  />
</div>
