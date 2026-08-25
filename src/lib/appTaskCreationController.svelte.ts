import type { Task } from './types'
import type { RunActionData } from './taskActionRunner'
import type { ComposeTaskResult } from '@openforge-app/plugin-sdk'
import { settleTaskCompose } from './taskCompose'

interface AppTaskCreationControllerOptions {
  getTasks(): Task[]
  loadTasks(): Promise<void>
  resetToBoard(): void
  navigateToTask(taskId: string): void
  runAction(data: RunActionData): Promise<void>
  settleCompose?(result: ComposeTaskResult | null): void
}

export function useAppTaskCreationController(options: AppTaskCreationControllerOptions) {
  let dialog = $state<{ mode: 'create' | 'edit'; task: Task | null } | null>(null)
  const settleCompose = options.settleCompose ?? settleTaskCompose

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

  async function navigateAndRun(data: RunActionData): Promise<void> {
    options.resetToBoard()
    options.navigateToTask(data.taskId)
    await options.runAction(data)
  }

  async function runTask(taskId: string, actionPrompt: string): Promise<void> {
    await options.loadTasks()
    await navigateAndRun({ taskId, actionPrompt })
  }

  async function taskSaved(): Promise<void> {
    await options.loadTasks()
  }

  function cancelCompose(): void {
    settleCompose(null)
  }

  async function saveComposedTask(task?: Task, saveOptions?: { started: boolean }): Promise<void> {
    await options.loadTasks()
    if (task) {
      settleCompose({ task, started: saveOptions?.started ?? false })
    }
  }

  async function runComposedTask(taskId: string, actionPrompt: string): Promise<void> {
    await navigateAndRun({ taskId, actionPrompt })
  }

  return {
    get dialog() {
      return dialog
    },
    openNewTask,
    openEditTask,
    closeTaskDialog,
    runTask,
    taskSaved,
    cancelCompose,
    saveComposedTask,
    runComposedTask,
  }
}

export type AppTaskCreationController = ReturnType<typeof useAppTaskCreationController>
