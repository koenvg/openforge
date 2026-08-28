<script lang="ts">
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { CommentDisplayData } from './diffComments'
  import InlineCommentBody from './InlineCommentBody.svelte'
  import InlineReplyEditor from './InlineReplyEditor.svelte'

  type DisplayComment = CommentDisplayData['comments'][number]

  interface Props {
    comment: DisplayComment
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

  function submitReply() {
    if (!comment.thread) return
    const body = replyDraft.trim()
    if (!body) return
    onReplyToThread?.(comment.thread.id, body)
    onReplySubmitted()
  }
</script>

<div class="flex items-center gap-2 mb-1.5">
  <span class="badge badge-info badge-sm">Ask the AI</span>
  {#if comment.thread?.status === 'draft'}
    <span
      class="badge badge-warning badge-sm tooltip tooltip-bottom"
      data-tip="Not sent yet. Use the 'Send questions to AI' button at the top to get an answer."
    >Pending</span>
  {/if}
  {#if comment.thread?.status === 'pending'}
    <span class="loading loading-spinner loading-xs"></span>
    <span class="text-base-content/50 text-[0.7rem]">thinking…</span>
  {/if}
  {#if comment.thread?.status === 'error'}
    <span class="text-error text-[0.7rem]">failed — send again</span>
  {/if}
</div>
<InlineCommentBody>
  {#if comment.thread}
    {#each comment.thread.messages as message}
      <div class="mb-1.5">
        <span class="text-base-content/50 text-[0.7rem] mr-1 {message.role === 'user' ? 'font-semibold' : ''}">{message.role === 'ai' ? 'AI author' : 'You'}</span>
        <span class="[&_p]:m-0 [&_p]:inline"><MarkdownContent content={message.body} {onOpenUrl} /></span>
      </div>
    {/each}
    {#if comment.thread.status === 'answered'}
      <InlineReplyEditor
        class="mt-1"
        value={replyDraft}
        ariaLabel="Reply to the AI author"
        placeholder="Reply…"
        primaryLabel="Reply"
        onValueChange={onReplyDraftChange}
        onSubmit={submitReply}
      />
    {/if}
  {/if}
</InlineCommentBody>
