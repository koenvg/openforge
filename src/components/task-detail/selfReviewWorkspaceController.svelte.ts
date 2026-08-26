import { get } from 'svelte/store'
import { selfReviewStateByTask } from '../../lib/taskScopedSelfReviewState'
import type { PrFileDiff } from '../../lib/types'
import { createSelfReviewChangedFilesPane } from './selfReviewChangedFilesPane.svelte'
import { createSelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'
import {
  createSelfReviewCommentController,
} from './selfReviewCommentController.svelte'
import { createSelfReviewDiffController } from './selfReviewDiffController.svelte'
import { createSelfReviewFileStateController } from './selfReviewFileStateController.svelte'
import {
  createSelfReviewNavigationController,
  type SelfReviewDiffViewerHandle,
} from './selfReviewNavigationController.svelte'

export type { SelfReviewDiffViewerHandle } from './selfReviewNavigationController.svelte'

export interface SelfReviewWorkspaceControllerOptions {
  getTaskId: () => string
  navigateToFileViewer: (viewKey: string) => void
  revealRepositoryPath?: (repositoryPath: string) => Promise<unknown>
  openExternalUrl?: (url: string) => void | Promise<void>
}

export function createSelfReviewWorkspaceController(
  options: SelfReviewWorkspaceControllerOptions,
) {
  let selfReviewStateMap = $state(get(selfReviewStateByTask))
  let disposed = false

  const unsubscribeSelfReviewState = selfReviewStateByTask.subscribe((value) => {
    selfReviewStateMap = value
  })

  let selfReviewState = $derived(selfReviewStateMap.get(options.getTaskId()))
  let selfReviewDiffFiles = $derived(selfReviewState?.diffFiles ?? [])

  const diffController = createSelfReviewDiffController({
    getTaskId: options.getTaskId,
  })

  const fileStateController = createSelfReviewFileStateController({
    getTaskId: options.getTaskId,
    getReviewFiles: () => selfReviewDiffFiles,
    getReviewContext: diffController.getReviewContext,
    getIsDiffLoading: () => diffController.isLoading,
  })

  const navigationController = createSelfReviewNavigationController({
    getTaskId: options.getTaskId,
    getSelectedCommitSha: () => diffController.selectedCommitSha,
    getLinkedPr: () => diffController.linkedPr,
    navigateToFileViewer: options.navigateToFileViewer,
    revealRepositoryPath: options.revealRepositoryPath,
    openExternalUrl: options.openExternalUrl,
  })

  const changedFilesPane = createSelfReviewChangedFilesPane({
    diff: diffController,
    files: fileStateController,
    navigation: navigationController,
  })

  const commentController = createSelfReviewCommentController({
    getTaskId: options.getTaskId,
    getState: () => selfReviewState,
    getPrComments: () => diffController.prComments,
    getLinkedPr: () => diffController.linkedPr,
    getComparisonFilenames: () => fileStateController.comparisonFilenames,
    onCommentsNeedAttention: () => navigationController.setSidebarVisible(true),
  })

  const feedbackPane = createSelfReviewFeedbackPane({
    diff: diffController,
    comments: commentController,
    navigation: navigationController,
  })

  function synchronizeWorkspaceState(): void {
    navigationController.synchronizeTask(options.getTaskId())
    fileStateController.synchronize()
    commentController.synchronize()
  }

  async function load(): Promise<void> {
    await diffController.load()
    synchronizeWorkspaceState()
  }

  async function restoreDiffScroll(diffViewer?: SelfReviewDiffViewerHandle): Promise<void> {
    if (diffController.isLoading) return
    await navigationController.restoreDiffScroll(diffViewer)
  }

  function dispose(diffViewer?: SelfReviewDiffViewerHandle): void {
    if (disposed) return
    disposed = true
    navigationController.dispose(diffViewer)
    unsubscribeSelfReviewState()
    diffController.dispose()
  }

  return {
    get taskId() { return options.getTaskId() },
    changedFilesPane,
    feedbackPane,
    get fileTreeVisible() { return navigationController.fileTreeVisible },
    get includeCommitted() { return diffController.includeCommitted },
    get includeUncommitted() { return diffController.includeUncommitted },
    get includeNonApplicationFiles() { return fileStateController.includeNonApplicationFiles },
    get committedLocked() { return diffController.committedLocked },
    get uncommittedLocked() { return diffController.uncommittedLocked },
    get lockedScopeTooltip() { return diffController.lockedScopeTooltip },
    get sidebarVisible() { return navigationController.sidebarVisible },
    get reviewedFileShas() { return fileStateController.reviewedFileShas },
    get treeFiles() { return fileStateController.treeFiles },
    get visibleDiffFiles() { return fileStateController.visibleDiffFiles },
    get selfReviewDiffFiles() { return selfReviewDiffFiles },
    get nonApplicationFileCount() { return fileStateController.nonApplicationFileCount },
    get isLoading() { return diffController.isLoading },
    get error() { return diffController.error },
    get reviewedBaselineError() { return fileStateController.reviewedBaselineError },
    get commits() { return diffController.commits },
    get selectedCommitSha() { return diffController.selectedCommitSha },
    get commentSelection() { return commentController.commentSelection },
    get pendingInlineComments() { return commentController.pendingInlineComments },
    get visibleInlineReviewComments() { return commentController.visibleInlineReviewComments },
    get visiblePendingInlineComments() { return commentController.visiblePendingInlineComments },
    get initialScrollTop() { return navigationController.initialScrollTop },
    load,
    synchronizeWorkspaceState,
    dispose,
    attachDiffViewer: navigationController.attachDiffViewer,
    restoreDiffScroll,
    refresh: diffController.refresh,
    setIncludeCommitted: diffController.setIncludeCommitted,
    setIncludeUncommitted: diffController.setIncludeUncommitted,
    setIncludeNonApplicationFiles: fileStateController.setIncludeNonApplicationFiles,
    selectCommit: diffController.selectCommit,
    selectFile: navigationController.selectFile,
    focusDiff: navigationController.focusDiff,
    setFileTreeVisible: navigationController.setFileTreeVisible,
    toggleFileTree: navigationController.toggleFileTree,
    toggleSidebar: navigationController.toggleSidebar,
    handlePendingInlineCommentsChange: commentController.handlePendingInlineCommentsChange,
    toggleFileReviewed: fileStateController.toggleFileReviewed,
    getVisibleFileReviewIdentity: fileStateController.getVisibleFileReviewIdentity,
    hasComparison: fileStateController.hasComparison,
    hasReviewedBaselineChange: fileStateController.hasReviewedBaselineChange,
    showChangesSinceReviewed: fileStateController.showChangesSinceReviewed,
    restoreFile: (file: PrFileDiff) => { fileStateController.restoreFile(file) },
    fetchFileContents: fileStateController.fetchFileContents,
    batchFetchFileContents: fileStateController.batchFetchFileContents,
    resolveRepositoryImage: fileStateController.resolveRepositoryImage,
    openRepositoryPath: navigationController.openRepositoryPath,
    updateScrollTop: navigationController.updateScrollTop,
  }
}

export type SelfReviewWorkspaceController = ReturnType<typeof createSelfReviewWorkspaceController>
