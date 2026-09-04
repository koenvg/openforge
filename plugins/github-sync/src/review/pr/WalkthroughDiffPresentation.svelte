<script lang="ts">
  import type {
    AgentReviewComment,
    AiThread,
    PrFileDiff,
    ReviewComment,
    ReviewPullRequest,
    ReviewSubmissionComment,
  } from '@openforge-app/plugin-sdk/domain'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import {
    agentCommentToSubmission,
    approvedInlineAgentComments,
  } from '@openforge-app/pr-review-ui/diffComments'
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
    agentComments: AgentReviewComment[]
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus: (
      commentId: number,
      status: 'approved' | 'dismissed' | 'pending',
    ) => Promise<void> | void
    onOpenUrl: (url: string) => void | Promise<void>
    aiThreads: AiThread[]
    onAskAgent?: (
      filename: string,
      line: number,
      side: ReviewSubmissionComment['side'],
      body: string,
    ) => void
    onCommentNow?: (
      filename: string,
      line: number,
      side: ReviewSubmissionComment['side'],
      body: string,
    ) => void
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: {
      commentId: number
      filename: string
      line: number
      side: 'LEFT' | 'RIGHT'
      body: string
    }) => void
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
    }) => Promise<void>
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
    agentComments,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onOpenUrl,
    aiThreads,
    onAskAgent,
    onCommentNow,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    pendingReplies,
    onAddReplyToReview,
    onRemovePendingReply,
    includedCoverageFindings,
    onRemoveIncludedFinding,
    onIncludedFindingsSubmitted,
    onSubmitReview,
  }: Props = $props()

  let activeFilename = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let approvedAgentSubmissionComments = $derived(
    approvedInlineAgentComments(agentComments).map(agentCommentToSubmission),
  )

  function handleFileSelect(filename: string): void {
    activeFilename = filename
    diffViewer?.scrollToFile(filename)
  }

  function handleApprovedAgentCommentsSubmitted(): void {
    const submitted = approvedInlineAgentComments(agentComments)
    if (submitted.length === 0) return
    const submittedIds = new Set(submitted.map(comment => comment.id))
    for (const comment of submitted) void onUpdateAgentCommentStatus(comment.id, 'dismissed')
    onAgentCommentsChange(
      agentComments.map(comment =>
        submittedIds.has(comment.id) ? { ...comment, status: 'dismissed' } : comment,
      ),
    )
  }

  $effect(() => {
    if (!files.length) {
      activeFilename = null
      return
    }
    if (!activeFilename || !files.some(file => file.filename === activeFilename)) {
      activeFilename = files[0].filename
    }
  })
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
      {agentComments}
      {pendingComments}
      {onPendingCommentsChange}
      {onAgentCommentsChange}
      {onUpdateAgentCommentStatus}
      {onOpenUrl}
      {aiThreads}
      {onAskAgent}
      {onCommentNow}
      {onReplyToThread}
      {onAskAboutComment}
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
            approvedAgentComments={approvedAgentSubmissionComments}
            pendingReplyCount={pendingReplies.length}
            includedFindings={includedCoverageFindings}
            {onPendingCommentsChange}
            onApprovedAgentCommentsSubmitted={handleApprovedAgentCommentsSubmitted}
            {onRemoveIncludedFinding}
            {onIncludedFindingsSubmitted}
            {onSubmitReview}
          />
        {/if}
      {/snippet}
    </DiffViewer>
  </div>
</div>
