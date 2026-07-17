<script lang="ts">
  import type { DiffFile } from '@git-diff-view/core'
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import type { AgentReviewComment, PrFileDiff, ReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import { buildExtendData, type CommentDisplayData } from './diffComments'
  import { diffHighlighter } from './diffHighlighter'
  import { getImagePreviewDataUrl, isImageFileDiff, type FileContents } from './diffAdapter'
  import InlineCommentForm from './InlineCommentForm.svelte'
  import InlineCommentThread from './InlineCommentThread.svelte'

  interface Props {
    file: PrFileDiff
    richDiffActive: boolean
    fileContents: FileContents | undefined
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
    onOpenInlineCommentWidget: (lineNumber: number, side: SplitSide) => void
    getInlineCommentText: (lineNumber: number, side: SplitSide) => string
    onSetInlineCommentText: (lineNumber: number, side: SplitSide, text: string) => void
    onClearInlineCommentText: (lineNumber: number, side: SplitSide) => void
    onSubmitInlineComment: (lineNumber: number, side: SplitSide, onClose: () => void) => void
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed') => Promise<void> | void
  }

  let {
    file,
    richDiffActive,
    fileContents,
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
    onOpenInlineCommentWidget,
    getInlineCommentText,
    onSetInlineCommentText,
    onClearInlineCommentText,
    onSubmitInlineComment,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
  }: Props = $props()
</script>

{#if richDiffActive}
  <div class="bg-base-100 p-6 text-base-content leading-relaxed" role="region" aria-label="Rich diff for {file.filename}">
    {#if fileContents}
      <MarkdownContent
        content={fileContents.newContent}
        imageBaseUrl={githubMarkdownImageBaseUrl}
        markdownFilePath={file.filename}
        {resolveRepositoryImage}
        {onOpenRepositoryPath}
        {onOpenUrl}
      />
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
  {@const oldImageSrc = fileContents ? getImagePreviewDataUrl(file.previous_filename || file.filename, fileContents.oldContent) : null}
  {@const newImageSrc = fileContents ? getImagePreviewDataUrl(file.filename, fileContents.newContent) : null}
  <div class="grid gap-4 p-4 md:grid-cols-2 bg-base-100">
    {#if file.status !== 'added'}
      <div class="rounded border border-base-300 bg-base-200/40 p-3 min-h-48 flex flex-col">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Before</div>
        <div class="flex flex-1 items-center justify-center overflow-auto">
          {#if oldImageSrc}
            <img src={oldImageSrc} alt={`${file.previous_filename || file.filename} old preview`} class="max-h-96 max-w-full object-contain" />
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
            <img src={newImageSrc} alt={`${file.filename} new preview`} class="max-h-96 max-w-full object-contain" />
          {:else if fileContents === undefined && canFetchFileContents}
            <span class="loading loading-spinner loading-sm text-primary" aria-label="Loading new image preview"></span>
          {:else}
            <span class="text-sm text-base-content/50">No image preview</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{:else if workerDiffFile}
  <DiffView
    diffFile={workerDiffFile}
    extendData={buildExtendData(file.filename, existingComments, pendingComments, agentComments)}
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
      />
    {/snippet}
  </DiffView>
{:else}
  <div class="flex items-center justify-center py-8 text-base-content/40">
    <span class="loading loading-spinner loading-sm mr-2"></span>
    <span class="text-xs">Processing diff…</span>
  </div>
{/if}
