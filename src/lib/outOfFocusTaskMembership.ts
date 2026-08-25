import type { Writable } from 'svelte/store'
import { loadOutOfFocusTaskIds, saveOutOfFocusTaskIds } from './boardFilters'
import { error, outOfFocusTaskIdsByProject } from './stores'

export interface OutOfFocusTaskMembershipStateOptions {
  taskIdsByProject?: Writable<Map<string, Set<string>>>
  loadTaskIds?: (projectId: string) => Promise<Set<string>>
  saveTaskIds?: (projectId: string, taskIds: Set<string>) => Promise<void>
}

export interface UpdateOutOfFocusTaskMembershipOptions {
  projectId: string
  taskId: string
  shouldBeOutOfFocus: boolean
  onProjectAttentionChanged?: () => void | Promise<void>
  reportError?: (message: string, error: unknown) => void
}

export interface OutOfFocusTaskMembershipState {
  readonly taskIdsByProject: Writable<Map<string, Set<string>>>
  synchronizeProject(projectId: string, isCurrentSelection: () => boolean): Promise<boolean>
  updateTaskMembership(options: UpdateOutOfFocusTaskMembershipOptions): Promise<void>
}

function reportUpdateError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
  error.set(String(errorValue))
}

export function createOutOfFocusTaskMembershipState(
  options: OutOfFocusTaskMembershipStateOptions = {},
): OutOfFocusTaskMembershipState {
  const taskIdsByProject = options.taskIdsByProject ?? outOfFocusTaskIdsByProject
  const loadTaskIds = options.loadTaskIds ?? loadOutOfFocusTaskIds
  const saveTaskIds = options.saveTaskIds ?? saveOutOfFocusTaskIds
  const projectRevisions = new Map<string, number>()
  const mutationQueues = new Map<string, Promise<void>>()

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

  async function synchronizeProject(
    projectId: string,
    isCurrentSelection: () => boolean,
  ): Promise<boolean> {
    const revision = projectRevisions.get(projectId) ?? 0
    let loadedTaskIds: Set<string>
    try {
      loadedTaskIds = await loadTaskIds(projectId)
    } catch {
      loadedTaskIds = new Set()
    }

    if (!isCurrentSelection()) return false
    if ((projectRevisions.get(projectId) ?? 0) === revision) {
      replaceProjectTaskIds(projectId, loadedTaskIds)
    }
    return true
  }

  async function performTaskMembershipUpdate(
    update: UpdateOutOfFocusTaskMembershipOptions,
  ): Promise<void> {
    const reportError = update.reportError ?? reportUpdateError
    try {
      const nextTaskIds = new Set(await loadTaskIds(update.projectId))
      projectRevisions.set(update.projectId, (projectRevisions.get(update.projectId) ?? 0) + 1)
      if (update.shouldBeOutOfFocus) {
        nextTaskIds.add(update.taskId)
      } else {
        nextTaskIds.delete(update.taskId)
      }

      replaceProjectTaskIds(update.projectId, nextTaskIds)
      await saveTaskIds(update.projectId, nextTaskIds)
      await update.onProjectAttentionChanged?.()
    } catch (errorValue) {
      reportError('Failed to update Out of Focus tasks:', errorValue)
    }
  }

  function updateTaskMembership(
    update: UpdateOutOfFocusTaskMembershipOptions,
  ): Promise<void> {

    const previousMutation = mutationQueues.get(update.projectId) ?? Promise.resolve()
    const mutation = previousMutation.then(() => performTaskMembershipUpdate(update))
    mutationQueues.set(update.projectId, mutation)
    void mutation.finally(() => {
      if (mutationQueues.get(update.projectId) === mutation) {
        mutationQueues.delete(update.projectId)
      }
    })
    return mutation
  }

  return {
    taskIdsByProject,
    synchronizeProject,
    updateTaskMembership,
  }
}

export const outOfFocusTaskMembership = createOutOfFocusTaskMembershipState()
