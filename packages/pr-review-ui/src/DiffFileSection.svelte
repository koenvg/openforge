<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
  import Alert from '@openforge-app/plugin-sdk/ui/Alert.svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import { getTruncationStats, isTruncated } from './diffAdapter'
  import DiffFileContent from './DiffFileContent.svelte'
  import DiffFileHeader from './DiffFileHeader.svelte'

  type ContentProps = Omit<ComponentProps<typeof DiffFileContent>, 'file' | 'richDiffActive'>

  interface SectionProps {
    file: PrFileDiff
    collapsed: boolean
    richDiffSupported: boolean
    richDiffActive: boolean
    reviewed: boolean
    pendingCommentCount: number
    fileHeaderExtra?: Snippet<[PrFileDiff]>
    onCopyFilePath?: (filename: string) => void
    onToggleCollapse: () => void
    onSetRichDiffActive: (active: boolean) => void
    onReviewedChange?: (reviewed: boolean) => void
  }

  type Props = SectionProps & ContentProps

  let {
    file,
    collapsed,
    richDiffSupported,
    richDiffActive,
    reviewed,
    pendingCommentCount,
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
    fileHeaderExtra,
    onCopyFilePath,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenUrl,
    onOpenMedia,
    onToggleCollapse,
    onSetRichDiffActive,
    onReviewedChange,
    onOpenInlineCommentWidget,
    getInlineCommentText,
    onSetInlineCommentText,
    onClearInlineCommentText,
    onSubmitInlineComment,
    onPendingCommentsChange,
    onCommentNow,
    threads,
    onCreateThread,
    onReplyToThread,
    onSetThreadStatus,
    onMarkThreadSeen,
    onReplyToExistingComment,
    pendingReplies,
    onAddReplyToReview,
    onRemovePendingReply,
  }: Props = $props()

  const truncated = $derived(isTruncated(file))
  const truncationStats = $derived(getTruncationStats(file))
</script>

<div class="border border-of-border rounded-[var(--of-diff-section-radius,var(--of-radius-container))]" style="border-top-width: var(--of-diff-section-top-border-width, 1px)">
  <DiffFileHeader
    {file}
    {collapsed}
    {richDiffSupported}
    {richDiffActive}
    {reviewed}
    {pendingCommentCount}
    {fileHeaderExtra}
    {onCopyFilePath}
    {onToggleCollapse}
    {onSetRichDiffActive}
    {onReviewedChange}
  />
  {#if !collapsed}
    {#if truncated}
      <Alert variant="info" style="padding: 0.375rem 1rem; border-inline-width: 0; border-radius: 0; font-size: 0.75rem; line-height: 1rem">
        <span>
          Diff truncated — {truncationStats ? `${truncationStats.total} lines total, showing first ${truncationStats.shown}` : 'showing partial diff'}
        </span>
      </Alert>
    {/if}
    <DiffFileContent
      {file}
      {richDiffActive}
      {fileContents}
      {fileContentError}
      {onRetryFileContents}
      {onRequestFileContents}
      {canFetchFileContents}
      {workerDiffFile}
      {diffViewMode}
      {diffViewWrap}
      {diffViewTheme}
      {githubMarkdownImageBaseUrl}
      {existingComments}
      {pendingComments}
      {resolveRepositoryImage}
      {onOpenRepositoryPath}
      {onOpenUrl}
      {onOpenMedia}
      {onOpenInlineCommentWidget}
      {getInlineCommentText}
      {onSetInlineCommentText}
      {onClearInlineCommentText}
      {onSubmitInlineComment}
      {onPendingCommentsChange}
      {onCommentNow}
      {threads}
      {onCreateThread}
      {onReplyToThread}
      {onSetThreadStatus}
      {onMarkThreadSeen}
      {onReplyToExistingComment}
      {pendingReplies}
      {onAddReplyToReview}
      {onRemovePendingReply}
    />
  {/if}
</div>
