import { updateTaskStatus } from './ipc'
import { error } from './stores'

/**
 * Reopen a completed task by moving it back to active work ('doing').
 *
 * A done task is never returned to the backlog — reopening always means the
 * task is being worked on again, so it reappears in the Focus lane. Clearing
 * any stale Low-Fire membership is the caller's responsibility (the board owns
 * that per-project state).
 */
export async function reopenTask(taskId: string): Promise<void> {
  try {
    await updateTaskStatus(taskId, 'doing')
  } catch (e) {
    console.error('Failed to reopen task:', e)
    error.set('Failed to reopen task.')
  }
}
