import { describe, expect, it, vi } from 'vitest'
import type { Task } from './types'
import { useAppTaskCreationController } from './appTaskCreationController.svelte'

const backlogTask = {
  id: 'T-1',
  status: 'backlog',
} as Task

describe('App task creation controller', () => {
  it('opens create and editable backlog task dialogs through one interface', () => {
    const controller = useAppTaskCreationController({
      getTasks: () => [backlogTask],
      loadTasks: vi.fn(),
      resetToBoard: vi.fn(),
      navigateToTask: vi.fn(),
      runAction: vi.fn(),
      settleCompose: vi.fn(),
    })

    controller.openNewTask()

    expect(controller.dialog).toEqual({ mode: 'create', task: null })

    controller.openEditTask(backlogTask.id)

    expect(controller.dialog).toEqual({ mode: 'edit', task: backlogTask })

    controller.closeTaskDialog()

    expect(controller.dialog).toBeNull()
  })

  it('shows a started task before waiting for its agent run to finish', async () => {
    const calls: string[] = []
    let finishRun: () => void = () => {}
    const runPromise = new Promise<void>((resolve) => {
      finishRun = resolve
    })
    const controller = useAppTaskCreationController({
      getTasks: () => [backlogTask],
      loadTasks: vi.fn(async () => { calls.push('load') }),
      resetToBoard: vi.fn(() => { calls.push('board') }),
      navigateToTask: vi.fn(() => { calls.push('navigate') }),
      runAction: vi.fn(async () => {
        calls.push('run')
        await runPromise
      }),
      settleCompose: vi.fn(),
    })

    const starting = controller.runTask(backlogTask.id, 'Start now')
    await vi.waitFor(() => expect(calls).toEqual(['load', 'board', 'navigate', 'run']))

    finishRun()
    await starting
  })

  it('settles compose requests only after refreshed task data is available', async () => {
    const calls: string[] = []
    const settleCompose = vi.fn(() => { calls.push('settle') })
    const controller = useAppTaskCreationController({
      getTasks: () => [backlogTask],
      loadTasks: vi.fn(async () => { calls.push('load') }),
      resetToBoard: vi.fn(),
      navigateToTask: vi.fn(),
      runAction: vi.fn(),
      settleCompose,
    })

    await controller.saveComposedTask(backlogTask, { started: true })

    expect(calls).toEqual(['load', 'settle'])
    expect(settleCompose).toHaveBeenCalledWith({ task: backlogTask, started: true })

    controller.cancelCompose()

    expect(settleCompose).toHaveBeenLastCalledWith(null)
  })
})
