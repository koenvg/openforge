<script lang="ts">
  import { Check, MessageCircleQuestion, Reply, Undo2, X } from '@lucide/svelte'
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
    onUpdateAgentCommentStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onOpenUrl?: (url: string) => void | Promise<void>
    onReplyToThread?: (threadId: string, body: string) => void
    /** Ask the agent a follow-up question about a specific AI review comment. */
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    /** Post a threaded reply to an existing GitHub review comment. */
    onReplyToExistingComment?: (commentId: number, body: string) => void
    /** Queue a reply for the pending review instead of posting it now. */
    onAddReplyToReview?: (commentId: number, body: string) => void
    /** Remove a queued (pending) reply. */
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

  // Per-thread reply drafts for answered AI Q&A threads, keyed by thread id.
  let threadReplyDrafts = $state<Record<string, string>>({})

  // "Ask the agent about this comment" drafts, keyed by AI review comment id, plus
  // which comment currently has its ask input open (one at a time).
  let commentAskDrafts = $state<Record<number, string>>({})
  let askOpenCommentId = $state<number | null>(null)

  function toggleAskComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    askOpenCommentId = askOpenCommentId === comment.commentId ? null : comment.commentId
  }

  function submitCommentAsk(comment: DisplayComment) {
    if (comment.commentId === undefined || comment.filePath === undefined || comment.lineNumber === undefined) return
    const body = (commentAskDrafts[comment.commentId] ?? '').trim()
    if (!body) return
    const side = comment.commentSide === 'LEFT' ? 'LEFT' : 'RIGHT'
    onAskAboutComment?.({ commentId: comment.commentId, filename: comment.filePath, line: comment.lineNumber, side, body })
    const next = { ...commentAskDrafts }
    delete next[comment.commentId]
    commentAskDrafts = next
    askOpenCommentId = null
  }

  // Threaded replies to existing GitHub comments, keyed by the parent comment id.
  let existingReplyDrafts = $state<Record<number, string>>({})
  let replyOpenCommentId = $state<number | null>(null)

  function toggleExistingReply(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    replyOpenCommentId = replyOpenCommentId === comment.commentId ? null : comment.commentId
  }

  function submitExistingReply(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    const body = (existingReplyDrafts[comment.commentId] ?? '').trim()
    if (!body) return
    onReplyToExistingComment?.(comment.commentId, body)
    clearReplyDraft(comment.commentId)
  }

  function addReplyToReview(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    const body = (existingReplyDrafts[comment.commentId] ?? '').trim()
    if (!body) return
    onAddReplyToReview?.(comment.commentId, body)
    clearReplyDraft(comment.commentId)
  }

  function clearReplyDraft(commentId: number) {
    const next = { ...existingReplyDrafts }
    delete next[commentId]
    existingReplyDrafts = next
    replyOpenCommentId = null
  }

  function submitThreadReply(threadId: string) {
    const body = (threadReplyDrafts[threadId] ?? '').trim()
    if (!body) return
    onReplyToThread?.(threadId, body)
    const next = { ...threadReplyDrafts }
    delete next[threadId]
    threadReplyDrafts = next
  }

  // Approving marks the AI comment 'approved' in place — it is NOT copied into
  // the manual pending list. The approved comment is itself the submittable item
  // (ReviewSubmitPanel pulls approved comments straight in), so there is one box,
  // not a duplicate pending copy.
  async function approveAgentComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    try {
      await onUpdateAgentCommentStatus?.(comment.commentId, 'approved')
      onAgentCommentsChange(agentComments.map(agentComment =>
        agentComment.id === comment.commentId ? { ...agentComment, status: 'approved' } : agentComment
      ))
    } catch (error) {
      console.error('[DiffViewer] Failed to approve comment:', error)
    }
  }

  // Un-approve returns an approved comment to 'pending' so it drops out of the
  // review submission again while staying visible in the AI review list.
  async function unapproveAgentComment(comment: DisplayComment) {
    if (comment.commentId === undefined) return
    try {
      await onUpdateAgentCommentStatus?.(comment.commentId, 'pending')
      onAgentCommentsChange(agentComments.map(agentComment =>
        agentComment.id === comment.commentId ? { ...agentComment, status: 'pending' } : agentComment
      ))
    } catch (error) {
      console.error('[DiffViewer] Failed to un-approve comment:', error)
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
    <div class="{comment.isReply || comment.type === 'pending-reply' ? 'ml-8' : ''} px-4 py-2.5 mx-4 {comment.isReply ? 'mt-0 mb-1.5 border-t-0 rounded-t-none' : 'my-1.5'} bg-base-100 border border-base-300 rounded-md text-[0.8rem] {comment.type === 'pending' || comment.type === 'pending-reply' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : comment.type === 'agent' ? 'border-l-4 border-l-success' : comment.type === 'ai-thread' ? 'border-l-4 border-l-info' : ''}">
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
          {#if onReplyToExistingComment && !comment.isReply && comment.commentId !== undefined}
            <button
              class="btn btn-ghost btn-xs text-base-content/50 hover:text-primary ml-auto"
              title="Reply on GitHub"
              aria-label="Reply to this comment"
              onclick={() => toggleExistingReply(comment)}
            >
              <Reply size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          {/if}
        {:else if comment.type === 'agent'}
          <span class="badge badge-success badge-sm">AI Review</span>
          {#if comment.status === 'approved'}
            <span class="badge badge-info badge-sm">Approved</span>
          {/if}
          <div class="ml-auto flex gap-1">
            {#if comment.status === 'approved'}
              <button
                class="btn btn-ghost btn-xs text-base-content/60 hover:text-base-content"
                title="Un-approve — remove from this review"
                aria-label="Un-approve AI review comment"
                onclick={() => unapproveAgentComment(comment)}
              >
                <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            {:else}
              <button
                class="btn btn-ghost btn-xs text-success hover:text-success/80"
                title="Approve — include in this review"
                aria-label="Approve AI review comment"
                onclick={() => approveAgentComment(comment)}
              >
                <Check size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            {/if}
            {#if onAskAboutComment}
              <button
                class="btn btn-ghost btn-xs text-info hover:text-info/80"
                title="Ask the agent about this suggestion"
                aria-label="Ask the agent about this AI review comment"
                onclick={() => toggleAskComment(comment)}
              >
                <MessageCircleQuestion size={14} strokeWidth={2} aria-hidden="true" />
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
        {:else if comment.type === 'ai-thread'}
          <span class="badge badge-info badge-sm">Ask the AI</span>
          {#if comment.thread?.status === 'pending'}
            <span class="loading loading-spinner loading-xs"></span>
            <span class="text-base-content/50 text-[0.7rem]">thinking…</span>
          {/if}
          {#if comment.thread?.status === 'error'}
            <span class="text-error text-[0.7rem]">failed — send again</span>
          {/if}
        {:else if comment.type === 'pending-reply'}
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
        {#if comment.type === 'ai-thread' && comment.thread}
          {#each comment.thread.messages as message}
            <div class="mb-1.5">
              <span class="text-base-content/50 text-[0.7rem] mr-1 {message.role === 'user' ? 'font-semibold' : ''}">{message.role === 'ai' ? 'AI author' : 'You'}</span>
              <span class="[&_p]:m-0 [&_p]:inline"><MarkdownContent content={message.body} {onOpenUrl} /></span>
            </div>
          {/each}
          {#if comment.thread.status === 'answered'}
            {@const threadId = comment.thread.id}
            <div class="flex gap-2 mt-1">
              <input
                class="input input-bordered input-xs flex-1"
                aria-label="Reply to the AI author"
                placeholder="Reply…"
                value={threadReplyDrafts[threadId] ?? ''}
                oninput={(event) => {
                  if (!(event.currentTarget instanceof HTMLInputElement)) return
                  threadReplyDrafts = { ...threadReplyDrafts, [threadId]: event.currentTarget.value }
                }}
                onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitThreadReply(threadId) } }}
              />
              <button type="button" class="btn btn-xs btn-primary" onclick={() => submitThreadReply(threadId)}>Reply</button>
            </div>
          {/if}
        {:else}
          <MarkdownContent content={comment.body} {onOpenUrl} />
          {#if comment.type === 'agent' && comment.commentId !== undefined && askOpenCommentId === comment.commentId}
            {@const commentId = comment.commentId}
            <div class="flex gap-2 mt-1.5">
              <input
                class="input input-bordered input-xs flex-1"
                aria-label="Ask the agent about this AI review comment"
                placeholder="Ask why the agent suggested this…"
                value={commentAskDrafts[commentId] ?? ''}
                oninput={(event) => {
                  if (!(event.currentTarget instanceof HTMLInputElement)) return
                  commentAskDrafts = { ...commentAskDrafts, [commentId]: event.currentTarget.value }
                }}
                onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitCommentAsk(comment) } }}
              />
              <button type="button" class="btn btn-xs btn-primary" onclick={() => submitCommentAsk(comment)}>Ask</button>
            </div>
          {/if}
          {#if comment.type === 'existing' && !comment.isReply && comment.commentId !== undefined && replyOpenCommentId === comment.commentId}
            {@const commentId = comment.commentId}
            <div class="flex gap-2 mt-1.5">
              <input
                class="input input-bordered input-xs flex-1"
                aria-label="Reply to this comment"
                placeholder="Reply on GitHub…"
                value={existingReplyDrafts[commentId] ?? ''}
                oninput={(event) => {
                  if (!(event.currentTarget instanceof HTMLInputElement)) return
                  existingReplyDrafts = { ...existingReplyDrafts, [commentId]: event.currentTarget.value }
                }}
                onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitExistingReply(comment) } }}
              />
              {#if onAddReplyToReview}
                <button type="button" class="btn btn-xs btn-outline" title="Hold this reply in your pending review" onclick={() => addReplyToReview(comment)}>Add to review</button>
              {/if}
              <button type="button" class="btn btn-xs btn-primary" title="Post this reply to GitHub now" onclick={() => submitExistingReply(comment)}>Reply</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>
