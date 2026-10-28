import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
}))

vi.mock('./openAttentionOnSessionSubmit', () => ({
  notifyTaskCompleted: vi.fn(),
}))

import {
  completeConfirmedTask,
  confirmTerminalTaskAction,
  runCompleteTask,
} from './completeTask'
import { notifyTaskCompleted } from './openAttentionOnSessionSubmit'
import { completingTasks, error } from './stores'
import { deleteTask } from './ipc'
import { resolveTerminalTaskConfirmation, terminalTaskConfirmationRequest } from './terminalTaskConfirmation'

beforeEach(() => {
  vi.clearAllMocks()
  completingTasks.set(new Set())
  error.set(null)
})

describe('confirmTerminalTaskAction', () => {
  it.each(['Complete', 'Delete'] as const)('asks the confirmation dialog about %s for the Task', async (action) => {
    const answer = confirmTerminalTaskAction(action, 'T-1')

    expect(get(terminalTaskConfirmationRequest)).toMatchObject({ action, taskId: 'T-1' })
    resolveTerminalTaskConfirmation(true)
    await expect(answer).resolves.toBe(true)
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

describe('completeConfirmedTask', () => {
  it('opens Needs your attention after a successful complete', async () => {
    vi.mocked(deleteTask).mockResolvedValue(undefined)

    await expect(completeConfirmedTask('T-1')).resolves.toBe(true)

    expect(notifyTaskCompleted).toHaveBeenCalledOnce()
  })

  it('does not open Needs your attention when completion fails', async () => {
    vi.mocked(deleteTask).mockRejectedValue(new Error('cleanup exploded'))

    await expect(completeConfirmedTask('T-1')).resolves.toBe(false)

    expect(notifyTaskCompleted).not.toHaveBeenCalled()
    expect(get(error)).toContain('cleanup exploded')
  })

  it('does not open Needs your attention for a duplicate complete', async () => {
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )

    const first = completeConfirmedTask('T-1')
    await expect(completeConfirmedTask('T-1')).resolves.toBe(false)
    expect(notifyTaskCompleted).not.toHaveBeenCalled()

    resolveDelete()
    await expect(first).resolves.toBe(true)
    expect(notifyTaskCompleted).toHaveBeenCalledOnce()
  })
})
