import { render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ticketPrs } from '../../lib/stores'
import {
  selfReviewStateByTask,
  setPendingSelfReviewComments,
} from '../../lib/taskScopedSelfReviewState'
import {
  clearTaskReviewPaneState,
  getTaskReviewPaneState,
  markTaskReviewFileReviewed,
  updateTaskReviewPaneState,
} from '../../lib/taskReviewPaneState'
import type { PrFileDiff } from '../../lib/types'
import SelfReviewWorkspace from './SelfReviewWorkspace.svelte'
import { createSelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

vi.mock('../../lib/ipc', () => ({
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskCommits: vi.fn().mockResolvedValue([]),
  getCommitDiff: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([]),
  getCommitFileContents: vi.fn().mockResolvedValue(['', '']),
  getCommitBatchFileContents: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  resolveGithubAsset: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../lib/fileViewerPlugin', async () => {
  const { makePluginViewKey } = await import('../../lib/plugin/types')
  return {
    FILE_VIEWER_VIEW_KEY: makePluginViewKey('com.openforge.file-viewer', 'files'),
    revealFileInFileViewer: vi.fn().mockResolvedValue(true),
  }
})

import { getTaskBatchFileContents, getTaskDiff } from '../../lib/ipc'

const taskId = 'task-1'
const sourceFile: PrFileDiff = {
  sha: 'source-sha',
  filename: 'src/main.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n line\n+added',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}
const documentationFile: PrFileDiff = {
  ...sourceFile,
  sha: 'docs-sha',
  filename: 'README.md',
}

const rootCleanups: Array<() => void> = []

function createController(
  navigateToFileViewer = vi.fn(),
  revealRepositoryPath?: (repositoryPath: string) => Promise<unknown>,
) {
  let controller!: ReturnType<typeof createSelfReviewWorkspaceController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewWorkspaceController({
      getTaskId: () => taskId,
      navigateToFileViewer,
      revealRepositoryPath,
    })
  })
  rootCleanups.push(() => {
    controller.dispose()
    cleanup()
  })
  return controller
}

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

beforeEach(() => {
  clearTaskReviewPaneState()
  selfReviewStateByTask.set(new Map())
  ticketPrs.set(new Map())
  vi.clearAllMocks()
  vi.mocked(getTaskDiff).mockResolvedValue([])
})

describe('createSelfReviewWorkspaceController', () => {

  it('coordinates diff scope and file visibility through one reactive interface', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([sourceFile, documentationFile])
    const controller = createController()

    await controller.load()

    expect(controller.includeCommitted).toBe(true)
    expect(controller.includeUncommitted).toBe(true)
    expect(controller.committedLocked).toBe(false)
    expect(controller.treeFiles.map((file) => file.filename)).toEqual([
      'src/main.ts',
      'README.md',
    ])

    await controller.setIncludeCommitted(false)
    expect(getTaskDiff).toHaveBeenLastCalledWith(taskId, false, true)
    expect(controller.uncommittedLocked).toBe(true)

    controller.setIncludeNonApplicationFiles(false)
    expect(controller.treeFiles.map((file) => file.filename)).toEqual(['src/main.ts'])
    expect(controller.nonApplicationFileCount).toBe(1)
  })

  it('keeps comparison comments hidden and updates the Reviewed File Snapshot through the controller', async () => {
    const hiddenComment = {
      path: sourceFile.filename,
      line: 2,
      body: 'Keep this comparison comment',
      side: 'RIGHT' as const,
    }
    const visibleComment = {
      path: 'src/other.ts',
      line: 4,
      body: 'Visible comment',
      side: 'RIGHT' as const,
    }
    markTaskReviewFileReviewed(
      taskId,
      { ...sourceFile, sha: 'reviewed-sha' },
      { newContent: 'reviewed\n' },
    )
    setPendingSelfReviewComments(taskId, [hiddenComment, visibleComment])
    vi.mocked(getTaskDiff).mockResolvedValue([sourceFile])
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([['base\n', 'current\n']])
    const controller = createController()

    await controller.load()
    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(true)
    await expect(controller.showChangesSinceReviewed(sourceFile)).resolves.toBe(true)
    expect(controller.visiblePendingInlineComments).toEqual([visibleComment])

    const updatedVisibleComment = { ...visibleComment, body: 'Updated visible comment' }
    controller.handlePendingInlineCommentsChange([updatedVisibleComment])
    expect(controller.pendingInlineComments).toEqual([hiddenComment, updatedVisibleComment])

    await controller.toggleFileReviewed(sourceFile, true)
    expect(controller.hasComparison(sourceFile.filename)).toBe(false)
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe(sourceFile.sha)
  })

  it('restores and saves the task diff scroll position at the workspace seam', async () => {
    updateTaskReviewPaneState(taskId, { diffScrollTop: 184 })
    const controller = createController()
    const diffViewer = {
      getScrollTop: vi.fn(() => 240),
      setScrollTop: vi.fn(),
    }

    controller.attachDiffViewer(diffViewer)
    await controller.restoreDiffScroll(diffViewer)
    expect(diffViewer.setScrollTop).toHaveBeenCalledWith(184)

    controller.dispose(diffViewer)
    expect(getTaskReviewPaneState(taskId).diffScrollTop).toBe(240)
  })

  it('restores scroll on the replacement viewer when the attached viewer changes during tick', async () => {
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

  it('navigates to the file viewer even when revealing a repository path fails', async () => {
    const navigateToFileViewer = vi.fn()
    const controller = createController(
      navigateToFileViewer,
      vi.fn().mockRejectedValue(new Error('missing file')),
    )

    await expect(controller.openRepositoryPath('docs/SETUP.md')).rejects.toThrow('missing file')
    expect(navigateToFileViewer).toHaveBeenCalledOnce()
  })
})

describe('SelfReviewWorkspace presentation', () => {

  it('renders the review regions and empty diff state from the controller interface', async () => {
    const controller = createController()
    await controller.load()

    render(SelfReviewWorkspace, {
      props: {
        controller,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Changed files panel' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Code diff panel' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Feedback panel' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'General feedback' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'PR Comments' })).toBeNull()
      expect(screen.getByText('No changes for current selection')).toBeTruthy()
    })
  })
})
