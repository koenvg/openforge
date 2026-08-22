import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTaskReviewPaneState,
  getTaskReviewPaneState,
  updateTaskReviewPaneState,
} from '../../lib/taskReviewPaneState'
import { createSelfReviewNavigationController } from './selfReviewNavigationController.svelte'

const taskId = 'task-1'
const rootCleanups: Array<() => void> = []

function createController(
  navigateToFileViewer = vi.fn(),
  revealRepositoryPath: (repositoryPath: string) => Promise<unknown> = vi.fn().mockResolvedValue(true),
) {
  let controller!: ReturnType<typeof createSelfReviewNavigationController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewNavigationController({
      getTaskId: () => taskId,
      getSelectedCommitSha: () => null,
      getLinkedPr: () => null,
      navigateToFileViewer,
      revealRepositoryPath,
    })
  })
  rootCleanups.push(cleanup)
  return controller
}

beforeEach(() => {
  clearTaskReviewPaneState()
  vi.clearAllMocks()
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewNavigationController', () => {
  it('restores scroll on the replacement viewer when attachment changes during tick', async () => {
    updateTaskReviewPaneState(taskId, { diffScrollTop: 184 })
    const controller = createController()
    const staleViewer = { getScrollTop: vi.fn(() => 0), setScrollTop: vi.fn() }
    const replacementViewer = { getScrollTop: vi.fn(() => 0), setScrollTop: vi.fn() }
    controller.attachDiffViewer(staleViewer)

    const staleRestoration = controller.restoreDiffScroll(staleViewer)
    controller.attachDiffViewer(replacementViewer)
    await staleRestoration
    await controller.restoreDiffScroll(replacementViewer)

    expect(staleViewer.setScrollTop).not.toHaveBeenCalled()
    expect(replacementViewer.setScrollTop).toHaveBeenCalledWith(184)
  })

  it('saves scroll and navigates to the file viewer even when reveal fails', async () => {
    const navigateToFileViewer = vi.fn()
    const controller = createController(
      navigateToFileViewer,
      vi.fn().mockRejectedValue(new Error('missing file')),
    )
    const diffViewer = { getScrollTop: vi.fn(() => 240), setScrollTop: vi.fn() }
    controller.attachDiffViewer(diffViewer)

    await expect(controller.openRepositoryPath('docs/SETUP.md')).rejects.toThrow('missing file')
    controller.dispose(diffViewer)

    expect(navigateToFileViewer).toHaveBeenCalledOnce()
    expect(getTaskReviewPaneState(taskId).diffScrollTop).toBe(240)
  })
})
