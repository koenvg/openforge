import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
}))

import {
  COMPLETE_TASK_CONFIRM_MESSAGE,
  DELETE_BACKLOG_TASK_CONFIRM_MESSAGE,
  confirmTerminalTaskAction,
  runCompleteTask,
} from './completeTask'
import { completingTasks, error } from './stores'
import { deleteTask } from './ipc'

beforeEach(() => {
  vi.clearAllMocks()
  completingTasks.set(new Set())
  error.set(null)
})

describe('confirmTerminalTaskAction', () => {
  it('confirms Complete while explaining retained reference data', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    expect(confirmTerminalTaskAction('Complete')).toBe(true)
    expect(confirmSpy).toHaveBeenCalledWith(COMPLETE_TASK_CONFIRM_MESSAGE)
    expect(COMPLETE_TASK_CONFIRM_MESSAGE).toContain('Complete this task?')
    expect(COMPLETE_TASK_CONFIRM_MESSAGE).toContain('runtime workspace state will be removed')
    expect(COMPLETE_TASK_CONFIRM_MESSAGE).toContain('Completed Task will remain available for reference')

    confirmSpy.mockRestore()
  })

  it('confirms Delete while explaining permanent removal', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    expect(confirmTerminalTaskAction('Delete')).toBe(true)
    expect(confirmSpy).toHaveBeenCalledWith(DELETE_BACKLOG_TASK_CONFIRM_MESSAGE)
    expect(DELETE_BACKLOG_TASK_CONFIRM_MESSAGE).toContain('Delete this task from the backlog?')
    expect(DELETE_BACKLOG_TASK_CONFIRM_MESSAGE).toContain('permanently deleted')
    expect(DELETE_BACKLOG_TASK_CONFIRM_MESSAGE).toContain('will not remain available for reference')

    confirmSpy.mockRestore()
  })
})

describe('runCompleteTask', () => {
  it('marks the task as completing while deleteTask is pending and clears it on success', async () => {
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )

    const pending = runCompleteTask('T-1')

    expect(get(completingTasks).has('T-1')).toBe(true)
    expect(deleteTask).toHaveBeenCalledWith('T-1')

    resolveDelete()
    await expect(pending).resolves.toBe(true)
    expect(get(completingTasks).has('T-1')).toBe(false)
  })

  it('ignores a duplicate complete while the task is already completing', async () => {
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )

    const first = runCompleteTask('T-1')
    const second = await runCompleteTask('T-1')

    expect(second).toBe(false)
    expect(deleteTask).toHaveBeenCalledTimes(1)

    resolveDelete()
    await expect(first).resolves.toBe(true)
  })

  it('completes different tasks independently', async () => {
    vi.mocked(deleteTask).mockResolvedValue(undefined)

    await expect(runCompleteTask('T-1')).resolves.toBe(true)
    await expect(runCompleteTask('T-2')).resolves.toBe(true)

    expect(deleteTask).toHaveBeenCalledTimes(2)
  })

  it('surfaces failures to the error store and clears the completing state', async () => {
    vi.mocked(deleteTask).mockRejectedValue(new Error('cleanup exploded'))

    await expect(runCompleteTask('T-1')).resolves.toBe(false)

    expect(get(error)).toContain('cleanup exploded')
    expect(get(completingTasks).has('T-1')).toBe(false)
  })
})
