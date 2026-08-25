import { fromStore, type Writable } from 'svelte/store'
import { loadOutOfFocusTaskIds, saveOutOfFocusTaskIds } from '../../lib/boardFilters'
import { outOfFocusTaskIdsByProject } from '../../lib/stores'

export interface OutOfFocusControllerOptions {
  taskIdsByProject?: Writable<Map<string, Set<string>>>
  loadTaskIds?: (projectId: string) => Promise<Set<string>>
  saveTaskIds?: (projectId: string, taskIds: Set<string>) => Promise<void>
  onProjectAttentionChanged?: () => void | Promise<void>
}

export interface OutOfFocusController {
  readonly taskIds: ReadonlySet<string>
  isReadyFor(projectId: string | null): boolean
  selectProject(projectId: string | null): void
  setAside(taskId: string): void
  returnToBoard(taskId: string): void
}

export function createOutOfFocusController(
  options: OutOfFocusControllerOptions = {},
): OutOfFocusController {
  const taskIdsByProject = options.taskIdsByProject ?? outOfFocusTaskIdsByProject
  const taskIdsByProjectState = fromStore(taskIdsByProject)
  const loadTaskIds = options.loadTaskIds ?? loadOutOfFocusTaskIds
  const saveTaskIds = options.saveTaskIds ?? saveOutOfFocusTaskIds

  let activeProjectId = $state<string | null>(null)
  let loadedProjectId = $state<string | null>(null)
  let loadGeneration = 0

  function replaceProjectTaskIds(projectId: string, taskIds: Set<string>): void {
    taskIdsByProject.update((current) => {
      const next = new Map(current)
      if (taskIds.size > 0) {
        next.set(projectId, taskIds)
      } else {
        next.delete(projectId)
      }
      return next
    })
  }

  function applyLoadedTaskIds(projectId: string, generation: number, taskIds: Set<string>): void {
    if (generation !== loadGeneration) return
    replaceProjectTaskIds(projectId, taskIds)
    loadedProjectId = projectId
  }

  function selectProject(projectId: string | null): void {
    activeProjectId = projectId
    loadedProjectId = null
    const generation = ++loadGeneration
    if (!projectId) return

    loadTaskIds(projectId)
      .then((taskIds) => applyLoadedTaskIds(projectId, generation, taskIds))
      .catch(() => applyLoadedTaskIds(projectId, generation, new Set()))
  }

  function updateTaskMembership(taskId: string, shouldBeOutOfFocus: boolean): void {
    if (!activeProjectId) return

    const projectId = activeProjectId
    const nextTaskIds = new Set(taskIdsByProjectState.current.get(projectId) ?? new Set<string>())
    if (shouldBeOutOfFocus) {
      nextTaskIds.add(taskId)
    } else {
      nextTaskIds.delete(taskId)
    }
    replaceProjectTaskIds(projectId, nextTaskIds)

    void saveTaskIds(projectId, nextTaskIds)
      .then(() => options.onProjectAttentionChanged?.())
      .catch((error: unknown) => console.error('Failed to save Out of Focus tasks:', error))
  }

  function setAside(taskId: string): void {
    updateTaskMembership(taskId, true)
  }

  function returnToBoard(taskId: string): void {
    updateTaskMembership(taskId, false)
  }

  return {
    get taskIds() {
      if (!activeProjectId) return new Set<string>()
      return taskIdsByProjectState.current.get(activeProjectId) ?? new Set<string>()
    },
    isReadyFor(projectId: string | null) {
      if (projectId === null) return true
      return activeProjectId === projectId && loadedProjectId === projectId
    },
    selectProject,
    setAside,
    returnToBoard,
  }
}
