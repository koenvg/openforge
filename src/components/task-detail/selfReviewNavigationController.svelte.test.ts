import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTaskReviewPaneState,
  updateTaskReviewPaneState,
} from '../../lib/taskReviewPaneState'
import { createSelfReviewNavigationController } from './selfReviewNavigationController.svelte'

const taskId = 'task-1'
const rootCleanups: Array<() => void> = []

function createController(
  getDisplayedReviewPaths: () => string[] = () => [],
) {
  let controller!: ReturnType<typeof createSelfReviewNavigationController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewNavigationController({
      getTaskId: () => taskId,
      getSelectedCommitSha: () => null,
      getDisplayedReviewPaths,
      getLinkedPr: () => null,
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

  it('scrolls to a displayed diff file without leaving Review', async () => {
    const controller = createController(() => ['src/main.rs'])
    const diffViewer = {
      getScrollTop: vi.fn(() => 240),
      setScrollTop: vi.fn(),
      scrollToFile: vi.fn(),
      scrollToFragment: vi.fn().mockResolvedValue(undefined),
    }
    controller.attachDiffViewer(diffViewer)

    await controller.openRepositoryPath({
      repositoryPath: 'src/main.rs',
      suffix: '#usage',
    })

    expect(diffViewer.scrollToFragment).toHaveBeenCalledWith('src/main.rs', 'usage')
    expect(diffViewer.scrollToFile).not.toHaveBeenCalled()
    expect(controller.repositoryPreview).toBeNull()
  })

  it('opens other repository files in a Review-local preview', async () => {
    const controller = createController()
    const diffViewer = { getScrollTop: vi.fn(() => 0), setScrollTop: vi.fn(), focusDiff: vi.fn() }
    controller.attachDiffViewer(diffViewer)

    await controller.openRepositoryPath({
      repositoryPath: 'docs/SETUP.md',
      suffix: '?plain=1#installation',
    })

    expect(controller.repositoryPreview).toEqual({
      repositoryPath: 'docs/SETUP.md',
      suffix: '?plain=1#installation',
    })

    await controller.closeRepositoryPreview()
    expect(controller.repositoryPreview).toBeNull()
    expect(diffViewer.focusDiff).toHaveBeenCalledOnce()
  })
})
