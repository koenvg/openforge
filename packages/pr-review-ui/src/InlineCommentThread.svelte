<script lang="ts">
  import { Check, Reply, X } from '@lucide/svelte'
  import type { AgentReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { CommentDisplayData } from './diffComments'
  import { timeAgo } from './timeAgo'

  type DisplayComment = CommentDisplayData['comments'][number]

  interface Props {
    data: CommentDisplayData
    filename: string
    pendingComments: ReviewSubmissionComment[]
    agentComments: AgentReviewComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed') => Promise<void> | void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    data,
    filename,
    pendingComments,
    agentComments,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onOpenUrl,
  }: Props = $props()

  async function approveAgentComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    try {
      await onUpdateAgentCommentStatus?.(comment.commentId, 'approved')
      onPendingCommentsChange([...pendingComments, {
        path: comment.filePath || filename,
        line: comment.lineNumber || 0,
        side: (comment.commentSide || 'RIGHT') as ReviewSubmissionComment['side'],
        body: comment.body,
      }])
      onAgentCommentsChange(agentComments.map(agentComment =>
        agentComment.id === comment.commentId ? { ...agentComment, status: 'approved' } : agentComment
      ))
    } catch (error) {
      console.error('[DiffViewer] Failed to approve comment:', error)
    }
  }

  async function dismissAgentComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    try {
      await onUpdateAgentCommentStatus?.(comment.commentId, 'dismissed')
      onAgentCommentsChange(agentComments.map(agentComment =>
        agentComment.id === comment.commentId ? { ...agentComment, status: 'dismissed' } : agentComment
      ))
    } catch (error) {
      console.error('[DiffViewer] Failed to dismiss comment:', error)
    }
  }
</script>

<div class="w-full">
  {#each data.comments as comment}
    <div class="{comment.isReply ? 'ml-8' : ''} px-4 py-2.5 mx-4 {comment.isReply ? 'mt-0 mb-1.5 border-t-0 rounded-t-none' : 'my-1.5'} bg-base-100 border border-base-300 rounded-md text-[0.8rem] {comment.type === 'pending' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : comment.type === 'agent' ? 'border-l-4 border-l-success' : ''}">
      <div class="flex items-center gap-2 mb-1.5">
        {#if comment.type === 'existing'}
          <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
            {(comment.author ?? '?').charAt(0).toUpperCase()}
          </div>
          <strong class="text-base-content font-semibold text-xs">{comment.author}</strong>
          {#if comment.createdAt}
            <span class="text-base-content/50 text-[0.7rem]">{timeAgo(new Date(comment.createdAt).getTime())}</span>
          {/if}
          {#if comment.isReply}
            <span class="inline-flex items-center gap-1 text-base-content/30 text-[0.65rem]">
              <Reply size={12} strokeWidth={1.8} aria-hidden="true" />
              reply
            </span>
          {/if}
        {:else if comment.type === 'agent'}
          <span class="badge badge-success badge-sm">AI Review</span>
          {#if comment.status === 'approved'}
            <span class="badge badge-info badge-sm">Approved</span>
          {/if}
          <div class="ml-auto flex gap-1">
            {#if comment.status !== 'approved'}
              <button
                class="btn btn-ghost btn-xs text-success hover:text-success/80"
                title="Approve — add to pending comments"
                aria-label="Approve AI review comment and add to pending comments"
                onclick={() => approveAgentComment(comment)}
              >
                <Check size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            {/if}
            <button
              class="btn btn-ghost btn-xs text-base-content/50 hover:text-error"
              title="Dismiss"
              aria-label="Dismiss AI review comment"
              onclick={() => dismissAgentComment(comment)}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {:else}
          <span class="badge badge-warning badge-sm">Pending</span>
          <button
            class="btn btn-ghost btn-xs text-base-content/50 hover:text-error ml-auto"
            aria-label="Remove pending comment"
            onclick={() => onPendingCommentsChange(pendingComments.filter((_, index) => index !== comment.index))}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        {/if}
      </div>
      <div class="text-base-content leading-relaxed text-[0.8rem] [&_p]:m-0 [&_p+p]:mt-1.5 [&_pre]:text-[0.75rem] [&_code]:text-[0.75rem] [&_pre]:bg-base-200 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1.5 [&_code]:bg-base-200 [&_code]:px-1 [&_code]:rounded [&_ul]:my-1 [&_ol]:my-1 [&_li]:ml-4 [&_blockquote]:border-l-2 [&_blockquote]:border-base-300 [&_blockquote]:pl-3 [&_blockquote]:text-base-content/70 [&_a]:text-primary [&_a]:underline">
        <MarkdownContent content={comment.body} {onOpenUrl} />
      </div>
    </div>
  {/each}
</div>
