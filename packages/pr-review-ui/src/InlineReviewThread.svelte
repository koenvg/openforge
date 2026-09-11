<script lang="ts">
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import type { ReviewThreadCommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'

  interface Props {
    comment: ReviewThreadCommentDisplayData
    replyDraft: string
    onReplyDraftChange: (value: string) => void
    onReplySubmitted: () => void
    onReplyToThread?: (threadId: string, body: string) => void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let {
    comment,
    replyDraft,
    onReplyDraftChange,
    onReplySubmitted,
    onReplyToThread,
    onOpenUrl,
  }: Props = $props()

  const ORIGIN_LABELS = { agent: 'Agent', plugin: 'Plugin', human: 'Reviewer' } as const
  const originLabel = $derived(ORIGIN_LABELS[comment.thread.origin])

  function submitReply() {
    const body = replyDraft.trim()
    if (!body) return
    onReplyToThread?.(comment.thread.id, body)
    onReplySubmitted()
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
  <Badge variant="info">{originLabel}</Badge>
</div>
<InlineCommentBody>
  {#each comment.thread.messages as message (message.id)}
    <div class="mb-1.5">
      <span class="text-base-content/50 text-[0.7rem] mr-1 {message.role === 'human' ? 'font-semibold' : ''}">{message.role === 'agent' ? 'Agent' : 'Reviewer'}</span>
      <span class="[&_p]:m-0 [&_p]:inline"><MarkdownContent content={message.body} {onOpenUrl} /></span>
    </div>
  {/each}
  {#if onReplyToThread}
    <InlineReplyEditor
      class="mt-1"
      value={replyDraft}
      ariaLabel="Reply to the review thread"
      placeholder="Reply…"
      primaryLabel="Reply"
      onValueChange={onReplyDraftChange}
      onSubmit={submitReply}
    />
  {/if}
</InlineCommentBody>
