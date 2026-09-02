import { fromStore } from 'svelte/store'
import { filterTasks, getFilterCounts, taskMatchesTextFilter } from '../../lib/boardFilters'
import type { BoardFilter } from '../../lib/boardFilters'
import { getProjectTaskLabels } from '../../lib/ipc'
import { backlogLabelFilters, backlogReadyFilters, focusBoardFilters } from '../../lib/stores'
import { getReadyToStartTaskIds } from '../../lib/taskDependencies'
import { sortBySessionActivity } from '../../lib/taskSort'
import {
  getBacklogLabelCounts,
  getLabelsWithBacklogItems,
  getTaskLabels,
  pruneSelectedBacklogLabelIds,
  taskMatchesAnySelectedLabel,
} from '../../lib/taskLabels'
import type { AgentSession, TaskDetail, TaskLabel, TaskReference } from '../../lib/types'

export interface FocusBoardFilterControllerOptions {
  getProjectId: () => string | null
  getTasks: () => TaskDetail[]
  getTasksWithReadyAttentionMetadata: () => TaskDetail[]
  getDependencyResolutionTasks: () => Array<TaskDetail | TaskReference>
  getActiveSessions: () => Map<string, AgentSession>
  getAttentionTaskIds: () => ReadonlySet<string>
  getAttentionOrder: () => ReadonlyMap<string, number>
  getOutOfFocusTaskIds: () => ReadonlySet<string>
}

