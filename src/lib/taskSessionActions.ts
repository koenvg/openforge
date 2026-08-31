import { get } from 'svelte/store'
import { runCompleteTask } from './completeTask'
import { getSessionStatus, startImplementation } from './ipc'
import { writePtyWithSubmit } from './ptySubmit'
import {
  activeSessions,
  error,
  startingTasks,
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

export function createTaskSessionActions(options: TaskSessionActionOptions) {
  async function handleRunAction(data: RunActionData): Promise<void> {
    const activeProject = options.getActiveProject()
    if (!activeProject) {
      error.set('No active project selected')
      return
    }

    const { taskId, actionPrompt, promptPrefix = null } = data

    if (agentTerminalSessions.isPtyActive(taskId)) {
      try {
        await writePtyWithSubmit(taskId, actionPrompt)
        agentTerminalSessions.focusTerminal(taskId)
      } catch (errorValue) {
        options.logError('[session] Failed to write action to PTY:', errorValue)
        setError(errorValue)
      }
      return
    }

    let resolution: DivergenceResolution | undefined
    try {
      const task = get(tasks).find((candidate) => candidate.id === taskId)
      if (task) {
        const outcome = await resolveBranchStart(task, activeProject.path)
        if (!outcome.start) {
          return
        }
        resolution = outcome.resolution
      }
    } catch (errorValue) {
      options.logError('[session] Failed to inspect existing branch before start:', errorValue)
      setError(errorValue)
      return
    }

    const starting = new Set(get(startingTasks))
    starting.add(taskId)
    startingTasks.set(starting)

    let releaseTerminalOnStartFailure = false
    try {
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
      updatedRuntimeInfo.set(taskId, {
        workspacePath: result.workspace_path,
      })
      taskRuntimeInfo.set(updatedRuntimeInfo)

      try {
        const session = await getSessionStatus(result.session_id)
        const updated = new Map(get(activeSessions))
        updated.set(taskId, session)
        activeSessions.set(updated)
      } catch (sessionError) {
        options.logError('[session] Failed to fetch session after start:', sessionError)
      }

      await options.loadTasks()
      agentTerminalSessions.focusTerminal(taskId)
    } catch (errorValue) {
      if (releaseTerminalOnStartFailure) agentTerminalSessions.release(taskId)
      options.logError('[session] Failed to start task:', errorValue)
      setError(errorValue)
    } finally {
      const next = new Set(get(startingTasks))
      next.delete(taskId)
      startingTasks.set(next)
    }
  }

  async function deleteTaskAndReload(taskId: string): Promise<void> {
    if (await runCompleteTask(taskId)) {
      await options.loadTasks()
    }
  }

  return {
    handleRunAction,
    deleteTaskAndReload,
  }
}
