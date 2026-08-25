import { error } from './stores'
import {
  outOfFocusTaskMembership,
  type OutOfFocusTaskMembershipState,
} from './outOfFocusTaskMembership'
import { createPullRequestActions } from './pullRequestActions'
import { createTaskSessionActions } from './taskSessionActions'
import type { Project } from './types'

export type { RunActionData } from './taskSessionActions'

interface TaskActionRunnerOptions {
  getActiveProject(): Project | null
  loadTasks(): Promise<void>
  loadProjectAttention?: () => Promise<void>
  outOfFocusMembership?: OutOfFocusTaskMembershipState
  logError?: (message: string, error: unknown) => void
}

function defaultLogError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
}

export function createTaskActionRunner(options: TaskActionRunnerOptions) {
  const logError = options.logError ?? defaultLogError
  const taskSessionActions = createTaskSessionActions({
    getActiveProject: options.getActiveProject,
    loadTasks: options.loadTasks,
    logError,
  })
  const pullRequestActions = createPullRequestActions({ logError })
  const outOfFocusMembership = options.outOfFocusMembership ?? outOfFocusTaskMembership

  async function setTaskOutOfFocus(taskId: string, shouldBeOutOfFocus: boolean): Promise<void> {
    const activeProject = options.getActiveProject()
    if (!activeProject) {
      error.set('No active project selected')
      return
    }

    await outOfFocusMembership.updateTaskMembership({
      projectId: activeProject.id,
      taskId,
      shouldBeOutOfFocus,
      onProjectAttentionChanged: options.loadProjectAttention,
      reportError: (message, errorValue) => {
        logError(message, errorValue)
        error.set(String(errorValue))
      },
    })
  }

  return {
    ...taskSessionActions,
    setTaskOutOfFocus,
    ...pullRequestActions,
  }
}

export type TaskActionRunner = ReturnType<typeof createTaskActionRunner>
