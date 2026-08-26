import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTaskReviewPaneState, getTaskReviewPaneState } from '../../lib/taskReviewPaneState'
import { createSelfReviewDiffController } from './selfReviewDiffController.svelte'

vi.mock('../../lib/ipc', () => ({
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskCommits: vi.fn().mockResolvedValue([]),
  getCommitDiff: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
}))

const taskId = 'task-1'
const rootCleanups: Array<() => void> = []

function createController() {
  let controller!: ReturnType<typeof createSelfReviewDiffController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewDiffController({ getTaskId: () => taskId })
  })
  rootCleanups.push(() => {
    controller.dispose()
    cleanup()
  })
  return controller
}

beforeEach(() => {
  clearTaskReviewPaneState()
  vi.clearAllMocks()
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewDiffController', () => {
  it('owns diff scope locking and refreshes the selected scope', async () => {
    const { getTaskDiff } = await import('../../lib/ipc')
    const controller = createController()

    await controller.setIncludeCommitted(false)

    expect(getTaskDiff).toHaveBeenLastCalledWith(taskId, false, true)
    expect(controller.committedLocked).toBe(false)
    expect(controller.uncommittedLocked).toBe(true)
  })

  it('persists commit selection while loading that commit diff', async () => {
    const { getCommitDiff } = await import('../../lib/ipc')
    const controller = createController()

    await controller.selectCommit('commit-sha')

    expect(getCommitDiff).toHaveBeenCalledWith(taskId, 'commit-sha')
    expect(getTaskReviewPaneState(taskId).selectedCommitSha).toBe('commit-sha')
  })
})
