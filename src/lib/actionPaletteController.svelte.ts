import { confirmTerminalTaskAction, isTaskCompleting } from './completeTask'
import type { PullRequestMergeMethod, TaskDetail } from './types'
import type { TaskActionRunner } from './taskActionRunner'

interface ActionPaletteControllerOptions {
  getSelectedTask(): TaskDetail | null
  taskActions: TaskActionRunner
  goBack(): void
  showSearchTasks(): void
  showNewTask(): void
  showProjectSwitcher(): void
  triggerGithubSync(): Promise<void>
  runApp?: {
    capture(task: TaskDetail): (() => Promise<void>) | null
  }
}

export function useActionPaletteController(options: ActionPaletteControllerOptions) {
  let showActionPalette = $state(false)
  let actionPaletteTask = $state<TaskDetail | null>(null)
  let actionPaletteRunApp = $state<(() => Promise<void>) | null>(null)

  function closeActionPalette(): void {
    showActionPalette = false
    actionPaletteTask = null
    actionPaletteRunApp = null
  }

  function openActionPalette(): void {
    if (showActionPalette) {
      closeActionPalette()
      return
    }

    actionPaletteTask = options.getSelectedTask()
    actionPaletteRunApp = actionPaletteTask !== null ? (options.runApp?.capture(actionPaletteTask) ?? null) : null

    showActionPalette = true
  }

  async function executeAction(
    actionId: string,
    mergeMethod?: PullRequestMergeMethod,
  ): Promise<void> {
    const task = actionPaletteTask
    const runApp = actionPaletteRunApp
    closeActionPalette()

    if (task && mergeMethod !== undefined) {
      await options.taskActions.mergeReadyPullRequest(task, mergeMethod)
      return
    }

    switch (actionId) {
      case 'run-app':
        await runApp?.()
        break
      case 'start-task':
        if (task) await options.taskActions.handleRunAction({ taskId: task.id, actionPrompt: '' })
        break
      case 'delete-task':
        if (task && !isTaskCompleting(task.id) && confirmTerminalTaskAction('Delete')) {
          await options.taskActions.deleteTaskAndReload(task.id)
        }
        break
      case 'complete-task':
        if (task && !isTaskCompleting(task.id) && confirmTerminalTaskAction('Complete')) {
          await options.taskActions.deleteTaskAndReload(task.id)
        }
        break
      case 'enqueue-pr':
        if (task) {
          await options.taskActions.enqueueReadyPullRequest(task)
        }
        break
      case 'set-aside-task':
        if (task) {
          await options.taskActions.setTaskOutOfFocus(task.id, true)
        }
        break
      case 'return-to-board':
        if (task) {
          await options.taskActions.setTaskOutOfFocus(task.id, false)
        }
        break
      case 'go-back':
        options.goBack()
        break
      case 'search-tasks':
        options.showSearchTasks()
        break
      case 'new-task':
        options.showNewTask()
        break
      case 'switch-project':
        options.showProjectSwitcher()
        break
      case 'refresh-github':
        void options.triggerGithubSync()
        break
    }
  }

  return {
    get showActionPalette() {
      return showActionPalette
    },
    get actionPaletteTask() {
      return actionPaletteTask
    },
    get actionPaletteCanRunApp() {
      return actionPaletteRunApp !== null
    },
    closeActionPalette,
    openActionPalette,
    executeAction,
  }
}

export type ActionPaletteController = ReturnType<typeof useActionPaletteController>
