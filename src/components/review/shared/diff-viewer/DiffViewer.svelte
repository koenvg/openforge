<script lang="ts">
  import SharedDiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '../../../../lib/types'
  import type { MarkdownRepositoryLinkTarget } from '@openforge-app/plugin-sdk/markdown'
  import { pendingManualComments, agentReviewComments } from '../../../../lib/stores'
  import { updateAgentReviewCommentStatus, openUrl as hostOpenUrl, writeClipboardText } from '../../../../lib/ipc'
  import { clearSelfReviewInlineCommentDraft, getSelfReviewInlineCommentDraft, setSelfReviewInlineCommentDraft } from '../../../../lib/taskScopedReviewComments'
  import { selectedTheme } from '../../../../lib/theme'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import type { OpenReviewImage } from '@openforge-app/pr-review-ui/reviewImages'
  import type { Snippet } from 'svelte'

  interface BaseProps {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    headSha?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    onRequestFocusFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
    batchFetchFileContents?: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath?: (target: MarkdownRepositoryLinkTarget) => void | Promise<void>
    toolbarExtra?: Snippet
    fileHeaderExtra?: Snippet<[PrFileDiff]>
    includeCommitted?: boolean
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenImage?: OpenReviewImage
    includeUncommitted?: boolean
    agentComments?: AgentReviewComment[]
    onScrollTopChange?: (scrollTop: number) => void
    initialScrollTop?: number
    inlineDraftScopeId?: string
    reviewedFileShas?: Map<string, string>
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
    getFileReviewIdentity?: (file: PrFileDiff) => string | null
  }

  type PendingCommentsControl =
    | { pendingComments?: undefined; onPendingCommentsChange?: undefined }
    | { pendingComments: ReviewSubmissionComment[]; onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void }

  type Props = BaseProps & PendingCommentsControl

  let {
    files = [],
    existingComments = [],
    repoOwner = '',
    repoName = '',
    headSha = '',
    fileTreeVisible = true,
    onToggleFileTree,
    onRequestFocusFileTree,
    fetchFileContents,
    batchFetchFileContents,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    toolbarExtra,
    fileHeaderExtra,
    includeCommitted = true,
    onOpenUrl = hostOpenUrl,
    onOpenImage,
    includeUncommitted = false,
    agentComments = [],
    pendingComments,
    onPendingCommentsChange,
    onScrollTopChange,
    initialScrollTop = 0,
    inlineDraftScopeId,
    reviewedFileShas = new Map(),
    onToggleFileReviewed,
    getFileReviewIdentity,
  }: Props = $props()

  type SharedDiffViewerHandle = {
    scrollToFile: (filename: string) => void
    scrollToFragment: (filename: string, fragment: string) => Promise<void>
    scrollToComment: (filename: string, lineNumber: number) => Promise<void>
    getScrollTop: () => number
    setScrollTop: (scrollTop: number) => void
    focusDiff: () => void
  }

  let sharedViewer = $state<SharedDiffViewerHandle | null>(null)
  const visiblePendingComments = $derived(pendingComments ?? $pendingManualComments)


  async function copyFilePath(filename: string): Promise<void> {
    try {
      await writeClipboardText(filename)
    } catch (error) {
      console.error('Failed to copy file path:', error)
    }
  }
  function setVisiblePendingComments(comments: ReviewSubmissionComment[]) {
    if (onPendingCommentsChange) {
      onPendingCommentsChange(comments)
    } else {
      $pendingManualComments = comments
    }
  }

  export function scrollToFile(filename: string) {
    sharedViewer?.scrollToFile(filename)
  }

  export function scrollToFragment(filename: string, fragment: string) {
    return sharedViewer?.scrollToFragment(filename, fragment) ?? Promise.resolve()
  }

  export function scrollToComment(filename: string, lineNumber: number) {
    return sharedViewer?.scrollToComment(filename, lineNumber) ?? Promise.resolve()
  }

  export function getScrollTop() {
    return sharedViewer?.getScrollTop() ?? 0
  }

  export function setScrollTop(scrollTop: number) {
    sharedViewer?.setScrollTop(scrollTop)
  }

  export function focusDiff() {
    sharedViewer?.focusDiff()
  }
</script>

<SharedDiffViewer
  bind:this={sharedViewer}
  {files}
  {existingComments}
  {repoOwner}
  {repoName}
  {headSha}
  {fileTreeVisible}
  {onToggleFileTree}
  {onRequestFocusFileTree}
  {fetchFileContents}
  {batchFetchFileContents}
  {resolveRepositoryImage}
  {onOpenRepositoryPath}
  {toolbarExtra}
  {fileHeaderExtra}
  onCopyFilePath={copyFilePath}
  {includeCommitted}
  {includeUncommitted}
  {agentComments}
  pendingComments={visiblePendingComments}
  onPendingCommentsChange={setVisiblePendingComments}
  onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
  onUpdateAgentCommentStatus={updateAgentReviewCommentStatus}
  {onOpenUrl}
  {onOpenImage}
  {onScrollTopChange}
  {initialScrollTop}
  {inlineDraftScopeId}
  {reviewedFileShas}
  {onToggleFileReviewed}
  {getFileReviewIdentity}
  getInlineDraft={getSelfReviewInlineCommentDraft}
  setInlineDraft={setSelfReviewInlineCommentDraft}
  clearInlineDraft={clearSelfReviewInlineCommentDraft}
  appearance={$selectedTheme.appearance}
/>
