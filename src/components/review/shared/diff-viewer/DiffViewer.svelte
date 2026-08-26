<script lang="ts">
  import SharedDiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '../../../../lib/types'
  import { pendingManualComments, agentReviewComments } from '../../../../lib/stores'
  import { updateAgentReviewCommentStatus, openUrl as hostOpenUrl } from '../../../../lib/ipc'
  import { clearSelfReviewInlineCommentDraft, getSelfReviewInlineCommentDraft, setSelfReviewInlineCommentDraft } from '../../../../lib/taskScopedReviewComments'
  import { getDiffTheme, themeMode } from '../../../../lib/theme'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import type { OpenReviewImage, ReviewImageOpenRequest } from '@openforge-app/pr-review-ui/reviewImages'
  import ReviewImageLightbox from './ReviewImageLightbox.svelte'
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
    onOpenRepositoryPath?: (repositoryPath: string, suffix: string) => void | Promise<void>
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
    scrollToComment: (filename: string, lineNumber: number) => Promise<void>
    getScrollTop: () => number
    setScrollTop: (scrollTop: number) => void
    focusDiff: () => void
  }

  let sharedViewer = $state<SharedDiffViewerHandle | null>(null)
  let imageRequest = $state<ReviewImageOpenRequest | null>(null)
  let imageContextKey = $state<string | null>(null)
  const visiblePendingComments = $derived(pendingComments ?? $pendingManualComments)

  function getImageContextKey(request: ReviewImageOpenRequest): string | null {
    const filenames = new Set(request.images.map(image => image.filename))
    const file = files.find(candidate => filenames.has(candidate.filename))
    if (!file) return null

    return [
      file.filename,
      file.sha,
      file.status,
      file.patch ?? '',
      file.previous_filename ?? '',
    ].join('\u0000')
  }

  $effect(() => {
    if (!imageRequest) return

    const currentContextKey = getImageContextKey(imageRequest)
    if (!currentContextKey || currentContextKey !== imageContextKey) {
      closeImagePreview()
    }
  })

  function handleOpenImage(request: ReviewImageOpenRequest) {
    if (onOpenImage) {
      onOpenImage(request)
      return
    }

    imageContextKey = getImageContextKey(request)
    imageRequest = request
  }

  function closeImagePreview() {
    imageRequest = null
    imageContextKey = null
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
  {includeCommitted}
  {includeUncommitted}
  {agentComments}
  pendingComments={visiblePendingComments}
  onPendingCommentsChange={setVisiblePendingComments}
  onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
  onUpdateAgentCommentStatus={updateAgentReviewCommentStatus}
  {onOpenUrl}
  onOpenImage={handleOpenImage}
  {onScrollTopChange}
  {initialScrollTop}
  {inlineDraftScopeId}
  {reviewedFileShas}
  {onToggleFileReviewed}
  {getFileReviewIdentity}
  getInlineDraft={getSelfReviewInlineCommentDraft}
  setInlineDraft={setSelfReviewInlineCommentDraft}
  clearInlineDraft={clearSelfReviewInlineCommentDraft}
  diffTheme={getDiffTheme($themeMode)}
/>

{#if imageRequest}
  {#key imageRequest}
    <ReviewImageLightbox request={imageRequest} onClose={closeImagePreview} />
  {/key}
{/if}
