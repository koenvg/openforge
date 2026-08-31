import { onMount, untrack } from 'svelte'
import { get } from 'svelte/store'
import type { BoardFilter } from '../../lib/boardFilters'
import { getHTMLElementAt } from '../../lib/domUtils'
import { lastViewedTaskId } from '../../lib/stores'
import type { TaskDetail } from '../../lib/types'
import { useVimNavigation } from '../../lib/useVimNavigation.svelte'

export interface FocusBoardInteractionControllerOptions {
  getProjectId: () => string | null
  getVisibleTasks: () => TaskDetail[]
  setActiveFilter: (filter: BoardFilter) => void
  onOpenTask: (taskId: string) => void | Promise<void>
  onRunAction: (data: { taskId: string; actionPrompt: string; promptPrefix?: string | null }) => void
}

export interface FocusBoardContextMenuState {
  visible: boolean
  x: number
  y: number
  taskId: string
}

export function createFocusBoardInteractionController(options: FocusBoardInteractionControllerOptions) {
  let selectedTaskId = $state<string | null>(null)
  let recentlyViewedTaskId = $state<string | null>(get(lastViewedTaskId))
  let restoredRecentlyViewedTask = $state(false)
  let paneHasFocus = $state(false)
  let contextMenu = $state<FocusBoardContextMenuState>({ visible: false, x: 0, y: 0, taskId: '' })
  let previousProjectId: string | null | undefined

  const visibleTaskCount = $derived(options.getVisibleTasks().length)
  const selectedTask = $derived.by(() => {
    if (!selectedTaskId) return null
    return options.getVisibleTasks().find((task) => task.id === selectedTaskId) ?? null
  })

  const vim = useVimNavigation({
    getItemCount: () => visibleTaskCount,
    onSelect: (index) => {
      const task = options.getVisibleTasks()[index]
      if (task) void options.onOpenTask(task.id)
    },
    onBack: () => {
      selectedTaskId = null
    },
    onAction: (index) => {
      const task = options.getVisibleTasks()[index]
      if (task) options.onRunAction({ taskId: task.id, actionPrompt: '' })
    },
  })

  function resetToFirstTask(): void {
    selectedTaskId = null
    vim.setFocusedIndex(0)
  }

  function activateFilter(filter: BoardFilter): void {
    options.setActiveFilter(filter)
    resetToFirstTask()
  }

  function handleBoardKeydown(event: KeyboardEvent): void {
    if (event.metaKey && !event.shiftKey && !event.altKey) {
      const filterMap: Record<string, BoardFilter> = {
        '1': 'focus',
        '2': 'in-flight',
        '3': 'out-of-focus',
        '4': 'backlog',
      }
      const filter = filterMap[event.key]
      if (filter) {
        event.preventDefault()
        activateFilter(filter)
        return
      }
    }

    if (!paneHasFocus) vim.handleKeydown(event)
  }

  function selectTask(task: TaskDetail, taskIndex: number): void {
    if (selectedTaskId === task.id) {
      void options.onOpenTask(task.id)
      return
    }
    selectedTaskId = task.id
    vim.setFocusedIndex(taskIndex)
  }

  function openContextMenu(event: MouseEvent, taskId: string): void {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }

  function closeContextMenu(): void {
    contextMenu = { ...contextMenu, visible: false }
  }

  onMount(() => {
    if (recentlyViewedTaskId) {
      const index = options.getVisibleTasks().findIndex((task) => task.id === recentlyViewedTaskId)
      if (index >= 0) {
        vim.setFocusedIndex(index)
        restoredRecentlyViewedTask = true
      }
    }
    if (get(lastViewedTaskId) !== null) lastViewedTaskId.set(null)
  })

  $effect(() => {
    const currentProjectId = options.getProjectId()
    if (previousProjectId !== undefined && currentProjectId !== previousProjectId) {
      selectedTaskId = null
    }
    previousProjectId = currentProjectId
  })

  $effect(() => {
    if (selectedTaskId && !options.getVisibleTasks().some((task) => task.id === selectedTaskId)) {
      selectedTaskId = null
    }
  })

  $effect(() => {
    if (restoredRecentlyViewedTask || !recentlyViewedTaskId) return
    const index = options.getVisibleTasks().findIndex((task) => task.id === recentlyViewedTaskId)
    if (index >= 0) {
      vim.setFocusedIndex(index)
      restoredRecentlyViewedTask = true
    }
  })

  $effect(() => {
    const count = visibleTaskCount
    if (count > 0 && vim.focusedIndex >= count) vim.setFocusedIndex(count - 1)
  })

  $effect(() => {
    const index = vim.focusedIndex
    untrack(() => {
      const items = document.querySelectorAll('[data-vim-item]')
      getHTMLElementAt(items, index)?.scrollIntoView?.({ block: 'nearest' })
    })
  })

  $effect(() => {
    const task = options.getVisibleTasks()[vim.focusedIndex]
    if (task) selectedTaskId = task.id
  })

  return {
    get selectedTaskId() { return selectedTaskId },
    get selectedTask() { return selectedTask },
    get recentlyViewedTaskId() { return recentlyViewedTaskId },
    get focusedIndex() { return vim.focusedIndex },
    get contextMenu() { return contextMenu },
    activateFilter,
    resetToFirstTask,
    handleBoardKeydown,
    selectTask,
    openContextMenu,
    closeContextMenu,
    setPaneHasFocus(value: boolean) { paneHasFocus = value },
  }
}

export type FocusBoardInteractionController = ReturnType<typeof createFocusBoardInteractionController>
