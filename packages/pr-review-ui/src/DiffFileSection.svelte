<script lang="ts">
  import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
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
    canFetchFileContents,
    workerDiffFile,
    diffViewMode,
    diffViewWrap,
    diffViewTheme,
    githubMarkdownImageBaseUrl,
    existingComments,
    pendingComments,
    agentComments,
    fileHeaderExtra,
    onCopyFilePath,
    resolveRepositoryImage,
    onOpenRepositoryPath,
    onOpenUrl,
    onOpenImage,
    onToggleCollapse,
    onSetRichDiffActive,
    onReviewedChange,
    onOpenInlineCommentWidget,
    getInlineCommentText,
    onSetInlineCommentText,
    onClearInlineCommentText,
    onSubmitInlineComment,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    aiThreads,
    onAskAgent,
    onCommentNow,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    pendingReplies,
    onAddReplyToReview,
    onRemovePendingReply,
  }: Props = $props()

  const truncated = $derived(isTruncated(file))
  const truncationStats = $derived(getTruncationStats(file))
</script>

<div class="border border-base-300 rounded-md">
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
      <div class="alert alert-info py-1.5 px-4 rounded-none border-x-0 text-xs">
        <span>
          Diff truncated — {truncationStats ? `${truncationStats.total} lines total, showing first ${truncationStats.shown}` : 'showing partial diff'}
        </span>
      </div>
    {/if}
    <DiffFileContent
      {file}
      {richDiffActive}
      {fileContents}
      {fileContentError}
      {onRetryFileContents}
      {canFetchFileContents}
      {workerDiffFile}
      {diffViewMode}
      {diffViewWrap}
      {diffViewTheme}
      {githubMarkdownImageBaseUrl}
      {existingComments}
      {pendingComments}
      {agentComments}
      {resolveRepositoryImage}
      {onOpenRepositoryPath}
      {onOpenUrl}
      {onOpenImage}
      {onOpenInlineCommentWidget}
      {getInlineCommentText}
      {onSetInlineCommentText}
      {onClearInlineCommentText}
      {onSubmitInlineComment}
      {onPendingCommentsChange}
      {onAgentCommentsChange}
      {onUpdateAgentCommentStatus}
      {aiThreads}
      {onAskAgent}
      {onCommentNow}
      {onReplyToThread}
      {onAskAboutComment}
      {onReplyToExistingComment}
      {pendingReplies}
      {onAddReplyToReview}
      {onRemovePendingReply}
    />
  {/if}
</div>
