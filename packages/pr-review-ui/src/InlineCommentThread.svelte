<script lang="ts">
  import { X } from '@lucide/svelte'
  import type { AgentReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { CommentDisplayData } from './diffComments'
  import InlineAiQuestionThread from './InlineAiQuestionThread.svelte'
  import InlineAiReviewComment from './InlineAiReviewComment.svelte'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineExistingComment from './InlineExistingComment.svelte'

  type DisplayComment = CommentDisplayData['comments'][number]

  interface Props {
    data: CommentDisplayData
    filename: string
    pendingComments: ReviewSubmissionComment[]
    agentComments: AgentReviewComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onOpenUrl?: (url: string) => void | Promise<void>
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
  }

  let {
    data,
    pendingComments,
    agentComments,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onOpenUrl,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    onAddReplyToReview,
    onRemovePendingReply,
  }: Props = $props()

  let threadReplyDrafts = $state<Record<string, string>>({})
  let commentAskDrafts = $state<Record<number, string>>({})
  let askOpenCommentId = $state<number | null>(null)
  let existingReplyDrafts = $state<Record<number, string>>({})
  let replyOpenCommentId = $state<number | null>(null)

  function toggleAskComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    askOpenCommentId = askOpenCommentId === comment.commentId ? null : comment.commentId
  }

  function clearCommentAsk(commentId: number) {
    const next = { ...commentAskDrafts }
    delete next[commentId]
    commentAskDrafts = next
    askOpenCommentId = null
  }

  function toggleExistingReply(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    replyOpenCommentId = replyOpenCommentId === comment.commentId ? null : comment.commentId
  }

  function clearExistingReply(commentId: number) {
    const next = { ...existingReplyDrafts }
    delete next[commentId]
    existingReplyDrafts = next
    replyOpenCommentId = null
  }

  function clearThreadReply(threadId: string) {
    const next = { ...threadReplyDrafts }
    delete next[threadId]
    threadReplyDrafts = next
  }
</script>

<div class="w-full">
  {#each data.comments as comment}
    <div class="{comment.isReply || comment.type === 'pending-reply' ? 'ml-8' : ''} px-4 py-2.5 mx-4 {comment.isReply ? 'mt-0 mb-1.5 border-t-0 rounded-t-none' : 'my-1.5'} bg-base-100 border border-base-300 rounded-md text-[0.8rem] {comment.type === 'pending' || comment.type === 'pending-reply' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : comment.type === 'agent' ? 'border-l-4 border-l-success' : comment.type === 'ai-thread' ? 'border-l-4 border-l-info' : ''}">
      {#if comment.type === 'existing'}
        <InlineExistingComment
          {comment}
          replyOpen={comment.commentId !== undefined && replyOpenCommentId === comment.commentId}
          replyDraft={comment.commentId === undefined ? '' : existingReplyDrafts[comment.commentId] ?? ''}
          onReplyDraftChange={(value) => {
            if (comment.commentId === undefined) return
            existingReplyDrafts = { ...existingReplyDrafts, [comment.commentId]: value }
          }}
          onToggleReply={() => toggleExistingReply(comment)}
          onClearReply={() => {
            if (comment.commentId !== undefined) clearExistingReply(comment.commentId)
          }}
          {onReplyToExistingComment}
          {onAddReplyToReview}
          {onOpenUrl}
        />
      {:else if comment.type === 'agent'}
        <InlineAiReviewComment
          {comment}
          {agentComments}
          askOpen={comment.commentId !== undefined && askOpenCommentId === comment.commentId}
          askDraft={comment.commentId === undefined ? '' : commentAskDrafts[comment.commentId] ?? ''}
          onAskDraftChange={(value) => {
            if (comment.commentId === undefined) return
            commentAskDrafts = { ...commentAskDrafts, [comment.commentId]: value }
          }}
          onToggleAsk={() => toggleAskComment(comment)}
          onAskSubmitted={() => {
            if (comment.commentId !== undefined) clearCommentAsk(comment.commentId)
          }}
          {onAgentCommentsChange}
          onUpdateStatus={onUpdateAgentCommentStatus}
          {onAskAboutComment}
          {onOpenUrl}
        />
      {:else if comment.type === 'ai-thread'}
        {@const threadId = comment.thread?.id}
        <InlineAiQuestionThread
          {comment}
          replyDraft={threadId === undefined ? '' : threadReplyDrafts[threadId] ?? ''}
          onReplyDraftChange={(value) => {
            if (threadId === undefined) return
            threadReplyDrafts = { ...threadReplyDrafts, [threadId]: value }
          }}
          onReplySubmitted={() => {
            if (threadId !== undefined) clearThreadReply(threadId)
          }}
          {onReplyToThread}
          {onOpenUrl}
        />
      {:else if comment.type === 'pending-reply'}
        <div class="flex items-center gap-2 mb-1.5">
          <span class="badge badge-warning badge-sm">Pending reply</span>
          {#if onRemovePendingReply && comment.commentId !== undefined}
            {@const commentId = comment.commentId}
            <button
              class="btn btn-ghost btn-xs text-base-content/50 hover:text-error ml-auto"
              aria-label="Remove pending reply"
              onclick={() => onRemovePendingReply(commentId)}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          {/if}
        </div>
        <InlineCommentBody>
          <MarkdownContent content={comment.body} {onOpenUrl} />
        </InlineCommentBody>
      {:else}
        <div class="flex items-center gap-2 mb-1.5">
          <span class="badge badge-warning badge-sm">Pending</span>
          <button
            class="btn btn-ghost btn-xs text-base-content/50 hover:text-error ml-auto"
            aria-label="Remove pending comment"
            onclick={() => onPendingCommentsChange(pendingComments.filter((_, index) => index !== comment.index))}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <InlineCommentBody>
          <MarkdownContent content={comment.body} {onOpenUrl} />
        </InlineCommentBody>
      {/if}
    </div>
  {/each}
</div>
