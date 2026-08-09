import { get } from 'svelte/store'
import { deleteTask } from './ipc'
import { completingTasks, error } from './stores'

// Started Tasks use "Complete" while backlog Tasks use "Delete". Both terminal
// actions share the completion lifecycle: runtime workspace state is removed while
// the Completed Task remains available as reference data (there is no reopen flow).
// Because runtime cleanup is destructive, every terminal action must confirm first.
export const COMPLETE_TASK_CONFIRM_MESSAGE =
  'Complete this task? Its runtime workspace state will be removed — this cannot be undone. The Completed Task will remain available for reference.'

export const DELETE_BACKLOG_TASK_CONFIRM_MESSAGE =
  'Delete this task from the backlog? Any runtime workspace state will be removed — this cannot be undone. The Task will remain available as a completed reference.'

/** Prompt the user to confirm destructive runtime cleanup for the displayed action. */
export function confirmTerminalTaskAction(action: 'Complete' | 'Delete'): boolean {
  const message = action === 'Delete'
    ? DELETE_BACKLOG_TASK_CONFIRM_MESSAGE
    : COMPLETE_TASK_CONFIRM_MESSAGE
  return window.confirm(message)
}

/** Whether completion is already in flight for the Task. */
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
 * Complete an already-confirmed Task, tracking it in `completingTasks` so every
 * Complete affordance can show pending state and refuse duplicate requests.
 * Returns whether completion succeeded; failures land in the shared `error`
 * store. Confirmation stays with the caller so a cancelled prompt can keep its
 * surrounding UI (e.g. an open context menu) intact.
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
