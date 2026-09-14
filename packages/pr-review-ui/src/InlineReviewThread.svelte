<script lang="ts">
  import { Check, Undo2, X } from '@lucide/svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import type { ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import type { ReviewThreadCommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'

  interface Props {
    comment: ReviewThreadCommentDisplayData
    onReplyToThread?: (threadId: string, body: string) => void
    onSetThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let { comment, onReplyToThread, onSetThreadStatus, onOpenUrl }: Props = $props()

  let replyDraft = $state('')

  const ORIGIN_LABELS = { agent: 'Agent', plugin: 'Plugin', human: 'Reviewer' } as const
  const STATUS_LABELS = { resolved: 'Resolved', dismissed: 'Dismissed' } as const
  const AWAITING_LABELS = { agent: 'Waiting for agent', error: 'Agent reply failed' } as const

  const originLabel = $derived(ORIGIN_LABELS[comment.thread.origin])
  const statusLabel = $derived(comment.thread.status === 'open' ? null : STATUS_LABELS[comment.thread.status])
  const awaitingLabel = $derived(comment.thread.awaiting === 'none' ? null : AWAITING_LABELS[comment.thread.awaiting])

  function submitReply() {
    const body = replyDraft.trim()
    if (!body) return
    onReplyToThread?.(comment.thread.id, body)
    replyDraft = ''
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
  <Badge variant="info">{originLabel}</Badge>
  {#if statusLabel}
    <Badge variant="neutral">{statusLabel}</Badge>
  {/if}
  {#if awaitingLabel}
    <Badge variant={comment.thread.awaiting === 'error' ? 'danger' : 'warning'}>{awaitingLabel}</Badge>
  {/if}
  {#if onSetThreadStatus}
    {@const threadId = comment.thread.id}
    <div class="ml-auto flex gap-1">
      {#if comment.thread.status === 'open'}
        <IconButton
          label="Resolve review thread"
          size="xs"
          onclick={() => onSetThreadStatus(threadId, 'resolved')}
        >
          <Check size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Dismiss review thread"
          size="xs"
          onclick={() => onSetThreadStatus(threadId, 'dismissed')}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      {:else}
        <IconButton
          label="Reopen review thread"
          size="xs"
          onclick={() => onSetThreadStatus(threadId, 'open')}
        >
          <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      {/if}
    </div>
  {/if}
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
      onValueChange={(value) => { replyDraft = value }}
      onSubmit={submitReply}
    />
  {/if}
</InlineCommentBody>
