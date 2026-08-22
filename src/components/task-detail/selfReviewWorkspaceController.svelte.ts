import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { get } from 'svelte/store'
import { tick } from 'svelte'
import { FILE_VIEWER_VIEW_KEY, revealFileInFileViewer } from '../../lib/fileViewerPlugin'
import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
import {
  getCommitBatchFileContents,
  getCommitFileContents,
  getTaskBatchFileContents,
  getTaskFileContents,
  openUrl,
} from '../../lib/ipc'
import { createReviewedBaselineController } from '../../lib/reviewedBaselineController.svelte'
import { createSelfReviewFileContentLoader, type SelfReviewContext } from '../../lib/selfReviewFileContentLoader'
import {
  mergeVisiblePendingSelfReviewComments,
  selfReviewStateByTask,
  setPendingSelfReviewComments,
} from '../../lib/taskScopedSelfReviewState'
import {
  getTaskReviewFileIdentity,
  getTaskReviewPaneState,
  getTaskReviewReviewedFileShas,
  getTaskReviewReviewedFileSnapshots,
  markTaskReviewFileReviewed,
  pruneTaskReviewReviewedFiles,
  unmarkTaskReviewFileReviewed,
  updateTaskReviewPaneState,
  type ReviewedFileSnapshot,
} from '../../lib/taskReviewPaneState'
import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
import { createDiffLoader } from '../../lib/useDiffLoader.svelte'
import type {
  PrComment,
  PrFileDiff,
  ReviewSubmissionComment,
} from '../../lib/types'

export interface SelfReviewDiffViewerHandle {
  focusDiff?(): void
  getScrollTop(): number
  scrollToComment?(filename: string, lineNumber: number): Promise<void>
  scrollToFile?(filename: string): void
  setScrollTop(scrollTop: number): void
}

export interface SelfReviewWorkspaceControllerOptions {
  getTaskId: () => string
  navigateToFileViewer: (viewKey: string) => void
  revealRepositoryPath?: (repositoryPath: string) => Promise<unknown>
  openExternalUrl?: (url: string) => void | Promise<void>
}


const LOCKED_SCOPE_TOOLTIP = 'At least one must stay selected — enable the other option to turn this off.'

