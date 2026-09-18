<script lang="ts">
  import type { ReviewThread, ReviewThreadSide, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import type { PrFileDiff, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import { resolvedAgentThreadSubmissions } from './reviewThreadSubmission'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { CoverageFinding } from '../../lib/ticketCoverage'

  interface Props {
    pr: ReviewPullRequest
    files: PrFileDiff[]
    isFinalStep: boolean
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    resolveRepositoryImage: (repositoryPath: string) => Promise<string | null>
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onOpenUrl: (url: string) => void | Promise<void>
    reviewThreads: ReviewThread[]
    onCreateReviewThread?: (filePath: string, line: number, side: ReviewThreadSide, body: string) => void
    onReplyToReviewThread?: (threadId: string, body: string) => void
    onSetReviewThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onMarkReviewThreadSeen?: (threadId: string) => void
    onCommentNow?: (
      filename: string,
      line: number,
      side: ReviewSubmissionComment['side'],
      body: string,
    ) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    pendingReplies: { commentId: number; body: string }[]
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
    includedCoverageFindings: CoverageFinding[]
    onRemoveIncludedFinding: (id: string) => void
    onIncludedFindingsSubmitted: () => void
    onSubmitReview: (request: {
      repoOwner: string
      repoName: string
      prNumber: number
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
      body: string
      comments: ReviewSubmissionComment[]
      commitId: string
    }, submittedReviewThreadIds?: string[]) => Promise<void>
  }

  let {
    pr,
    files,
    isFinalStep,
    fetchFileContents,
    resolveRepositoryImage,
    existingComments,
    pendingComments,
    onPendingCommentsChange,
    onOpenUrl,
    reviewThreads,
    onCreateReviewThread,
    onReplyToReviewThread,
    onSetReviewThreadStatus,
    onMarkReviewThreadSeen,
    onCommentNow,
    onReplyToExistingComment,
    pendingReplies,
    onAddReplyToReview,
    onRemovePendingReply,
    includedCoverageFindings,
    onRemoveIncludedFinding,
    onIncludedFindingsSubmitted,
    onSubmitReview,
  }: Props = $props()

  let diffViewer = $state<DiffViewer>()
  let resolvedAgentSubmissions = $derived(resolvedAgentThreadSubmissions(files, reviewThreads))

  function handleFileSelect(filename: string): void {
    diffViewer?.scrollToFile(filename)
  }

  function submitReview(request: Parameters<Props['onSubmitReview']>[0]): Promise<void> {
    return onSubmitReview(request, resolvedAgentSubmissions.map(submission => submission.threadId))
  }
</script>

<div class="flex flex-1 min-h-0 overflow-hidden">
  <ResizablePanel storageKey="walkthrough-file-tree" defaultWidth={220} minWidth={140} maxWidth={460} side="left">
    <FileTree {files} onSelectFile={handleFileSelect} />
  </ResizablePanel>
  <div class="flex-1 min-w-0 overflow-hidden">
    <DiffViewer
      bind:this={diffViewer}
      {files}
      {existingComments}
      repoOwner={pr.repo_owner}
      repoName={pr.repo_name}
      headSha={pr.head_sha}
      fileTreeVisible={false}
      {fetchFileContents}
      {resolveRepositoryImage}
      {pendingComments}
      {onPendingCommentsChange}
      {onOpenUrl}
      threads={reviewThreads}
      onCreateThread={onCreateReviewThread}
      onReplyToThread={onReplyToReviewThread}
      onSetThreadStatus={onSetReviewThreadStatus}
      onMarkThreadSeen={onMarkReviewThreadSeen}
      {onCommentNow}
      {onReplyToExistingComment}
      {pendingReplies}
      {onAddReplyToReview}
      {onRemovePendingReply}
    >
      {#snippet footer()}
        {#if isFinalStep}
          <ReviewSubmitPanel
            repoOwner={pr.repo_owner}
            repoName={pr.repo_name}
            prNumber={pr.number}
            commitId={pr.head_sha}
            {pendingComments}
            resolvedAgentComments={resolvedAgentSubmissions.map(submission => submission.comment)}
            pendingReplyCount={pendingReplies.length}
            includedFindings={includedCoverageFindings}
            {onPendingCommentsChange}
            {onRemoveIncludedFinding}
            {onIncludedFindingsSubmitted}
            onSubmitReview={submitReview}
          />
        {/if}
      {/snippet}
    </DiffViewer>
  </div>
</div>
