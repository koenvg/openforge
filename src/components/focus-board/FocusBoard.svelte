<script lang="ts">
  import { untrack } from 'svelte'
  import { backlogLabelFilters, commandHeld, focusBoardFilters, lowFireTaskIdsByProject, mergingTaskIds } from '../../lib/stores'
  import { filterTasks, getFilterCounts, DEFAULT_FOCUS_STATES, loadFocusFilterStates, loadLowFireTaskIds, saveLowFireTaskIds, isFocusTask } from '../../lib/boardFilters'
  import type { BoardFilter } from '../../lib/boardFilters'
  import { getDependencyWaitLabel } from '../../lib/taskDependencies'
  import { getTaskReasonText } from '../../lib/taskStatePresentation'
  import { computeTaskState } from '../../lib/taskState'
  import type { TaskState } from '../../lib/taskState'
  import { sortBySessionActivity } from '../../lib/taskSort'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { getHTMLElementAt, isInputFocused } from '../../lib/domUtils'
  import { loadActions, getEnabledActions } from '../../lib/actions'
  import { getProjectTaskLabels } from '../../lib/ipc'
  import { getBacklogLabelCounts, getLabelsWithBacklogItems, getTaskLabels, pruneSelectedBacklogLabelIds, taskMatchesAnySelectedLabel } from '../../lib/taskLabels'
  import TaskListItem from './TaskListItem.svelte'
  import TaskDetailPane from './TaskDetailPane.svelte'
  import TaskContextMenu from '../shared/tasks/TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
  import type { Task, AgentSession, PullRequestInfo, Action, TaskLabel } from '../../lib/types'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: Task[]
    activeSessions: Map<string, AgentSession>
    ticketPrs: Map<string, PullRequestInfo[]>
    onOpenTask: (taskId: string) => void
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  type TaskRow = {
    type: 'task'
    task: Task
    taskIndex: number
    isInFlight: boolean
  } | {
    type: 'divider'
    count: number
  }

  const FILTER_OPTIONS = [
    { value: 'focus' as BoardFilter, label: 'Focus', shortcut: '⌘1' },
    { value: 'low-fire' as BoardFilter, label: 'Low-Fire', shortcut: '⌘2' },
    { value: 'backlog' as BoardFilter, label: 'Backlog', shortcut: '⌘3' },
  ] as const

  let { projectId, projectName, tasks, activeSessions, ticketPrs, onOpenTask, onEditTask, onTaskUpdated, onRunAction }: Props = $props()

  let selectedTaskIdLocal: string | null = $state(null)
  let paneHasFocus = $state(false)
  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })
  let projectActions = $state<Action[]>([])
  let projectLabels = $state<TaskLabel[]>([])
  let focusStates = $state<TaskState[]>(DEFAULT_FOCUS_STATES)
  let fallbackFilter: BoardFilter = $state('focus')
  let previousProjectId: string | null | undefined = undefined
  let labelLoadRequest = 0
  let lowFireLoadRequest = 0

  let activeFilter = $derived.by(() => {
    if (!projectId) return fallbackFilter
    return $focusBoardFilters.get(projectId) ?? 'focus'
  })

  let selectedLabelIds = $derived.by(() => {
    if (!projectId) return new Set<number>()
    return $backlogLabelFilters.get(projectId) ?? new Set<number>()
  })

  let lowFireTaskIds = $derived.by(() => {
    if (!projectId) return new Set<string>()
    return $lowFireTaskIdsByProject.get(projectId) ?? new Set<string>()
  })

  let groupedTasks = $derived.by(() => {
    const filtered = filterTasks(tasks, activeFilter, activeSessions, ticketPrs, focusStates, lowFireTaskIds)
    const labelFiltered = activeFilter === 'backlog'
      ? filtered.filter((task) => taskMatchesAnySelectedLabel(task, selectedLabelIds))
      : filtered

    if (activeFilter === 'backlog') {
      return {
        attention: sortBySessionActivity(labelFiltered, activeSessions),
        inFlight: [],
      }
    }

    const attention: Task[] = []
    const inFlight: Task[] = []
    for (const task of labelFiltered) {
      const session = activeSessions.get(task.id) ?? null
      const pullRequests = ticketPrs.get(task.id) ?? []
      const state = computeTaskState(task, session, pullRequests)
      if (isFocusTask(task, state, pullRequests, focusStates)) {
        attention.push(task)
      } else {
        inFlight.push(task)
      }
    }

    return {
      attention: sortBySessionActivity(attention, activeSessions),
      inFlight: sortBySessionActivity(inFlight, activeSessions),
    }
  })

  let filteredTasks = $derived.by(() => [...groupedTasks.attention, ...groupedTasks.inFlight])

  let visibleRows = $derived.by<TaskRow[]>(() => {
    if (activeFilter === 'backlog') {
      return groupedTasks.attention.map((task, taskIndex) => ({ type: 'task', task, taskIndex, isInFlight: false }))
    }

    const rows: TaskRow[] = groupedTasks.attention.map((task, taskIndex) => ({ type: 'task', task, taskIndex, isInFlight: false }))
    if (groupedTasks.inFlight.length > 0) {
      rows.push({ type: 'divider', count: groupedTasks.inFlight.length })
      rows.push(...groupedTasks.inFlight.map((task, index) => ({
        type: 'task' as const,
        task,
        taskIndex: groupedTasks.attention.length + index,
        isInFlight: true,
      })))
    }
    return rows
  })

  let filterCounts = $derived.by(() => getFilterCounts(tasks, activeSessions, ticketPrs, focusStates, lowFireTaskIds))
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
    return filteredTasks.find(t => t.id === selectedTaskIdLocal) ?? null
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
    const isInitialProject = previousProjectId === undefined
    if (!isInitialProject && projectId !== previousProjectId) {
      backlogLabelFilters.set(new Map())
      selectedTaskIdLocal = null
    }
    previousProjectId = projectId

    if (!projectId) {
      projectLabels = []
      return
    }
    const requestId = ++labelLoadRequest
    getProjectTaskLabels(projectId)
      .then((labels) => {
        if (requestId === labelLoadRequest) projectLabels = labels
      })
      .catch(() => {
        if (requestId === labelLoadRequest) projectLabels = []
      })
  })

  $effect(() => {
    if (selectedTaskIdLocal && !filteredTasks.find(t => t.id === selectedTaskIdLocal)) {
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
    getItemCount: () => filteredTasks.length,
    onSelect: (index) => {
      const task = filteredTasks[index]
      if (task) onOpenTask(task.id)
    },
    onBack: () => {
      selectedTaskIdLocal = null
    },
    onAction: (index) => {
      const task = filteredTasks[index]
      if (task) onRunAction({ taskId: task.id, actionPrompt: '', agent: null })
    },
  })

  $effect(() => {
    const count = filteredTasks.length
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
    const task = filteredTasks[idx]
    if (task) {
      selectedTaskIdLocal = task.id
    }
  })

  $effect(() => {
    const projectId = tasks.find(t => t.project_id !== null)?.project_id
    if (!projectId) {
      projectActions = []
      return
    }
    loadActions(projectId)
      .then((all) => {
        projectActions = getEnabledActions(all)
      })
      .catch(() => {
        projectActions = []
      })
  })

  $effect(() => {
    const projectId = tasks.find(t => t.project_id !== null)?.project_id
    if (projectId) {
      loadFocusFilterStates(projectId).then(states => {
        focusStates = states
      })
    }
  })

  $effect(() => {
    const currentProjectId = projectId
    if (!currentProjectId) return

    const requestId = ++lowFireLoadRequest
    loadLowFireTaskIds(currentProjectId)
      .then((taskIds) => {
        if (requestId !== lowFireLoadRequest) return
        lowFireTaskIdsByProject.update((current) => {
          const next = new Map(current)
          if (taskIds.size > 0) {
            next.set(currentProjectId, taskIds)
          } else {
            next.delete(currentProjectId)
          }
          return next
        })
      })
      .catch(() => {
        if (requestId !== lowFireLoadRequest) return
        lowFireTaskIdsByProject.update((current) => {
          const next = new Map(current)
          next.delete(currentProjectId)
          return next
        })
      })
  })

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return

    // CMD+1/2/3 filter chip shortcuts (works even when pane has focus)
    if (e.metaKey && !e.shiftKey && !e.altKey) {
      const filterMap: Record<string, BoardFilter> = { '1': 'focus', '2': 'low-fire', '3': 'backlog' }
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

  function setTaskLowFire(taskId: string, shouldBeLowFire: boolean) {
    if (!projectId) return

    const currentProjectId = projectId
    let nextTaskIds = new Set<string>()
    lowFireTaskIdsByProject.update((current) => {
      const next = new Map(current)
      nextTaskIds = new Set(next.get(currentProjectId) ?? new Set<string>())
      if (shouldBeLowFire) {
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

    saveLowFireTaskIds(currentProjectId, nextTaskIds).catch((err: unknown) => {
      console.error('Failed to save Low-Fire tasks:', err)
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
    <div class="flex flex-col gap-4 flex-1 min-w-0 overflow-y-auto">
      {#if activeFilter === 'focus' || activeFilter === 'low-fire'}
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-base-content/70">Needs attention</span>
            <span class="badge badge-ghost badge-sm">{filterCounts[activeFilter]}</span>
          </div>
          <span class="text-xs text-base-content/40">Quiet by default · select for context</span>
        </div>
      {/if}

      {#if activeFilter === 'backlog' && visibleFilterLabels.length > 0}
        <div class="flex flex-wrap items-center gap-2" aria-label="Backlog label filters">
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

      {#if filteredTasks.length === 0}
        <FocusEmptyState filter={activeFilter} />
      {:else}
        {#each visibleRows as row (row.type === 'divider' ? 'in-flight-divider' : row.task.id)}
          {#if row.type === 'divider'}
            <div class="flex items-center gap-3 py-1" role="separator" aria-label="In-flight tasks">
              <div class="h-px flex-1 bg-base-content/10"></div>
              <div class="flex items-center gap-2 text-xs font-semibold text-base-content/45">
                <span>In-flight</span>
                <span class="badge badge-ghost badge-xs">{row.count}</span>
              </div>
              <div class="h-px flex-1 bg-base-content/10"></div>
            </div>
          {:else}
            {@const task = row.task}
            {@const session = activeSessions.get(task.id) ?? null}
            {@const pullRequests = ticketPrs.get(task.id) ?? []}
            {@const state = computeTaskState(task, session, pullRequests)}
            <div class={row.isInFlight ? 'opacity-60 hover:opacity-100 transition-opacity' : ''}>
              <TaskListItem
                {task}
                {state}
                {session}
                {pullRequests}
                reasonText={getTaskReasonText(state, pullRequests)}
                dependencyHint={activeFilter === 'backlog' ? getDependencyWaitLabel(task, tasks) : null}
                showLabels={activeFilter === 'backlog'}
                isSelected={selectedTaskIdLocal === task.id}
                isFocused={vim.focusedIndex === row.taskIndex}
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
          {/if}
        {/each}
      {/if}
    </div>

    <div class="w-2/5 flex-shrink-0" onfocusin={() => paneHasFocus = true} onfocusout={() => paneHasFocus = false}>
      <TaskDetailPane
        task={selectedTask}
        allTasks={tasks}
        pullRequests={selectedTask ? ticketPrs.get(selectedTask.id) ?? [] : []}
        onEditTask={onEditTask}
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
    actions={projectActions}
    {lowFireTaskIds}
    onMoveToLowFire={(taskId) => setTaskLowFire(taskId, true)}
    onMoveToFocus={(taskId) => setTaskLowFire(taskId, false)}
    {onRunAction}
  />
</div>
