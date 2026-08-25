import { fromStore, type Writable } from 'svelte/store'
import {
  createOutOfFocusTaskMembershipState,
  outOfFocusTaskMembership,
  type OutOfFocusTaskMembershipState,
} from '../../lib/outOfFocusTaskMembership'

export interface OutOfFocusControllerOptions {
  membership?: OutOfFocusTaskMembershipState
  taskIdsByProject?: Writable<Map<string, Set<string>>>
  loadTaskIds?: (projectId: string) => Promise<Set<string>>
  saveTaskIds?: (projectId: string, taskIds: Set<string>) => Promise<void>
  onProjectAttentionChanged?: () => void | Promise<void>
}

export interface OutOfFocusController {
  readonly taskIds: ReadonlySet<string>
  isReadyFor(projectId: string | null): boolean
  selectProject(projectId: string | null): void
  setAside(taskId: string): Promise<void>
  returnToBoard(taskId: string): Promise<void>
}

export function createOutOfFocusController(
  options: OutOfFocusControllerOptions = {},
): OutOfFocusController {
  const hasCustomMembershipDependencies = options.taskIdsByProject !== undefined
    || options.loadTaskIds !== undefined
    || options.saveTaskIds !== undefined
  const membership = options.membership ?? (
    hasCustomMembershipDependencies
      ? createOutOfFocusTaskMembershipState({
          taskIdsByProject: options.taskIdsByProject,
          loadTaskIds: options.loadTaskIds,
          saveTaskIds: options.saveTaskIds,
        })
      : outOfFocusTaskMembership
  )
  const taskIdsByProjectState = fromStore(membership.taskIdsByProject)

  let activeProjectId = $state<string | null>(null)
  let loadedProjectId = $state<string | null>(null)
  let loadGeneration = 0

  function selectProject(projectId: string | null): void {
    activeProjectId = projectId
    loadedProjectId = null
    const generation = ++loadGeneration
    if (!projectId) return

    void membership.synchronizeProject(projectId, () => generation === loadGeneration)
      .then((finishedCurrentSelection) => {
        if (finishedCurrentSelection && generation === loadGeneration) {
          loadedProjectId = projectId
        }
      })
  }

  async function updateTaskMembership(taskId: string, shouldBeOutOfFocus: boolean): Promise<void> {
    if (!activeProjectId) return

    await membership.updateTaskMembership({
      projectId: activeProjectId,
      taskId,
      shouldBeOutOfFocus,
      onProjectAttentionChanged: options.onProjectAttentionChanged,
    })
  }

  async function setAside(taskId: string): Promise<void> {
    await updateTaskMembership(taskId, true)
  }

  async function returnToBoard(taskId: string): Promise<void> {
    await updateTaskMembership(taskId, false)
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
