<script lang="ts">
  import { Check, MessageCircleQuestion, Undo2, X } from '@lucide/svelte'
  import type { AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import type { AgentCommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'

  interface Props {
    comment: AgentCommentDisplayData
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
    const body = askDraft.trim()
    if (!body) return
    onAskAboutComment?.({
      commentId: comment.commentId,
      filename: comment.filePath,
      line: comment.lineNumber,
      side: comment.commentSide,
      body,
    })
    onAskSubmitted()
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
  <Badge variant="success">AI Review</Badge>
  {#if comment.status === 'approved'}
    <Badge variant="info">Approved</Badge>
  {/if}
  <div class="ml-auto flex gap-1">
    {#if comment.status === 'approved'}
      <IconButton
        label="Un-approve AI review comment"
        size="xs"
        title="Un-approve — remove from this review"
        onclick={() => updateStatus('pending')}
      >
        <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    {:else}
      <IconButton
        label="Approve AI review comment"
        size="xs"
        title="Approve — include in this review"
        onclick={() => updateStatus('approved')}
      >
        <Check size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    {/if}
    {#if onAskAboutComment}
      <IconButton
        label="Ask the agent about this AI review comment"
        size="xs"
        title="Ask the agent about this suggestion"
        onclick={onToggleAsk}
      >
        <MessageCircleQuestion size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    {/if}
    <IconButton
      label="Dismiss AI review comment"
      size="xs"
      title="Dismiss"
      onclick={() => updateStatus('dismissed')}
    >
      <X size={14} strokeWidth={2} aria-hidden="true" />
    </IconButton>
  </div>
</div>
<InlineCommentBody>
  <MarkdownContent content={comment.body} {onOpenUrl} />
  {#if askOpen}
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
