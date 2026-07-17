<script lang="ts">
  import { SplitSide } from '@git-diff-view/svelte'

  interface Props {
    filename: string
    lineNumber: number
    side: SplitSide
    text: string
    onTextChange: (text: string) => void
    onSubmit: () => void
    onCancel: () => void
  }

  let { filename, lineNumber, side, text, onTextChange, onSubmit, onCancel }: Props = $props()

  const helpId = $derived(`inline-comment-help-${filename.replace(/[^a-zA-Z0-9_-]/g, '-')}-${lineNumber}-${String(side).replace(/[^a-zA-Z0-9_-]/g, '-')}`)

  function autofocus(node: HTMLElement) {
    node.focus()
  }
</script>

<div class="review-inline-comment-form p-3 mx-4 my-2 bg-base-100 border border-base-300 rounded-md">
  <textarea
    class="textarea textarea-bordered w-full min-h-[60px] text-[0.8rem] leading-relaxed resize-y"
    aria-label="Inline review comment for {filename} line {lineNumber}"
    aria-describedby={helpId}
    placeholder="Leave a comment… (Cmd/Ctrl+Enter to submit)"
    rows="3"
    value={text}
    use:autofocus
    oninput={(event) => {
      if (!(event.currentTarget instanceof HTMLTextAreaElement)) return
      onTextChange(event.currentTarget.value)
    }}
    onkeydown={(event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onSubmit()
      }
    }}
  ></textarea>
  <p id={helpId} class="text-xs text-base-content/50 mt-1 mb-0">Submit with Command+Enter or Control+Enter.</p>
  <div class="flex justify-end gap-2.5 mt-2">
    <button
      type="button"
      class="btn btn-sm border border-base-300 hover:border-primary hover:text-primary"
      onclick={onCancel}
    >Cancel</button>
    <button
      type="button"
      class="btn btn-primary btn-sm"
      onclick={onSubmit}
    >Add Comment</button>
  </div>
</div>
