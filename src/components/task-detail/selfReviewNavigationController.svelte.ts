import { tick } from 'svelte'
import { revealFileInFileViewer } from '../../lib/fileViewerPlugin'
import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerView'
import { openUrl } from '../../lib/ipc'
import { getTaskReviewPaneState, updateTaskReviewPaneState } from '../../lib/taskReviewPaneState'
import type { PrComment, PullRequestInfo } from '../../lib/types'

export interface SelfReviewDiffViewerHandle {
  focusDiff?(): void
  getScrollTop(): number
  scrollToComment?(filename: string, lineNumber: number): Promise<void>
  scrollToFile?(filename: string): void
  setScrollTop(scrollTop: number): void
}

export interface SelfReviewNavigationControllerOptions {
  getTaskId: () => string
  getSelectedCommitSha: () => string | null
  getLinkedPr: () => PullRequestInfo | null
  navigateToFileViewer: (viewKey: string) => void
  revealRepositoryPath?: (repositoryPath: string) => Promise<unknown>
  openExternalUrl?: (url: string) => void | Promise<void>
}

export function createSelfReviewNavigationController(options: SelfReviewNavigationControllerOptions) {
  let fileTreeVisible = $state(true)
  let sidebarVisible = $state(true)
  let showAddressed = $state(false)
  let attachedDiffViewer: SelfReviewDiffViewerHandle | undefined
  let synchronizedTaskId: string | null = null
  let hasRestoredScroll = false
  let disposed = false

  function synchronizeTask(taskId: string): void {
    if (synchronizedTaskId === taskId) return
    synchronizedTaskId = taskId
    hasRestoredScroll = false
  }

  async function restoreDiffScroll(
    diffViewer = attachedDiffViewer,
  ): Promise<void> {
    if (hasRestoredScroll || !diffViewer) return
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
      selectedCommitSha: options.getSelectedCommitSha(),
      diffScrollTop: currentScrollTop > 0 ? currentScrollTop : savedPaneState.diffScrollTop,
    })
  }

  async function openRepositoryPath(repositoryPath: string): Promise<void> {
    try {
      await (options.revealRepositoryPath ?? revealFileInFileViewer)(repositoryPath)
    } finally {
      options.navigateToFileViewer(FILE_VIEWER_VIEW_KEY)
    }
  }

  function openLinkedPr(): void {
    const linkedPr = options.getLinkedPr()
    if (linkedPr) void (options.openExternalUrl ?? openUrl)(linkedPr.url)
  }

  function scrollToComment(comment: PrComment): void {
    if (comment.file_path && comment.line_number != null) {
      void attachedDiffViewer?.scrollToComment?.(comment.file_path, comment.line_number)
    }
  }

  return {
    get fileTreeVisible() { return fileTreeVisible },
    get sidebarVisible() { return sidebarVisible },
    get showAddressed() { return showAddressed },
    get initialScrollTop() { return getTaskReviewPaneState(options.getTaskId()).diffScrollTop },
    synchronizeTask,
    dispose,
    attachDiffViewer: (diffViewer: SelfReviewDiffViewerHandle | undefined) => { attachedDiffViewer = diffViewer },
    restoreDiffScroll,
    selectFile: (filename: string) => { attachedDiffViewer?.scrollToFile?.(filename) },
    focusDiff: () => { attachedDiffViewer?.focusDiff?.() },
    setFileTreeVisible: (visible: boolean) => { fileTreeVisible = visible },
    toggleFileTree: () => { fileTreeVisible = !fileTreeVisible },
    setSidebarVisible: (visible: boolean) => { sidebarVisible = visible },
    toggleSidebar: () => { sidebarVisible = !sidebarVisible },
    setShowAddressed: (value: boolean) => { showAddressed = value },
    openRepositoryPath,
    openLinkedPr,
    scrollToComment,
    updateScrollTop: (diffScrollTop: number) => {
      updateTaskReviewPaneState(options.getTaskId(), { diffScrollTop })
    },
  }
}

export type SelfReviewNavigationController = ReturnType<typeof createSelfReviewNavigationController>
