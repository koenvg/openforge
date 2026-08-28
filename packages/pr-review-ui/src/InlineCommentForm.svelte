<script lang="ts">
  import { MessageSquarePlus } from '@lucide/svelte'
  import { SplitSide } from '@git-diff-view/svelte'

  interface Props {
    filename: string
    lineNumber: number
    side: SplitSide
    text: string
    onTextChange: (text: string) => void
    onSubmit: () => void
    onCancel: () => void
    // When provided, the form offers an "Ask the AI" action that routes the draft
    // to a local Q&A thread instead of a GitHub-bound pending comment.
    onAskAgent?: (body: string) => void
    // When provided, the form offers a "Comment" action that posts the comment to
    // GitHub immediately, instead of holding it in the pending review.
    onCommentNow?: (body: string) => void
  }

  let { filename, lineNumber, side, text, onTextChange, onSubmit, onCancel, onAskAgent, onCommentNow }: Props = $props()

  function askAgent() {
    if (!text.trim()) return
    onAskAgent?.(text.trim())
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

<div class="review-inline-comment-form mx-4 my-2 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm font-sans">
  <div class="flex items-center justify-between gap-3 border-b border-base-300 bg-base-200/70 px-3 py-2">
    <div class="flex min-w-0 items-center gap-2 text-base-content">
      <MessageSquarePlus size={16} strokeWidth={1.8} class="shrink-0 text-primary" aria-hidden="true" />
      <span class="truncate text-[13px] font-semibold">Add inline comment</span>
    </div>
    <span class="shrink-0 rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-base-content/60">
      Line {lineNumber}
    </span>
  </div>

  <div class="flex flex-col gap-2.5 p-3">
    <textarea
      class="textarea textarea-bordered w-full min-h-20 resize-y bg-base-100 px-3 py-2.5 text-[13px] leading-relaxed text-base-content shadow-none transition-colors placeholder:text-base-content/40 focus:border-primary focus:outline-none"
      aria-label="Inline review comment for {filename} line {lineNumber}"
      aria-describedby={helpId}
      placeholder="Leave a comment…"
      rows="3"
      value={text}
      use:autofocus
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
    ></textarea>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p id={helpId} class="m-0 flex items-center gap-1.5 text-[11px] text-base-content/50">
        <span>Submit with</span>
        <kbd class="kbd kbd-xs border-base-300 bg-base-200 text-base-content/70">⌘ / Ctrl</kbd>
        <span>+</span>
        <kbd class="kbd kbd-xs border-base-300 bg-base-200 text-base-content/70">Enter</kbd>
      </p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm h-10 min-h-10 px-3 text-[13px] font-medium text-base-content/70 hover:bg-base-200 hover:text-base-content"
          onclick={onCancel}
        >Cancel</button>
        {#if onAskAgent}
          <button
            type="button"
            class="btn btn-outline btn-sm h-10 min-h-10 px-3 text-[13px] font-medium"
            title="Ask the AI author (private, not posted to GitHub)"
            onclick={askAgent}
          >Ask the AI</button>
        {/if}
        {#if onCommentNow}
          <button
            type="button"
            class="btn btn-outline btn-sm h-10 min-h-10 px-3 text-[13px] font-medium"
            title="Post this comment to GitHub now"
            onclick={commentNow}
          >Comment</button>
        {/if}
        <button
          type="button"
          class="btn btn-primary btn-sm h-10 min-h-10 px-3 text-[13px] font-semibold shadow-sm transition-shadow hover:shadow-md"
          title="Hold this comment in your pending review"
          onclick={onSubmit}
        >
          <MessageSquarePlus size={15} strokeWidth={1.8} aria-hidden="true" />
          Add to review
        </button>
      </div>
    </div>
  </div>
</div>
