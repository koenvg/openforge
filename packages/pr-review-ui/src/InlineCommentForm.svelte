<script lang="ts">
  import { MessageSquarePlus } from '@lucide/svelte'
  import { SplitSide } from '@git-diff-view/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import { fromAction } from 'svelte/attachments'

  interface Props {
    filename: string
    lineNumber: number
    side: SplitSide
    text: string
    onTextChange: (text: string) => void
    onSubmit: () => void
    onCancel: () => void
    onCreateThread?: (body: string) => void
    // When provided, the form offers a "Comment" action that posts the comment to
    // GitHub immediately, instead of holding it in the pending review.
    onCommentNow?: (body: string) => void
  }

  let { filename, lineNumber, side, text, onTextChange, onSubmit, onCancel, onCreateThread, onCommentNow }: Props = $props()

  function createThread() {
    if (!text.trim()) return
    onCreateThread?.(text.trim())
    onCancel()
  }

  function commentNow() {
    if (!text.trim()) return
    onCommentNow?.(text.trim())
    onCancel()
  }

  const helpId = $derived(`inline-comment-help-${filename.replace(/[^a-zA-Z0-9_-]/g, '-')}-${lineNumber}-${String(side).replace(/[^a-zA-Z0-9_-]/g, '-')}`)

  function autofocus(node: HTMLElement) {
    const frame = requestAnimationFrame(() => node.focus())
    return {
      destroy() {
        cancelAnimationFrame(frame)
      },
    }
  }
</script>

<div class="review-inline-comment-form mx-4 my-2 overflow-hidden rounded-[var(--of-radius-container)] border border-of-border bg-of-surface shadow-sm font-sans">
  <div class="flex items-center justify-between gap-3 border-b border-of-border bg-of-surface-subtle/70 px-3 py-2">
    <div class="flex min-w-0 items-center gap-2 text-of-text">
      <MessageSquarePlus size={16} strokeWidth={1.8} class="shrink-0 text-of-accent" aria-hidden="true" />
      <span class="truncate text-[13px] font-semibold">Add inline comment</span>
    </div>
    <span class="shrink-0 rounded-[var(--of-radius-round)] border border-of-border bg-of-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-of-text/60">
      Line {lineNumber}
    </span>
  </div>

  <div class="flex flex-col gap-2.5 p-3">
    <Textarea
      label="Inline review comment for {filename} line {lineNumber}"
      hideLabel
      aria-describedby={helpId}
      placeholder="Leave a comment…"
      rows={3}
      value={text}
      {@attach fromAction(autofocus)}
      oninput={(event) => {
        if (!(event.currentTarget instanceof HTMLTextAreaElement)) return
        onTextChange(event.currentTarget.value)
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
          return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSubmit()
        }
      }}
    />

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p id={helpId} class="m-0 flex items-center gap-1.5 text-[11px] text-of-text/50">
        <span>Submit with</span>
        <kbd class="key-hint">⌘ / Ctrl</kbd>
        <span>+</span>
        <kbd class="key-hint">Enter</kbd>
      </p>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" type="button" onclick={onCancel}>Cancel</Button>
        {#if onCreateThread}
          <Button
            variant="outline"
            size="sm"
            type="button"
            title="Ask the AI author (private, not posted to GitHub)"
            onclick={createThread}
          >Ask the AI</Button>
        {/if}
        {#if onCommentNow}
          <Button
            variant="outline"
            size="sm"
            type="button"
            title="Post this comment to GitHub now"
            onclick={commentNow}
          >Comment</Button>
        {/if}
        <Button
          size="sm"
          type="button"
          title="Hold this comment in your pending review"
          onclick={onSubmit}
        >
          <MessageSquarePlus size={15} strokeWidth={1.8} aria-hidden="true" />
          Add to review
        </Button>
      </div>
    </div>
  </div>
</div>

<style>
  .key-hint {
    --key-hint-size: calc(var(--of-control-height-compact) * .5);
    box-sizing: border-box;
    display: inline-flex;
    height: var(--key-hint-size);
    min-width: var(--key-hint-size);
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    padding-inline: .5em;
    border: var(--of-border-width) solid var(--of-border);
    border-bottom-width: calc(var(--of-border-width) + 1px);
    border-radius: var(--of-radius-control);
    background: var(--of-surface-subtle);
    color: color-mix(in srgb, var(--of-text) 70%, transparent);
    font-size: .625rem;
    box-shadow: none;
  }
</style>
