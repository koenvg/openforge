import { get } from 'svelte/store'
import {
  activeSessions,
  error,
  outOfFocusTaskIdsByProject,
  startingTasks,
  taskRuntimeInfo,
  tasks,
  ticketPrs,
  setTaskMerging,
} from './stores'
import {
  enqueuePullRequest,
  getSessionStatus,
  mergePullRequest,
  startImplementation,
} from './ipc'
import { runCompleteTask } from './completeTask'
import { loadOutOfFocusTaskIds, saveOutOfFocusTaskIds } from './boardFilters'
import { writePtyWithSubmit } from './ptySubmit'
import { acquire, focusTerminal, getTerminalImageProtocol, hasTerminal, isPtyActive, release } from './terminalPool'
import { resolveBranchStart } from './branchStart'
import { getMergeReadiness } from './types'
import type { DivergenceResolution, Project, Task } from './types'

export interface RunActionData {
  taskId: string
  actionPrompt: string
  agent: string | null
}

interface TaskActionRunnerOptions {
  getActiveProject(): Project | null
  loadTasks(): Promise<void>
  loadProjectAttention?: () => Promise<void>
  triggerGithubSync(): Promise<void>
  logError?: (message: string, error: unknown) => void
}

function defaultLogError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
}

function setError(errorValue: unknown): void {
  error.set(String(errorValue))
}

export function createTaskActionRunner(options: TaskActionRunnerOptions) {
  const logError = options.logError ?? defaultLogError

  async function handleRunAction(data: RunActionData): Promise<void> {
    const activeProject = options.getActiveProject()
    if (!activeProject) {
      error.set('No active project selected')
      return
    }

    const { taskId, actionPrompt } = data

    if (isPtyActive(taskId)) {
      try {
        await writePtyWithSubmit(taskId, actionPrompt)
        focusTerminal(taskId)
      } catch (e) {
        logError('[session] Failed to write action to PTY:', e)
        setError(e)
      }
      return
    }

    // Start gate: for existing-branch tasks, pre-flight the branch and — when it
    // has diverged — prompt the user before creating the worktree. Runs before
    // the starting spinner so an awaiting modal does not leave a stuck spinner.
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
    } catch (e) {
      logError('[session] Failed to inspect existing branch before start:', e)
      setError(e)
      return
    }

    const starting = new Set(get(startingTasks))
    starting.add(taskId)
    startingTasks.set(starting)

    let releaseTerminalOnStartFailure = false
    try {
      let terminalImageProtocol = null
      try {
        const terminalAlreadyExists = hasTerminal(taskId)
        const terminalEntry = await acquire(taskId)
        releaseTerminalOnStartFailure = !terminalAlreadyExists
        terminalImageProtocol = getTerminalImageProtocol(terminalEntry)
      } catch (terminalError) {
        console.warn('[session] Inline terminal images unavailable; starting with text fallbacks:', terminalError)
      }
      const result = terminalImageProtocol
        ? await startImplementation(taskId, activeProject.path, resolution ?? null, terminalImageProtocol)
        : await startImplementation(taskId, activeProject.path, resolution ?? null)
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
      } catch (sessionErr) {
        logError('[session] Failed to fetch session after start:', sessionErr)
      }

      await options.loadTasks()
      focusTerminal(taskId)
    } catch (e) {
      if (releaseTerminalOnStartFailure) release(taskId)
      logError('[session] Failed to start task:', e)
      setError(e)
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

  async function setTaskOutOfFocus(taskId: string, shouldBeOutOfFocus: boolean): Promise<void> {
    const activeProject = options.getActiveProject()
    if (!activeProject) {
      error.set('No active project selected')
      return
    }

    try {
      const storedTaskIds = await loadOutOfFocusTaskIds(activeProject.id)
      const currentTaskIds = get(outOfFocusTaskIdsByProject).get(activeProject.id)
      const nextTaskIds = new Set(currentTaskIds ?? storedTaskIds)

      if (shouldBeOutOfFocus) {
        nextTaskIds.add(taskId)
      } else {
        nextTaskIds.delete(taskId)
      }

      const nextByProject = new Map(get(outOfFocusTaskIdsByProject))
      if (nextTaskIds.size > 0) {
        nextByProject.set(activeProject.id, nextTaskIds)
      } else {
        nextByProject.delete(activeProject.id)
      }
      outOfFocusTaskIdsByProject.set(nextByProject)

      await saveOutOfFocusTaskIds(activeProject.id, nextTaskIds)
      await options.loadProjectAttention?.()
    } catch (e) {
      logError('Failed to update Out of Focus tasks:', e)
      setError(e)
    }
  }

  async function mergeReadyPullRequest(task: Task): Promise<void> {
    const prs = get(ticketPrs).get(task.id) || []
    const readyPrs = prs.filter((pr) => {
      const readiness = getMergeReadiness(pr)
      return readiness.status === 'ready_to_merge' && readiness.action === 'merge'
    })

    if (readyPrs.length === 1) {
      const pr = readyPrs[0]
      try {
        setTaskMerging(task.id, true)
        await mergePullRequest(task.id, pr.id, pr.head_sha)
        const nextMap = new Map(get(ticketPrs))
        const taskPrs = nextMap.get(task.id) || []
        nextMap.set(task.id, taskPrs.map(p =>
          p.id === pr.id ? { ...p, state: 'merged', merged_at: Math.floor(Date.now() / 1000) } : p,
        ))
        ticketPrs.set(nextMap)
      } catch (e) {
        logError('Failed to merge PR:', e)
        setError(e)
      } finally {
        setTaskMerging(task.id, false)
      }
    } else if (readyPrs.length > 1) {
      error.set('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
    }
  }
  async function enqueueReadyPullRequest(task: Task): Promise<void> {
    const prs = get(ticketPrs).get(task.id) || []
    const readyPrs = prs.filter((pr) => {
      const readiness = getMergeReadiness(pr)
      return readiness.status === 'ready_to_enqueue' && readiness.action === 'enqueue'
    })

    if (readyPrs.length === 1) {
      const pr = readyPrs[0]
      try {
        setTaskMerging(task.id, true)
        await enqueuePullRequest(task.id, pr.id, pr.head_sha)
        const nextMap = new Map(get(ticketPrs))
        const taskPrs = nextMap.get(task.id) || []
        nextMap.set(task.id, taskPrs.map(p =>
          p.id === pr.id
            ? {
                ...p,
                is_queued: true,
                merge_readiness_status: 'queued_pull_request',
                merge_readiness_action: 'wait_for_queue',
                merge_queue_state: 'QUEUED',
              }
            : p,
        ))
        ticketPrs.set(nextMap)
      } catch (e) {
        logError('Failed to enqueue PR:', e)
        setError(e)
      } finally {
        setTaskMerging(task.id, false)
      }
    } else if (readyPrs.length > 1) {
      error.set('Multiple pull requests are ready to enqueue. Open the task details to choose the correct PR.')
    }
  }

  return {
    handleRunAction,
    deleteTaskAndReload,
    setTaskOutOfFocus,
    mergeReadyPullRequest,
    enqueueReadyPullRequest,
  }
}

export type TaskActionRunner = ReturnType<typeof createTaskActionRunner>
