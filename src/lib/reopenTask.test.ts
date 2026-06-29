import { vi } from 'vitest'

vi.mock('./ipc', () => ({ updateTaskStatus: vi.fn() }))

import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { reopenTask } from './reopenTask'
import { updateTaskStatus } from './ipc'
import { error } from './stores'

beforeEach(() => {
  vi.clearAllMocks()
  error.set(null)
})

describe('reopenTask', () => {
  it("moves a completed task back to 'doing'", async () => {
    vi.mocked(updateTaskStatus).mockResolvedValue(undefined)
    await reopenTask('T-1')
    expect(updateTaskStatus).toHaveBeenCalledWith('T-1', 'doing')
  })

  it('never moves a reopened task to backlog', async () => {
    vi.mocked(updateTaskStatus).mockResolvedValue(undefined)
    await reopenTask('T-1')
    expect(updateTaskStatus).not.toHaveBeenCalledWith('T-1', 'backlog')
  })

  it('surfaces an error when the status update fails', async () => {
    vi.mocked(updateTaskStatus).mockRejectedValue(new Error('boom'))
    await reopenTask('T-1')
    expect(get(error)).toBeTruthy()
  })
})
