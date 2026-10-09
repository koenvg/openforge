import { get } from 'svelte/store'
import { completeConfirmedTask, runCompleteTask } from './completeTask'
import { getSessionStatus, startImplementation } from './ipc'
import { writePtyWithSubmit } from './ptySubmit'
import {
  activeSessions,
  error,
  startingTasks,
  taskStartErrors,
  taskDetailsById,
  taskRuntimeInfo,
  tasks,
} from './stores'
import { agentTerminalSessions } from './terminalSessionService'
import { resolveBranchStart } from './branchStart'
import type { DivergenceResolution, Project } from './types'

export interface RunActionData {
  taskId: string
  actionPrompt: string
  /**
   * A one-off prefix for this start only. It is never written back to the task.
   * A live PTY ignores the prefix because that path writes to a running agent.
   */
  promptPrefix?: string | null
}

export interface TaskSessionActionOptions {
  getActiveProject(): Project | null
  loadTasks(): Promise<void>
  logError(message: string, error: unknown): void
}

function setError(errorValue: unknown): void {
  error.set(String(errorValue))
}

function clearStartError(taskId: string): void {
  taskStartErrors.update(errors => {
    const next = new Map(errors)
    next.delete(taskId)
    return next
  })
}

export function createTaskSessionActions(options: TaskSessionActionOptions) {
  async function runAction(data: RunActionData): Promise<{ error: unknown } | undefined> {
    const { taskId, actionPrompt, promptPrefix = null } = data

    if (agentTerminalSessions.isPtyActive(taskId)) {
      clearStartError(taskId)
      try {
        if (actionPrompt.trim()) await writePtyWithSubmit(taskId, actionPrompt)
        agentTerminalSessions.focusTerminal(taskId)
      } catch (errorValue) {
        options.logError('[session] Failed to write action to PTY:', errorValue)
        setError(errorValue)
        return { error: errorValue }
      }
      return
    }
    if (get(startingTasks).has(taskId)) return
    if (!actionPrompt.trim() && get(activeSessions).get(taskId)?.status === 'running') {
      clearStartError(taskId)
      return
    }

    startingTasks.update(starting => new Set(starting).add(taskId))
    clearStartError(taskId)
    let releaseTerminalOnStartFailure = false
    try {
      const activeProject = options.getActiveProject()
      if (!activeProject) throw new Error('No active project selected')
      const task = get(taskDetailsById).get(taskId) ?? get(tasks).find(candidate => candidate.id === taskId)
      let resolution: DivergenceResolution | undefined
      if (task) {
        const outcome = await resolveBranchStart(task, activeProject.path)
        if (!outcome.start) throw new Error('Task start was canceled.')
        resolution = outcome.resolution
      }

      let terminalImageProtocol = null
      try {
        const terminalAlreadyExists = agentTerminalSessions.hasTerminal(taskId)
        const terminalEntry = await agentTerminalSessions.acquire(taskId)
        releaseTerminalOnStartFailure = !terminalAlreadyExists
        const spawnLease = agentTerminalSessions.beginPtySpawn(terminalEntry)
        terminalImageProtocol = spawnLease?.imageProtocol ?? null
        spawnLease?.cancel()
      } catch (terminalError) {
        console.warn('[session] Inline terminal images unavailable; starting with text fallbacks:', terminalError)
      }
      const result = await startImplementation(
        taskId,
        activeProject.path,
        resolution ?? null,
        terminalImageProtocol,
        promptPrefix,
      )
      releaseTerminalOnStartFailure = false
      const updatedRuntimeInfo = new Map(get(taskRuntimeInfo))
      updatedRuntimeInfo.set(taskId, { workspacePath: result.workspace_path })
      taskRuntimeInfo.set(updatedRuntimeInfo)

      try {
        const session = await getSessionStatus(result.session_id)
        const updated = new Map(get(activeSessions))
        updated.set(taskId, session)
        activeSessions.set(updated)
      } catch (sessionError) {
        options.logError('[session] Failed to fetch session after start:', sessionError)
      }

      try {
        await options.loadTasks()
        agentTerminalSessions.focusTerminal(taskId)
      } catch (refreshError) {
        // Startup succeeded. A refresh or presentation failure must not offer a second start.
        options.logError('[session] Failed to refresh task after start:', refreshError)
        setError(refreshError)
      }
    } catch (errorValue) {
      if (releaseTerminalOnStartFailure) agentTerminalSessions.release(taskId)
      options.logError('[session] Failed to start task:', errorValue)
      setError(errorValue)
      taskStartErrors.update(errors => new Map(errors).set(taskId, String(errorValue)))
      return { error: errorValue }
    } finally {
      startingTasks.update(starting => {
        const next = new Set(starting)
        next.delete(taskId)
        return next
      })
    }
  }

  async function handleRunAction(data: RunActionData): Promise<void> {
    await runAction(data)
  }

  /** For callers that need the start outcome in addition to task-page feedback. */
  async function runActionOrThrow(data: RunActionData): Promise<void> {
    const failure = await runAction(data)
    if (failure) throw failure.error
  }

  async function deleteTaskAndReload(taskId: string): Promise<void> {
    if (await runCompleteTask(taskId)) await options.loadTasks()
  }

  async function completeTaskAndReload(taskId: string): Promise<void> {
    if (await completeConfirmedTask(taskId)) await options.loadTasks()
  }

  return { handleRunAction, runActionOrThrow, deleteTaskAndReload, completeTaskAndReload }
}
