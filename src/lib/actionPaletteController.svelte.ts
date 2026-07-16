import { confirmCompleteTask, isTaskCompleting } from './completeTask'
import type { Task } from './types'
import type { TaskActionRunner } from './taskActionRunner'

interface ActionPaletteControllerOptions {
  getSelectedTask(): Task | null
  taskActions: TaskActionRunner
  goBack(): void
  showSearchTasks(): void
  showNewTask(): void
  showProjectSwitcher(): void
  triggerGithubSync(): Promise<void>
}

export function useActionPaletteController(options: ActionPaletteControllerOptions) {
  let showActionPalette = $state(false)
  let actionPaletteTask = $state<Task | null>(null)

  function closeActionPalette(): void {
    showActionPalette = false
    actionPaletteTask = null
  }

  function openActionPalette(): void {
    if (showActionPalette) {
      closeActionPalette()
      return
    }

    actionPaletteTask = options.getSelectedTask()
    showActionPalette = true
  }

  async function executeAction(actionId: string): Promise<void> {
    const task = actionPaletteTask
    closeActionPalette()

    switch (actionId) {
      case 'start-task':
        if (task) await options.taskActions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })
        break
      case 'delete-task':
        if (task && !isTaskCompleting(task.id) && confirmCompleteTask()) {
          await options.taskActions.deleteTaskAndReload(task.id)
        }
        break
      case 'merge-pr':
        if (task) {
          await options.taskActions.mergeReadyPullRequest(task)
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
    closeActionPalette,
    openActionPalette,
    executeAction,
  }
}

export type ActionPaletteController = ReturnType<typeof useActionPaletteController>
