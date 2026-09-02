<script lang="ts">
  import type { DiffFile } from '@git-diff-view/core'
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import type { AgentReviewComment, AiThread, PrFileDiff, ReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import type { MarkdownRepositoryLinkTarget } from '@openforge-app/plugin-sdk/markdown'
  import { buildExtendData, type CommentDisplayData, type PendingReply } from './diffComments'
  import { diffHighlighter } from './diffHighlighter'
  import { getMediaPreviewDataUrl, getVideoMimeType, isMediaFileDiff, isVideoFileDiff, type FileContents, type FileRevisionAvailability } from './diffAdapter'
  import type { OpenReviewMedia, ReviewMedia } from './reviewMedia'
  import InlineCommentForm from './InlineCommentForm.svelte'
  import InlineCommentThread from './InlineCommentThread.svelte'
  import FileContentsError from './FileContentsError.svelte'
  import RichMarkdownDiff from './RichMarkdownDiff.svelte'
  import ReviewVideoPreview from './ReviewVideoPreview.svelte'

  interface Props {
    file: PrFileDiff
    richDiffActive: boolean
    fileContents: FileContents | undefined
    fileContentError: string | undefined
    onRetryFileContents: () => void
    onRequestFileContents?: () => void
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
    onOpenRepositoryPath: (target: MarkdownRepositoryLinkTarget) => void | Promise<void>
    onOpenUrl?: (url: string) => void | Promise<void>
    onOpenMedia?: OpenReviewMedia
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
    onRequestFileContents,
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
    onOpenMedia,
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

  function buildMediaGallery(oldSrc: string | null, newSrc: string | null): ReviewMedia[] {
    const items: ReviewMedia[] = []

    if (oldSrc) {
      const filename = file.previous_filename || file.filename
      items.push({
        kind: getVideoMimeType(filename) ? 'video' : 'image',
        src: oldSrc,
        alt: `${filename} old preview`,
        filename,
        label: 'Before',
      })
    }

    if (newSrc) {
      items.push({
        kind: getVideoMimeType(file.filename) ? 'video' : 'image',
        src: newSrc,
        alt: `${file.filename} new preview`,
        filename: file.filename,
        label: 'After',
      })
    }

    return items
  }

  function formatByteSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`
  }

  function revisionAvailability(content: string, availability: FileRevisionAvailability | undefined): FileRevisionAvailability {
    if (availability) return availability
    return content.length > 0 ? { status: 'available' } : { status: 'missing' }
  }

  $effect(() => {
    if (isVideoFileDiff(file)) onRequestFileContents?.()
  })
</script>

{#snippet mediaPreview(item: ReviewMedia, openLabel: string, items: ReviewMedia[], activeIndex: number)}
  {#if item.kind === 'video'}
    <ReviewVideoPreview {item} />
  {:else if onOpenMedia}
    <button
      type="button"
      class="cursor-zoom-in rounded border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={openLabel}
      onclick={(event) => {
        event.currentTarget.focus()
        onOpenMedia?.({ items, activeIndex })
      }}
    >
      <img src={item.src} alt={item.alt} class="max-h-96 max-w-full object-contain" />
    </button>
  {:else}
    <img src={item.src} alt={item.alt} class="max-h-96 max-w-full object-contain" />
  {/if}
{/snippet}

{#if !file.patch && !isMediaFileDiff(file) && file.status === 'renamed' && file.changes === 0}
  <div class="flex items-center justify-center py-8 text-base-content/50">
    <span class="text-xs">File renamed without content changes.</span>
  </div>
{:else if richDiffActive && file.patch}
  <div class="bg-base-100 p-6 text-base-content leading-relaxed" role="region" aria-label="Rich diff for {file.filename}">
    {#if fileContents}
      <RichMarkdownDiff
        {file}
        appearance={diffViewTheme}
        content={fileContents.newContent}
        imageBaseUrl={githubMarkdownImageBaseUrl}
        {resolveRepositoryImage}
        {onOpenRepositoryPath}
        {onOpenUrl}
        onOpenImage={onOpenMedia ? (image) => onOpenMedia({
          activeIndex: 0,
          items: [{ ...image, kind: 'image', filename: file.filename, label: 'Rich preview' }],
        }) : undefined}
        {existingComments}
        {pendingComments}
        {agentComments}
        {aiThreads}
        {pendingReplies}
        {onPendingCommentsChange}
        {onAgentCommentsChange}
        {onUpdateAgentCommentStatus}
        {onReplyToThread}
        {onAskAboutComment}
        {onReplyToExistingComment}
        {onAddReplyToReview}
        {onRemovePendingReply}
        {getInlineCommentText}
        {onSetInlineCommentText}
        {onClearInlineCommentText}
        {onSubmitInlineComment}
        {onAskAgent}
        {onCommentNow}
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
{:else if isMediaFileDiff(file)}
  {#if fileContentError}
    <div class="bg-base-100 p-4">
      <FileContentsError filename={file.filename} error={fileContentError} onRetry={onRetryFileContents} />
    </div>
  {:else}
    {@const oldContent = fileContents?.oldContent ?? ''}
    {@const newContent = fileContents?.newContent ?? ''}
    {@const oldAvailability = fileContents ? revisionAvailability(oldContent, fileContents.oldAvailability) : undefined}
    {@const newAvailability = fileContents ? revisionAvailability(newContent, fileContents.newAvailability) : undefined}
    {@const oldSrc = getMediaPreviewDataUrl(file.previous_filename || file.filename, oldContent)}
    {@const newSrc = getMediaPreviewDataUrl(file.filename, newContent)}
    {@const mediaGallery = buildMediaGallery(oldSrc, newSrc)}
    <div class="grid gap-4 p-4 md:grid-cols-2 bg-base-100">
      {#if file.status !== 'added'}
        {@const oldItem = mediaGallery.find(item => item.label === 'Before')}
        <div class="rounded border border-base-300 bg-base-200/40 p-3 min-h-48 flex flex-col">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Before</div>
          <div class="flex flex-1 items-center justify-center overflow-auto">
            {#if oldItem}
              {@render mediaPreview(
                oldItem,
                `Open ${file.previous_filename || file.filename} before preview`,
                mediaGallery,
                mediaGallery.indexOf(oldItem),
              )}
            {:else if oldAvailability === undefined && canFetchFileContents}
              <span class="loading loading-spinner loading-sm text-primary" aria-label={isVideoFileDiff(file) ? 'Loading old video preview' : 'Loading old image preview'}></span>
            {:else if oldAvailability?.status === 'too-large'}
              <span class="text-sm text-base-content/60">Video is too large to preview ({formatByteSize(oldAvailability.size)}).</span>
            {:else if oldAvailability?.status === 'load-failed'}
              <FileContentsError filename={file.filename} error={oldAvailability.message} onRetry={onRetryFileContents} />
            {:else}
              <span class="text-sm text-base-content/50">{isVideoFileDiff(file) ? 'No video revision available' : 'No previous image preview'}</span>
            {/if}
          </div>
        </div>
      {/if}
      {#if file.status !== 'removed' && file.status !== 'deleted'}
        {@const newItem = mediaGallery.find(item => item.label === 'After')}
        <div class="rounded border border-base-300 bg-base-200/40 p-3 min-h-48 flex flex-col">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">After</div>
          <div class="flex flex-1 items-center justify-center overflow-auto">
            {#if newItem}
              {@render mediaPreview(
                newItem,
                `Open ${file.filename} after preview`,
                mediaGallery,
                mediaGallery.indexOf(newItem),
              )}
            {:else if newAvailability === undefined && canFetchFileContents}
              <span class="loading loading-spinner loading-sm text-primary" aria-label={isVideoFileDiff(file) ? 'Loading new video preview' : 'Loading new image preview'}></span>
            {:else if newAvailability?.status === 'too-large'}
              <span class="text-sm text-base-content/60">Video is too large to preview ({formatByteSize(newAvailability.size)}).</span>
            {:else if newAvailability?.status === 'load-failed'}
              <FileContentsError filename={file.filename} error={newAvailability.message} onRetry={onRetryFileContents} />
            {:else}
              <span class="text-sm text-base-content/50">{isVideoFileDiff(file) ? 'No video revision available' : 'No image preview'}</span>
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
