import type { TaskDetail } from './types'
import type { RunActionData } from './taskActionRunner'

interface AppTaskCreationControllerOptions {
  getTasks(): TaskDetail[]
  loadTasks(): Promise<void>
  publishTask(task: TaskDetail): void
  /** Opens the task, switching to its project first when it lives in another one. */
  showTask(task: TaskDetail): void | Promise<void>
  runAction(data: RunActionData): Promise<void>
  reportError(error: unknown): void
}

export function useAppTaskCreationController(options: AppTaskCreationControllerOptions) {
  let dialog = $state<{ mode: 'create' | 'edit'; task: TaskDetail | null } | null>(null)

  function openNewTask(): void {
    dialog = { mode: 'create', task: null }
  }

  function openEditTask(taskId: string): void {
    const task = options.getTasks().find((candidate) => candidate.id === taskId)
    if (!task || task.status !== 'backlog') return
    dialog = { mode: 'edit', task }
  }

  function closeTaskDialog(): void {
    dialog = null
  }

  function taskCreated(task: TaskDetail, intent: 'backlog' | 'start'): void {
    options.publishTask(task)
    closeTaskDialog()
    if (intent === 'start') {
      const start = () => options.runAction({ taskId: task.id, actionPrompt: '' }).catch(options.reportError)
      const shown = options.showTask(task)
      // Same-project tasks open synchronously; another project's must finish switching first.
      if (shown instanceof Promise) void shown.then(start, options.reportError)
      else void start()
    }
    void options.loadTasks().catch(options.reportError)
  }

  async function taskSaved(): Promise<void> {
    await options.loadTasks()
  }

  return {
    get dialog() { return dialog },
    openNewTask,
    openEditTask,
    closeTaskDialog,
    taskCreated,
    taskSaved,
  }
}

export type AppTaskCreationController = ReturnType<typeof useAppTaskCreationController>
