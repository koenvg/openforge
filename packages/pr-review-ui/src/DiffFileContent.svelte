<script lang="ts">
  import type { DiffFile } from '@git-diff-view/core'
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import type { AgentReviewComment, AiThread, PrFileDiff, ReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import { buildExtendData, type CommentDisplayData, type PendingReply } from './diffComments'
  import { diffHighlighter } from './diffHighlighter'
  import { getImagePreviewDataUrl, isImageFileDiff, type FileContents } from './diffAdapter'
  import type { OpenReviewImage, ReviewImage } from './reviewImages'
  import InlineCommentForm from './InlineCommentForm.svelte'
  import InlineCommentThread from './InlineCommentThread.svelte'
  import FileContentsError from './FileContentsError.svelte'

  interface Props {
    file: PrFileDiff
    richDiffActive: boolean
    fileContents: FileContents | undefined
    fileContentError: string | undefined
    onRetryFileContents: () => void
    canFetchFileContents: boolean
    workerDiffFile: DiffFile | undefined
    diffViewMode: DiffModeEnum
    diffViewWrap: boolean
    diffViewTheme: 'light' | 'dark'
    githubMarkdownImageBaseUrl: string | null
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    agentComments: AgentReviewComment[]
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath: (repositoryPath: string, suffix: string) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenImage?: OpenReviewImage
    onOpenInlineCommentWidget: (lineNumber: number, side: SplitSide) => void
    getInlineCommentText: (lineNumber: number, side: SplitSide) => string
    onSetInlineCommentText: (lineNumber: number, side: SplitSide, text: string) => void
    onClearInlineCommentText: (lineNumber: number, side: SplitSide) => void
    onSubmitInlineComment: (lineNumber: number, side: SplitSide, onClose: () => void) => void
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    aiThreads?: AiThread[]
    onAskAgent?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    pendingReplies?: PendingReply[]
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
  }

  let {
    file,
    richDiffActive,
    fileContents,
    fileContentError,
    onRetryFileContents,
    canFetchFileContents,
    workerDiffFile,
    diffViewMode,
    diffViewWrap,
    diffViewTheme,
    githubMarkdownImageBaseUrl,
    existingComments,
    pendingComments,
    agentComments,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenUrl,
    onOpenImage,
    onOpenInlineCommentWidget,
    getInlineCommentText,
    onSetInlineCommentText,
    onClearInlineCommentText,
    onSubmitInlineComment,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    aiThreads = [],
    onAskAgent,
    onCommentNow,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    pendingReplies = [],
    onAddReplyToReview,
    onRemovePendingReply,
  }: Props = $props()

  // The diff widget reports a SplitSide; local Q&A anchors use LEFT/RIGHT.
  function sideToReviewSide(side: SplitSide): ReviewSubmissionComment['side'] {
    return side === SplitSide.old ? 'LEFT' : 'RIGHT'
  }

  function buildImageGallery(oldImageSrc: string | null, newImageSrc: string | null): ReviewImage[] {
    const images: ReviewImage[] = []

    if (oldImageSrc) {
      images.push({
        src: oldImageSrc,
        alt: `${file.previous_filename || file.filename} old preview`,
        filename: file.filename,
        label: 'Before',
      })
    }

    if (newImageSrc) {
      images.push({
        src: newImageSrc,
        alt: `${file.filename} new preview`,
        filename: file.filename,
        label: 'After',
      })
    }

    return images
  }
</script>

{#snippet imagePreview(src: string, alt: string, openLabel: string, images: ReviewImage[], activeIndex: number)}
  {#if onOpenImage}
    <button
      type="button"
      class="cursor-zoom-in rounded border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={openLabel}
      onclick={(event) => {
        event.currentTarget.focus()
        onOpenImage?.({ images, activeIndex })
      }}
    >
      <img {src} {alt} class="max-h-96 max-w-full object-contain" />
    </button>
  {:else}
    <img {src} {alt} class="max-h-96 max-w-full object-contain" />
  {/if}
{/snippet}

{#if !file.patch && !isImageFileDiff(file) && file.status === 'renamed' && file.changes === 0}
  <div class="flex items-center justify-center py-8 text-base-content/50">
    <span class="text-xs">File renamed without content changes.</span>
  </div>
{:else if richDiffActive && file.patch}
  <div class="bg-base-100 p-6 text-base-content leading-relaxed" role="region" aria-label="Rich diff for {file.filename}">
    {#if fileContents}
      <MarkdownContent
        content={fileContents.newContent}
        imageBaseUrl={githubMarkdownImageBaseUrl}
        markdownFilePath={file.filename}
        {resolveRepositoryImage}
        {onOpenRepositoryPath}
        {onOpenUrl}
        onOpenImage={onOpenImage ? (image) => onOpenImage({
          activeIndex: 0,
          images: [{ ...image, filename: file.filename, label: 'Rich preview' }],
        }) : undefined}
      />
    {:else if fileContentError}
      <FileContentsError filename={file.filename} error={fileContentError} onRetry={onRetryFileContents} />
    {:else if canFetchFileContents}
      <div
        class="flex min-h-48 items-center justify-center"
        role="status"
        aria-live="polite"
        aria-label="Loading rich diff for {file.filename}"
      >
        <span class="loading loading-spinner loading-sm text-primary" aria-hidden="true"></span>
        <span class="sr-only">Loading rich diff for {file.filename}</span>
      </div>
    {:else}
      <p class="text-sm text-base-content/50">Rich preview unavailable</p>
    {/if}
  </div>
{:else if isImageFileDiff(file)}
  {#if fileContentError}
    <div class="bg-base-100 p-4">
      <FileContentsError filename={file.filename} error={fileContentError} onRetry={onRetryFileContents} />
    </div>
  {:else}
    {@const oldImageSrc = fileContents ? getImagePreviewDataUrl(file.previous_filename || file.filename, fileContents.oldContent) : null}
    {@const newImageSrc = fileContents ? getImagePreviewDataUrl(file.filename, fileContents.newContent) : null}
    {@const imageGallery = buildImageGallery(oldImageSrc, newImageSrc)}
    <div class="grid gap-4 p-4 md:grid-cols-2 bg-base-100">
    {#if file.status !== 'added'}
      <div class="rounded border border-base-300 bg-base-200/40 p-3 min-h-48 flex flex-col">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Before</div>
        <div class="flex flex-1 items-center justify-center overflow-auto">
          {#if oldImageSrc}
            {@render imagePreview(
              oldImageSrc,
              `${file.previous_filename || file.filename} old preview`,
              `Open ${file.filename} before preview`,
              imageGallery,
              imageGallery.findIndex(image => image.label === 'Before'),
            )}
          {:else if fileContents === undefined && canFetchFileContents}
            <span class="loading loading-spinner loading-sm text-primary" aria-label="Loading old image preview"></span>
          {:else}
            <span class="text-sm text-base-content/50">No previous image preview</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if file.status !== 'removed' && file.status !== 'deleted'}
      <div class="rounded border border-base-300 bg-base-200/40 p-3 min-h-48 flex flex-col">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">After</div>
        <div class="flex flex-1 items-center justify-center overflow-auto">
          {#if newImageSrc}
            {@render imagePreview(
              newImageSrc,
              `${file.filename} new preview`,
              `Open ${file.filename} after preview`,
              imageGallery,
              imageGallery.findIndex(image => image.label === 'After'),
            )}
          {:else if fileContents === undefined && canFetchFileContents}
            <span class="loading loading-spinner loading-sm text-primary" aria-label="Loading new image preview"></span>
          {:else}
            <span class="text-sm text-base-content/50">No image preview</span>
          {/if}
        </div>
      </div>
    {/if}
    </div>
  {/if}
{:else if !file.patch && file.status === 'binary'}
  <div class="flex items-center justify-center py-8 text-base-content/50">
    <span class="text-xs">Binary file changes cannot be displayed.</span>
  </div>
{:else if !file.patch}
  <div class="flex items-center justify-center py-8 text-base-content/50">
    <span class="text-xs">Diff unavailable for this file.</span>
  </div>
{:else if workerDiffFile}
  <DiffView
    diffFile={workerDiffFile}
    extendData={buildExtendData(file.filename, existingComments, pendingComments, agentComments, aiThreads, pendingReplies)}
    {diffViewMode}
    {diffViewWrap}
    {diffViewTheme}
    diffViewHighlight={true}
    diffViewAddWidget={true}
    diffViewFontSize={12}
    registerHighlighter={diffHighlighter}
    onAddWidgetClick={onOpenInlineCommentWidget}
  >
    {#snippet renderExtendLine({ data }: { lineNumber: number; side: SplitSide; data: CommentDisplayData; diffFile: DiffFile; onUpdate: () => void })}
      <InlineCommentThread
        {data}
        filename={file.filename}
        {pendingComments}
        {agentComments}
        {onPendingCommentsChange}
        {onAgentCommentsChange}
        {onUpdateAgentCommentStatus}
        {onOpenUrl}
        {onReplyToThread}
        {onAskAboutComment}
        {onReplyToExistingComment}
        {onAddReplyToReview}
        {onRemovePendingReply}
      />
    {/snippet}
    {#snippet renderWidgetLine({ lineNumber, side, onClose }: { lineNumber: number; side: SplitSide; diffFile: DiffFile; onClose: () => void })}
      <InlineCommentForm
        filename={file.filename}
        {lineNumber}
        {side}
        text={getInlineCommentText(lineNumber, side)}
        onTextChange={(text) => onSetInlineCommentText(lineNumber, side, text)}
        onSubmit={() => onSubmitInlineComment(lineNumber, side, onClose)}
        onCancel={() => {
          onClearInlineCommentText(lineNumber, side)
          onClose()
        }}
        onAskAgent={onAskAgent ? (body) => onAskAgent(file.filename, lineNumber, sideToReviewSide(side), body) : undefined}
        onCommentNow={onCommentNow ? (body) => onCommentNow(file.filename, lineNumber, sideToReviewSide(side), body) : undefined}
      />
    {/snippet}
  </DiffView>
{:else}
  <div class="flex items-center justify-center py-8 text-base-content/40">
    <span class="loading loading-spinner loading-sm mr-2"></span>
    <span class="text-xs">Processing diff…</span>
  </div>
{/if}
