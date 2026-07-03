import { get } from 'svelte/store'
import { deleteTask } from './ipc'
import { completingTasks, error } from './stores'

// "Complete" is the single terminal action for a task: it permanently deletes
// the task along with its worktree and branch (there is no Done/reopen flow).
// Because the label reads as a benign "finish", every Complete affordance must
// confirm first. Centralised here so the wording stays identical everywhere.
export const COMPLETE_TASK_CONFIRM_MESSAGE =
  'Complete this task? Its worktree and branch will be deleted — this cannot be undone.'

/** Prompt the user to confirm the destructive Complete (delete) action. */
export function confirmCompleteTask(): boolean {
  return window.confirm(COMPLETE_TASK_CONFIRM_MESSAGE)
}

/** Whether a Complete (delete) is already in flight for the task. */
export function isTaskCompleting(taskId: string): boolean {
  return get(completingTasks).has(taskId)
}

function setTaskCompleting(taskId: string, completing: boolean): void {
  const next = new Set(get(completingTasks))
  if (completing) {
    next.add(taskId)
  } else {
    next.delete(taskId)
  }
  completingTasks.set(next)
}

/**
 * Delete an already-confirmed task, tracking it in `completingTasks` so every
 * Complete affordance can show pending state and refuse duplicate requests.
 * Returns whether the task was actually deleted; failures land in the shared
 * `error` store. Confirmation stays with the caller so a cancelled prompt can
 * keep its surrounding UI (e.g. an open context menu) intact.
 */
export async function runCompleteTask(taskId: string): Promise<boolean> {
  if (isTaskCompleting(taskId)) {
    return false
  }
  setTaskCompleting(taskId, true)
  try {
    await deleteTask(taskId)
    return true
  } catch (err: unknown) {
    console.error('Failed to complete task:', err)
    error.set(String(err))
    return false
  } finally {
    setTaskCompleting(taskId, false)
  }
}
