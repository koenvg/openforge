<script lang="ts">
  import { Reply } from '@lucide/svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import type { ExistingCommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'
  import { timeAgo } from './timeAgo'

  interface Props {
    comment: ExistingCommentDisplayData
    replyOpen: boolean
    replyDraft: string
    onReplyDraftChange: (value: string) => void
    onToggleReply: () => void
    onClearReply: () => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    onAddReplyToReview?: (commentId: number, body: string) => void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    comment,
    replyOpen,
    replyDraft,
    onReplyDraftChange,
    onToggleReply,
    onClearReply,
    onReplyToExistingComment,
    onAddReplyToReview,
    onOpenUrl,
  }: Props = $props()

  function submitReply() {
    if (comment.isReply) return
    const body = replyDraft.trim()
    if (!body) return
    onReplyToExistingComment?.(comment.commentId, body)
    onClearReply()
  }

  function addReplyToReview() {
    if (comment.isReply) return
    const body = replyDraft.trim()
    if (!body) return
    onAddReplyToReview?.(comment.commentId, body)
    onClearReply()
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
  <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
    {comment.author.charAt(0).toUpperCase()}
  </div>
  <strong class="text-base-content font-semibold text-xs">{comment.author}</strong>
  <span class="text-base-content/50 text-[0.7rem]">{timeAgo(new Date(comment.createdAt).getTime())}</span>
  {#if comment.isReply}
    <span class="inline-flex items-center gap-1 text-base-content/30 text-[0.65rem]">
      <Reply size={12} strokeWidth={1.8} aria-hidden="true" />
      reply
    </span>
  {/if}
  {#if onReplyToExistingComment && !comment.isReply}
    <IconButton
      label="Reply to this comment"
      size="xs"
      class="ml-auto"
      title="Reply on GitHub"
      onclick={onToggleReply}
    >
      <Reply size={14} strokeWidth={2} aria-hidden="true" />
    </IconButton>
  {/if}
</div>
<InlineCommentBody>
  <MarkdownContent content={comment.body} {onOpenUrl} />
  {#if !comment.isReply && replyOpen}
    <InlineReplyEditor
      value={replyDraft}
      ariaLabel="Reply to this comment"
      placeholder="Reply on GitHub…"
      primaryLabel="Reply"
      primaryTitle="Post this reply to GitHub now"
      onValueChange={onReplyDraftChange}
      onSubmit={submitReply}
      secondaryLabel={onAddReplyToReview ? 'Add to review' : undefined}
      secondaryTitle="Hold this reply in your pending review"
      onSecondarySubmit={onAddReplyToReview ? addReplyToReview : undefined}
    />
  {/if}
</InlineCommentBody>
