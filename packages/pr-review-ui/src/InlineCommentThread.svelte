<script lang="ts">
  import { X } from '@lucide/svelte'
  import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import type { ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import type { CommentDisplayData, ExistingCommentDisplayData } from './diffComments'
  import InlineReviewThread from './InlineReviewThread.svelte'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineExistingComment from './InlineExistingComment.svelte'

  interface Props {
    data: CommentDisplayData
    pendingComments: ReviewSubmissionComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onOpenUrl?: (url: string) => void | Promise<void>
    onReplyToThread?: (threadId: string, body: string) => void
    onSetThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onMarkThreadSeen?: (threadId: string) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void | Promise<void>
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
  }

  let {
    data,
    pendingComments,
    onPendingCommentsChange,
    onOpenUrl,
    onReplyToThread,
    onSetThreadStatus,
    onMarkThreadSeen,
    onReplyToExistingComment,
    onAddReplyToReview,
    onRemovePendingReply,
  }: Props = $props()

  let existingReplyDrafts = $state<Record<number, string>>({})
  let replyOpenCommentId = $state<number | null>(null)

  function toggleExistingReply(comment: ExistingCommentDisplayData) {
    if (comment.isReply) return
    replyOpenCommentId = replyOpenCommentId === comment.commentId ? null : comment.commentId
  }

  function clearExistingReply(commentId: number) {
    const next = { ...existingReplyDrafts }
    delete next[commentId]
    existingReplyDrafts = next
    replyOpenCommentId = null
  }
</script>

<div class="w-full">
  {#each data.comments as comment}
    {@const isNested = comment.type === 'pending-reply' || (comment.type === 'existing' && comment.isReply)}
    {@const isConnectedReply = comment.type === 'existing' && comment.isReply}
    <div class="{isNested ? 'ml-8' : ''} px-4 py-2.5 mx-4 {isConnectedReply ? 'mt-0 mb-1.5' : 'my-1.5'} text-[0.8rem] {comment.type === 'pending' || comment.type === 'pending-reply' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : comment.type === 'thread' ? 'border-l-4 border-l-info' : ''}">
      {#if comment.type === 'existing'}
        <InlineExistingComment
          {comment}
          replyOpen={!comment.isReply && replyOpenCommentId === comment.commentId}
          replyDraft={comment.isReply ? '' : existingReplyDrafts[comment.commentId] ?? ''}
          onReplyDraftChange={(value) => {
            if (comment.isReply) return
            existingReplyDrafts = { ...existingReplyDrafts, [comment.commentId]: value }
          }}
          onToggleReply={() => toggleExistingReply(comment)}
          onClearReply={() => {
            if (!comment.isReply) clearExistingReply(comment.commentId)
          }}
          {onReplyToExistingComment}
          {onAddReplyToReview}
          {onOpenUrl}
        />
      {:else if comment.type === 'thread'}
        <InlineReviewThread {comment} {onReplyToThread} {onSetThreadStatus} {onMarkThreadSeen} {onOpenUrl} />
      {:else if comment.type === 'pending-reply'}
        <div class="flex items-center gap-2 mb-1.5">
          <Badge variant="warning">Pending reply</Badge>
          {#if onRemovePendingReply}
            {@const commentId = comment.commentId}
            <IconButton
              label="Remove pending reply"
              size="xs"
              class="ml-auto"
              onclick={() => onRemovePendingReply(commentId)}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          {/if}
        </div>
        <InlineCommentBody>
          <MarkdownContent content={comment.body} {onOpenUrl} />
        </InlineCommentBody>
      {:else}
        <div class="flex items-center gap-2 mb-1.5">
          <Badge variant="warning">Pending</Badge>
          <IconButton
            label="Remove pending comment"
            size="xs"
            class="ml-auto"
            onclick={() => onPendingCommentsChange(pendingComments.filter((_, index) => index !== comment.index))}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
        <InlineCommentBody>
          <MarkdownContent content={comment.body} {onOpenUrl} />
        </InlineCommentBody>
      {/if}
    </div>
  {/each}
</div>
