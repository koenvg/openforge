<script lang="ts">
  import { CircleCheck, TriangleAlert, X } from '@lucide/svelte'
  import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { composeReviewBody, type IncludedFinding } from './reviewBody'

  type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

  interface SubmitReviewRequest {
    repoOwner: string
    repoName: string
    prNumber: number
    event: ReviewEvent
    body: string
    comments: ReviewSubmissionComment[]
    commitId: string
  }

  interface Props {
    repoOwner: string
    repoName: string
    prNumber: number
    commitId: string
    pendingComments?: ReviewSubmissionComment[]
    /**
     * Approved AI review comments, pre-mapped to submission shape. They are
     * submitted alongside the manual pending comments (approving no longer copies
     * them into the pending list), so they must be counted and posted here too.
     */
    approvedAgentComments?: ReviewSubmissionComment[]
    /** Replies queued for the pending review; counted here, posted by onSubmitReview. */
    pendingReplyCount?: number
    /** Ticket-coverage findings the reviewer flagged to fold into the review body. */
    includedFindings?: IncludedFinding[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    /** Called after a successful submit so the parent can clear the approved AI comments it just posted. */
    onApprovedAgentCommentsSubmitted?: () => void
    onRemoveIncludedFinding?: (id: string) => void
    /** Called after a successful submit so the parent can clear the findings it just posted. */
    onIncludedFindingsSubmitted?: () => void
    onSubmitReview: (request: SubmitReviewRequest) => Promise<void>
  }

  let {
    repoOwner,
    repoName,
    prNumber,
    commitId,
    pendingComments = [],
    approvedAgentComments = [],
    pendingReplyCount = 0,
    includedFindings = [],
    onPendingCommentsChange,
    onApprovedAgentCommentsSubmitted,
    onRemoveIncludedFinding,
    onIncludedFindingsSubmitted,
    onSubmitReview,
  }: Props = $props()

  // Everything that will be posted with the review: manual pending comments plus
  // approved AI review comments.
  let submissionComments = $derived([...pendingComments, ...approvedAgentComments])
  // Total items that submit will post, including queued replies (posted separately).
  let totalPendingCount = $derived(submissionComments.length + pendingReplyCount)

  let summary = $state('')
  let isSubmitting = $state(false)
  let error = $state<string | null>(null)
  let successMessage = $state<string | null>(null)
  let selectedEvent = $state<ReviewEvent>('COMMENT')

  // Flagged findings alone are a valid reason to submit even with an empty typed summary.
  let canSubmit = $derived(!isSubmitting && (summary.trim() !== '' || totalPendingCount > 0 || includedFindings.length > 0))
  let canApprove = $derived(!isSubmitting)

  async function handleSubmit(event: ReviewEvent) {
    const allowed = event === 'APPROVE' ? canApprove : canSubmit
    if (!allowed) return

    isSubmitting = true
    error = null
    successMessage = null

    try {
      await onSubmitReview({
        repoOwner,
        repoName,
        prNumber,
        event,
        body: composeReviewBody(includedFindings, summary),
        comments: submissionComments,
        commitId,
      })

      onPendingCommentsChange([])
      onApprovedAgentCommentsSubmitted?.()
      onIncludedFindingsSubmitted?.()
      summary = ''
      successMessage = `Review submitted successfully (${event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes Requested' : 'Commented'})`

      setTimeout(() => {
        successMessage = null
      }, 3000)
    } catch (e) {
      console.error('Failed to submit review:', e)
      error = 'Failed to submit review. Please try again.'
    } finally {
      isSubmitting = false
    }
  }

  function handleCommentClick() {
    selectedEvent = 'COMMENT'
    handleSubmit('COMMENT')
  }

  function handleApproveClick() {
    selectedEvent = 'APPROVE'
    handleSubmit('APPROVE')
  }

  function handleRequestChangesClick() {
    selectedEvent = 'REQUEST_CHANGES'
    handleSubmit('REQUEST_CHANGES')
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleCommentClick()
    }
  }
</script>

<div class="flex flex-col shrink-0 bg-base-200 border-t border-base-300">
  <div class="flex items-center justify-between px-6 py-4 pb-3 border-b border-base-300">
    <h3 class="text-[0.9rem] font-semibold text-base-content m-0">Submit Review</h3>
    {#if totalPendingCount > 0}
      <span class="inline-flex items-center px-2.5 py-1 text-[0.7rem] font-semibold text-warning bg-warning/15 rounded-full">{totalPendingCount} comment{totalPendingCount === 1 ? '' : 's'} will be submitted</span>
    {/if}
  </div>

  <div class="flex flex-col gap-3 px-6 py-4">
    {#if includedFindings.length > 0}
      <div class="flex flex-col gap-1.5">
        {#each includedFindings as finding (finding.id)}
          <div class="flex items-start gap-2 pl-3 pr-1.5 py-1.5 bg-warning/10 border border-warning/30 rounded-md">
            <span class="badge badge-sm badge-warning shrink-0 mt-0.5">{finding.label}</span>
            <span class="flex-1 text-[0.8rem] text-base-content leading-snug">{finding.text}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square shrink-0"
              onclick={() => onRemoveIncludedFinding?.(finding.id)}
              title="Remove from review"
              aria-label={`Remove "${finding.label}" from review`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
    <label for="review-summary-comment" class="text-xs font-medium text-base-content/70">Review summary comment</label>
    <textarea
      id="review-summary-comment"
      class="textarea textarea-bordered w-full min-h-[70px] text-[0.85rem] leading-relaxed resize-y disabled:opacity-60 disabled:cursor-not-allowed"
      placeholder="Leave a summary comment… (Cmd/Ctrl+Enter to submit)"
      aria-describedby="review-summary-comment-help"
      rows="3"
      bind:value={summary}
      disabled={isSubmitting}
      onkeydown={handleKeydown}
    ></textarea>
    <p id="review-summary-comment-help" class="text-xs text-base-content/50 m-0">Submit with Command+Enter or Control+Enter. A summary is required for comments and change requests unless you have pending inline comments or flagged findings.</p>

    {#if error}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-error text-[0.8rem]" role="alert" aria-live="assertive">
        <TriangleAlert size={16} strokeWidth={1.8} class="shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    {/if}

    {#if successMessage}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-success/10 border border-success/30 rounded-md text-success text-[0.8rem]" role="status" aria-live="polite">
        <CircleCheck size={16} strokeWidth={1.8} class="shrink-0" aria-hidden="true" />
        <span>{successMessage}</span>
      </div>
    {/if}

    <div class="flex gap-2.5 justify-end">
      <button
        class="btn btn-sm border border-base-300 hover:border-primary hover:text-primary"
        onclick={handleCommentClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selectedEvent === 'COMMENT' ? 'Submitting...' : 'Comment'}
      </button>
      <Button
        size="sm"
        onclick={handleApproveClick}
        disabled={!canApprove}
      >
        {isSubmitting && selectedEvent === 'APPROVE' ? 'Submitting...' : 'Approve'}
      </Button>
      <button
        class="btn btn-sm btn-error"
        onclick={handleRequestChangesClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selectedEvent === 'REQUEST_CHANGES' ? 'Submitting...' : 'Request Changes'}
      </button>
    </div>
  </div>
</div>