export function createFocusBoardFilterController(options: FocusBoardFilterControllerOptions) {
  const focusFiltersState = fromStore(focusBoardFilters)
  const backlogLabelFiltersState = fromStore(backlogLabelFilters)
  const backlogReadyFiltersState = fromStore(backlogReadyFilters)

  let projectLabels = $state<TaskLabel[]>([])
  let fallbackFilter = $state<BoardFilter>('focus')
  let previousProjectId: string | null | undefined
  let labelLoadRequest = 0
  let labelLoadProjectId: string | null = null
  let textFilterQuery = $state('')

  const activeFilter = $derived.by(() => {
    const projectId = options.getProjectId()
    if (!projectId) return fallbackFilter
    return focusFiltersState.current.get(projectId) ?? 'focus'
  })

  const selectedLabelIds = $derived.by<Set<number>>(() => {
    const projectId = options.getProjectId()
    if (!projectId) return new Set<number>()
    return backlogLabelFiltersState.current.get(projectId) ?? new Set<number>()
  })

  const readyOnly = $derived.by(() => {
    const projectId = options.getProjectId()
    return projectId ? backlogReadyFiltersState.current.get(projectId) ?? false : false
  })

  const backlogTasks = $derived.by(() => options.getTasks().filter((task) => task.status === 'backlog'))
  const readyTaskIds = $derived.by(() =>
    getReadyToStartTaskIds(backlogTasks, options.getDependencyResolutionTasks()),
  )

  const visibleTasks = $derived.by(() => {
    const tasks = options.getTasks()
    const tasksToFilter = activeFilter === 'backlog'
      ? tasks
      : options.getTasksWithReadyAttentionMetadata()
    const filtered = filterTasks(
      tasksToFilter,
      activeFilter,
      options.getAttentionTaskIds(),
      options.getOutOfFocusTaskIds(),
    )
    const readinessFiltered = activeFilter === 'backlog' && readyOnly
      ? filtered.filter((task) => readyTaskIds.has(task.id))
      : filtered
    const labelFiltered = activeFilter === 'backlog'
      ? readinessFiltered.filter((task) => taskMatchesAnySelectedLabel(task, selectedLabelIds))
      : readinessFiltered
    const textFiltered = labelFiltered.filter((task) => taskMatchesTextFilter(task, textFilterQuery))

    if (activeFilter === 'focus') {
      const attentionOrder = options.getAttentionOrder()
      return textFiltered.slice().sort((left, right) =>
        (attentionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
          - (attentionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      )
    }
    return sortBySessionActivity(textFiltered, options.getActiveSessions())
  })

  const filterCounts = $derived.by(() => getFilterCounts(
    options.getTasksWithReadyAttentionMetadata(),
    options.getAttentionTaskIds(),
    options.getOutOfFocusTaskIds(),
  ))

  const readyCount = $derived(readyTaskIds.size)

  const displayProjectLabels = $derived.by(() => {
    const labelsById = new Map(projectLabels.map((label) => [label.id, label]))
    for (const task of options.getTasks()) {
      for (const label of getTaskLabels(task)) labelsById.set(label.id, label)
    }
    return Array.from(labelsById.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const labelCounts = $derived.by(() => getBacklogLabelCounts(options.getTasks(), displayProjectLabels))
  const visibleFilterLabels = $derived.by(() => getLabelsWithBacklogItems(displayProjectLabels, labelCounts))

  function setActiveFilter(filter: BoardFilter): void {
    const projectId = options.getProjectId()
    if (!projectId) {
      fallbackFilter = filter
      return
    }
    const nextFilters = new Map(focusFiltersState.current)
    nextFilters.set(projectId, filter)
    focusBoardFilters.set(nextFilters)
  }

  function toggleReadyFilter(): void {
    const projectId = options.getProjectId()
    if (!projectId) return

    const nextFilters = new Map(backlogReadyFiltersState.current)
    if (readyOnly) nextFilters.delete(projectId)
    else nextFilters.set(projectId, true)
    backlogReadyFilters.set(nextFilters)
  }

  function toggleLabelFilter(labelId: number): void {
    const projectId = options.getProjectId()
    if (!projectId) return

    const nextSelectedIds = new Set(selectedLabelIds)
    if (nextSelectedIds.has(labelId)) nextSelectedIds.delete(labelId)
    else nextSelectedIds.add(labelId)

    const nextFilters = new Map(backlogLabelFiltersState.current)
    if (nextSelectedIds.size > 0) nextFilters.set(projectId, nextSelectedIds)
    else nextFilters.delete(projectId)
    backlogLabelFilters.set(nextFilters)
  }

  $effect(() => {
    const currentProjectId = options.getProjectId()
    const isInitialProject = previousProjectId === undefined
    if (!isInitialProject && currentProjectId !== previousProjectId) {
      backlogLabelFilters.set(new Map())
      backlogReadyFilters.set(new Map())
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
    void getProjectTaskLabels(currentProjectId)
      .then((labels) => {
        if (requestId === labelLoadRequest && labelLoadProjectId === currentProjectId) projectLabels = labels
      })
      .catch(() => {
        if (requestId === labelLoadRequest && labelLoadProjectId === currentProjectId) projectLabels = []
      })
  })

  $effect(() => {
    const projectId = options.getProjectId()
    if (!projectId || selectedLabelIds.size === 0) return

    const prunedSelectedIds = pruneSelectedBacklogLabelIds(selectedLabelIds, visibleFilterLabels)
    if (prunedSelectedIds.size === selectedLabelIds.size) return

    const nextFilters = new Map(backlogLabelFiltersState.current)
    if (prunedSelectedIds.size > 0) nextFilters.set(projectId, prunedSelectedIds)
    else nextFilters.delete(projectId)
    backlogLabelFilters.set(nextFilters)
  })

  return {
    get activeFilter() { return activeFilter },
    get readyOnly() { return readyOnly },
    get readyCount() { return readyCount },
    get selectedLabelIds() { return selectedLabelIds },
    get visibleTasks() { return visibleTasks },
    get filterCounts() { return filterCounts },
    get labelCounts() { return labelCounts },
    get visibleFilterLabels() { return visibleFilterLabels },
    get textFilterQuery() { return textFilterQuery },
    set textFilterQuery(value: string) { textFilterQuery = value },
    setActiveFilter,
    toggleReadyFilter,
    toggleLabelFilter,
  }
}

export type FocusBoardFilterController = ReturnType<typeof createFocusBoardFilterController>
