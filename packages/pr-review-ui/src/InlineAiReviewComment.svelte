<script lang="ts">
  import { Check, MessageCircleQuestion, Undo2, X } from '@lucide/svelte'
  import type { AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { CommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'

  type DisplayComment = CommentDisplayData['comments'][number]

  interface Props {
    comment: DisplayComment
    agentComments: AgentReviewComment[]
    askOpen: boolean
    askDraft: string
    onAskDraftChange: (value: string) => void
    onToggleAsk: () => void
    onAskSubmitted: () => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateStatus?: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    comment,
    agentComments,
    askOpen,
    askDraft,
    onAskDraftChange,
    onToggleAsk,
    onAskSubmitted,
    onAgentCommentsChange,
    onUpdateStatus,
    onAskAboutComment,
    onOpenUrl,
  }: Props = $props()

  async function updateStatus(status: 'approved' | 'dismissed' | 'pending') {
    if (comment.commentId === undefined) return
    try {
      await onUpdateStatus?.(comment.commentId, status)
      onAgentCommentsChange(agentComments.map(agentComment =>
        agentComment.id === comment.commentId ? { ...agentComment, status } : agentComment
      ))
    } catch (error) {
      const action = status === 'approved' ? 'approve' : status === 'pending' ? 'un-approve' : 'dismiss'
      console.error(`[DiffViewer] Failed to ${action} comment:`, error)
    }
  }

  function submitAsk() {
    if (comment.commentId === undefined || comment.filePath === undefined || comment.lineNumber === undefined) return
    const body = askDraft.trim()
    if (!body) return
    const side = comment.commentSide === 'LEFT' ? 'LEFT' : 'RIGHT'
    onAskAboutComment?.({ commentId: comment.commentId, filename: comment.filePath, line: comment.lineNumber, side, body })
    onAskSubmitted()
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
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
        onclick={() => updateStatus('pending')}
      >
        <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    {:else}
      <button
        class="btn btn-ghost btn-xs text-success hover:text-success/80"
        title="Approve — include in this review"
        aria-label="Approve AI review comment"
        onclick={() => updateStatus('approved')}
      >
        <Check size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
    {#if onAskAboutComment}
      <button
        class="btn btn-ghost btn-xs text-info hover:text-info/80"
        title="Ask the agent about this suggestion"
        aria-label="Ask the agent about this AI review comment"
        onclick={onToggleAsk}
      >
        <MessageCircleQuestion size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
    <button
      class="btn btn-ghost btn-xs text-base-content/50 hover:text-error"
      title="Dismiss"
      aria-label="Dismiss AI review comment"
      onclick={() => updateStatus('dismissed')}
    >
      <X size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
</div>
<InlineCommentBody>
  <MarkdownContent content={comment.body} {onOpenUrl} />
  {#if comment.commentId !== undefined && askOpen}
    <InlineReplyEditor
      value={askDraft}
      ariaLabel="Ask the agent about this AI review comment"
      placeholder="Ask why the agent suggested this…"
      primaryLabel="Ask"
      onValueChange={onAskDraftChange}
      onSubmit={submitAsk}
    />
  {/if}
</InlineCommentBody>