export function createSelfReviewWorkspaceController(
  options: SelfReviewWorkspaceControllerOptions,
) {
  let fileTreeVisible = $state(true)
  let includeCommitted = $state(true)
  let includeUncommitted = $state(true)
  let includeNonApplicationFiles = $state(true)
  let sidebarVisible = $state(true)
  let sidebarTab = $state<'pr' | 'notes'>('pr')
  let showAddressed = $state(false)
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let reviewedFileSnapshots = $state<Map<string, ReviewedFileSnapshot>>(new Map())
  let reviewedBaselineError = $state<string | null>(null)
  let selfReviewStateMap = $state(get(selfReviewStateByTask))
  let attachedDiffViewer: SelfReviewDiffViewerHandle | undefined
  let hasRestoredScroll = false
  let hasAutoOpened = false
  let syncedTaskId: string | null = null
  let disposed = false

  const unsubscribeSelfReviewState = selfReviewStateByTask.subscribe((value) => {
    selfReviewStateMap = value
  })

  const diffLoader = createDiffLoader({
    getTaskId: options.getTaskId,
    getIncludeCommitted: () => includeCommitted,
    getIncludeUncommitted: () => includeUncommitted,
    initialSelectedCommitSha: getTaskReviewPaneState(options.getTaskId()).selectedCommitSha,
    onSelectedCommitShaChange: (selectedCommitSha) => {
      updateTaskReviewPaneState(options.getTaskId(), { selectedCommitSha })
    },
  })

  function getReviewContext(): SelfReviewContext {
    return {
      taskId: options.getTaskId(),
      selectedCommitSha: diffLoader.selectedCommitSha,
      includeCommitted,
      includeUncommitted,
    }
  }

  let selfReviewState = $derived(selfReviewStateMap.get(options.getTaskId()))
  let selfReviewDiffFiles = $derived(selfReviewState?.diffFiles ?? [])

  const reviewedBaseline = createReviewedBaselineController({
    getReviewFiles: () => selfReviewDiffFiles,
    getSnapshots: () => reviewedFileSnapshots,
    getReviewContext,
    getFileIdentity: getTaskReviewFileIdentity,
    fetchCurrentContents: (files) => fileContentLoader.fetchCurrentBatch(files),
  })

  const fileContentLoader = createSelfReviewFileContentLoader({
    getContext: getReviewContext,
    getComparisonContents: reviewedBaseline.getComparisonContents,
    getTaskFileContents: (...args) => getTaskFileContents(...args),
    getTaskBatchFileContents: (...args) => getTaskBatchFileContents(...args),
    getCommitFileContents: (...args) => getCommitFileContents(...args),
    getCommitBatchFileContents: (...args) => getCommitBatchFileContents(...args),
  })

  const commentSelection = createCommentSelection({
    getPrComments: () => diffLoader.prComments,
  })

  let nonApplicationFileCount = $derived(countNonApplicationFiles(selfReviewDiffFiles))
  let treeFiles = $derived(filterApplicationFiles(selfReviewDiffFiles, includeNonApplicationFiles))
  let comparisonMappedDiffFiles = $derived(reviewedBaseline.mapFiles(selfReviewDiffFiles))
  let visibleDiffFiles = $derived(filterApplicationFiles(comparisonMappedDiffFiles, includeNonApplicationFiles))
  let generalComments = $derived(selfReviewState?.generalComments ?? [])
  let pendingInlineComments = $derived(selfReviewState?.pendingInlineComments ?? [])
  let inlineReviewComments = $derived(prCommentsToReviewComments(diffLoader.prComments))
  let visibleInlineReviewComments = $derived(
    inlineReviewComments.filter((comment) => !reviewedBaseline.hasComparison(comment.path)),
  )
  let visiblePendingInlineComments = $derived(
    pendingInlineComments.filter((comment) => !reviewedBaseline.hasComparison(comment.path)),
  )
  let markdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl(diffLoader.linkedPr))

  function syncReviewedFileState(): void {
    const taskId = options.getTaskId()
    reviewedFileShas = getTaskReviewReviewedFileShas(taskId)
    reviewedFileSnapshots = getTaskReviewReviewedFileSnapshots(taskId)
  }

  function synchronizeTaskState(taskId: string): void {
    if (syncedTaskId === taskId) return
    syncedTaskId = taskId
    hasRestoredScroll = false
    hasAutoOpened = false
    syncReviewedFileState()
  }

  function pruneStaleReviewedFiles(taskId: string): void {
    if (diffLoader.isLoading || selfReviewDiffFiles.length === 0) return
    pruneTaskReviewReviewedFiles(taskId, selfReviewDiffFiles)
    syncReviewedFileState()
  }

  function showFeedbackForNewComments(): void {
    if (commentSelection.unaddressedCount === 0 || hasAutoOpened) return
    sidebarVisible = true
    hasAutoOpened = true
  }

  function synchronizeWorkspaceState(): void {
    const taskId = options.getTaskId()
    synchronizeTaskState(taskId)
    reviewedBaseline.syncReviewContext()
    pruneStaleReviewedFiles(taskId)
    showFeedbackForNewComments()
  }

  async function load(): Promise<void> {
    await diffLoader.loadDiff()
    await diffLoader.loadCommits()
    synchronizeWorkspaceState()
  }

  async function restoreDiffScroll(
    diffViewer = attachedDiffViewer,
  ): Promise<void> {
    if (hasRestoredScroll || diffLoader.isLoading || !diffViewer) return
    await tick()
    if (hasRestoredScroll || diffViewer !== attachedDiffViewer) return
    hasRestoredScroll = true
    const { diffScrollTop } = getTaskReviewPaneState(options.getTaskId())
    if (diffScrollTop > 0) diffViewer.setScrollTop(diffScrollTop)
  }

  function dispose(diffViewer = attachedDiffViewer): void {
    if (disposed) return
    disposed = true
    const taskId = options.getTaskId()
    const savedPaneState = getTaskReviewPaneState(taskId)
    const currentScrollTop = diffViewer?.getScrollTop() ?? savedPaneState.diffScrollTop
    updateTaskReviewPaneState(taskId, {
      selectedCommitSha: diffLoader.selectedCommitSha,
      diffScrollTop: currentScrollTop > 0 ? currentScrollTop : savedPaneState.diffScrollTop,
    })
    unsubscribeSelfReviewState()
    diffLoader.cleanup()
  }

  async function setIncludeCommitted(value: boolean): Promise<void> {
    includeCommitted = value
    await diffLoader.refresh()
  }

  async function setIncludeUncommitted(value: boolean): Promise<void> {
    includeUncommitted = value
    await diffLoader.refresh()
  }

  async function selectCommit(sha: string | null): Promise<void> {
    await diffLoader.selectCommit(sha)
  }

  function handlePendingInlineCommentsChange(comments: ReviewSubmissionComment[]): void {
    setPendingSelfReviewComments(
      options.getTaskId(),
      mergeVisiblePendingSelfReviewComments(
        pendingInlineComments,
        comments,
        reviewedBaseline.comparisonFilenames,
      ),
    )
  }

  async function showChangesSinceReviewed(file: PrFileDiff): Promise<boolean> {
    reviewedBaselineError = null
    try {
      return await reviewedBaseline.showChangesSinceReviewed(file)
    } catch (error) {
      console.error(`[SelfReviewView] Failed to load Reviewed File Snapshot comparison for ${file.filename}:`, error)
      reviewedBaselineError = `Couldn't compare ${file.filename} with its Reviewed File Snapshot. Try the Since reviewed action again.`
      return false
    }
  }

  async function toggleFileReviewed(file: PrFileDiff, reviewed: boolean): Promise<void> {
    if (reviewed) {
      const reviewFile = reviewedBaseline.getReviewFile(file)
      try {
        const contents = await fileContentLoader.fetchCurrent(reviewFile)
        markTaskReviewFileReviewed(options.getTaskId(), reviewFile, { newContent: contents.newContent })
        reviewedBaseline.restoreFile(reviewFile.filename)
      } catch (error) {
        console.error(`Failed to snapshot reviewed file ${file.filename}:`, error)
        markTaskReviewFileReviewed(options.getTaskId(), reviewFile)
      }
    } else {
      unmarkTaskReviewFileReviewed(options.getTaskId(), file.filename)
      reviewedBaseline.restoreFile(file.filename)
    }
    syncReviewedFileState()
  }

  async function openRepositoryPath(repositoryPath: string): Promise<void> {
    try {
      await (options.revealRepositoryPath ?? revealFileInFileViewer)(repositoryPath)
    } finally {
      options.navigateToFileViewer(FILE_VIEWER_VIEW_KEY)
    }
  }

  function openLinkedPr(): void {
    const linkedPr = diffLoader.linkedPr
    if (linkedPr) void (options.openExternalUrl ?? openUrl)(linkedPr.url)
  }

  function scrollToComment(comment: PrComment): void {
    if (comment.file_path && comment.line_number != null) {
      void attachedDiffViewer?.scrollToComment?.(comment.file_path, comment.line_number)
    }
  }

  return {
    get taskId() { return options.getTaskId() },
    get fileTreeVisible() { return fileTreeVisible },
    get includeCommitted() { return includeCommitted },
    get includeUncommitted() { return includeUncommitted },
    get includeNonApplicationFiles() { return includeNonApplicationFiles },
    get committedLocked() { return includeCommitted && !includeUncommitted },
    get uncommittedLocked() { return includeUncommitted && !includeCommitted },
    get lockedScopeTooltip() { return LOCKED_SCOPE_TOOLTIP },
    get sidebarVisible() { return sidebarVisible },
    get sidebarTab() { return sidebarTab },
    get showAddressed() { return showAddressed },
    get reviewedFileShas() { return reviewedFileShas },
    get treeFiles() { return treeFiles },
    get visibleDiffFiles() { return visibleDiffFiles },
    get selfReviewDiffFiles() { return selfReviewDiffFiles },
    get nonApplicationFileCount() { return nonApplicationFileCount },
    get isLoading() { return diffLoader.isLoading },
    get error() { return diffLoader.error },
    get reviewedBaselineError() { return reviewedBaselineError },
    get commits() { return diffLoader.commits },
    get selectedCommitSha() { return diffLoader.selectedCommitSha },
    get linkedPr() { return diffLoader.linkedPr },
    get prComments() { return diffLoader.prComments },
    get commentSelection() { return commentSelection },
    get generalCommentCount() { return generalComments.length },
    get pendingInlineComments() { return pendingInlineComments },
    get visibleInlineReviewComments() { return visibleInlineReviewComments },
    get visiblePendingInlineComments() { return visiblePendingInlineComments },
    get markdownImageBaseUrl() { return markdownImageBaseUrl },
    get initialScrollTop() { return getTaskReviewPaneState(options.getTaskId()).diffScrollTop },
    load,
    synchronizeWorkspaceState,
    dispose,
    attachDiffViewer: (diffViewer: SelfReviewDiffViewerHandle | undefined) => { attachedDiffViewer = diffViewer },
    restoreDiffScroll,
    refresh: diffLoader.refresh,
    setIncludeCommitted,
    setIncludeUncommitted,
    setIncludeNonApplicationFiles: (value: boolean) => { includeNonApplicationFiles = value },
    selectCommit,
    selectFile: (filename: string) => { attachedDiffViewer?.scrollToFile?.(filename) },
    focusDiff: () => { attachedDiffViewer?.focusDiff?.() },
    setFileTreeVisible: (visible: boolean) => { fileTreeVisible = visible },
    toggleFileTree: () => { fileTreeVisible = !fileTreeVisible },
    setSidebarVisible: (visible: boolean) => { sidebarVisible = visible },
    toggleSidebar: () => { sidebarVisible = !sidebarVisible },
    setSidebarTab: (tab: 'pr' | 'notes') => { sidebarTab = tab },
    setShowAddressed: (value: boolean) => { showAddressed = value },
    handlePendingInlineCommentsChange,
    toggleFileReviewed,
    getVisibleFileReviewIdentity: reviewedBaseline.getVisibleFileReviewIdentity,
    hasComparison: reviewedBaseline.hasComparison,
    hasReviewedBaselineChange: reviewedBaseline.hasReviewedBaselineChange,
    showChangesSinceReviewed,
    restoreFile: (file: PrFileDiff) => { reviewedBaseline.restoreFile(file.filename) },
    fetchFileContents: fileContentLoader.fetch,
    batchFetchFileContents: fileContentLoader.fetchBatch,
    resolveRepositoryImage: fileContentLoader.resolveRepositoryImage,
    openRepositoryPath,
    openLinkedPr,
    scrollToComment,
    updateScrollTop: (diffScrollTop: number) => {
      updateTaskReviewPaneState(options.getTaskId(), { diffScrollTop })
    },
  }
}

export type SelfReviewWorkspaceController = ReturnType<typeof createSelfReviewWorkspaceController>
