<script lang="ts">
  import { List, MessageSquarePlus, RefreshCw, Send as SendIcon, Trash2, Undo2 } from '@lucide/svelte'
  import type { VisualFeedbackEditorState } from './visualFeedbackEditorState.svelte'

  interface Props {
    available: boolean
    editor: VisualFeedbackEditorState
    reviewing: boolean
    onReview: () => void
    onSend: () => void
  }

  let { available, editor, reviewing, onReview, onSend }: Props = $props()

  function countLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function discardSession(): void {
    if (window.confirm('Discard all unsent visual feedback and background captures? This does not reset the browser.')) {
      void editor.discard()
    }
  }
</script>

{#if available}
  <button
    class:btn-primary={editor.active}
    class:btn-ghost={!editor.active}
    class="btn btn-square btn-sm"
    type="button"
    aria-label={editor.active ? 'Stop adding visual feedback' : 'Add visual feedback'}
    title={editor.active ? 'Stop adding visual feedback' : 'Add visual feedback'}
    aria-pressed={editor.active}
    disabled={editor.busy}
    onclick={() => void editor.toggle()}
  >
    <MessageSquarePlus size={17} aria-hidden="true" />
  </button>
  {#if editor.canUndo}
    <button
      class="btn btn-ghost btn-square btn-sm"
      type="button"
      aria-label="Undo last visual feedback change"
      title="Undo last change"
      disabled={editor.busy}
      onclick={() => void editor.undo()}
    >
      <Undo2 size={16} aria-hidden="true" />
    </button>
  {/if}
  {#if editor.saveError !== null}
    <span class="max-w-48 truncate text-xs text-error" title={editor.saveError} role="alert">{editor.saveError}</span>
    <button
      class="btn btn-warning btn-sm"
      type="button"
      aria-label="Retry saving visual feedback"
      disabled={editor.busy}
      onclick={() => void editor.retrySave()}
    >
      <RefreshCw size={15} aria-hidden="true" />
      Retry save
    </button>
  {/if}
  {#if editor.annotations.length > 0}
    <span class="whitespace-nowrap text-xs text-base-content/60" aria-live="polite">
      {countLabel(editor.captures.length, 'screenshot', 'screenshots')} ·
      {countLabel(editor.annotations.length, 'annotation', 'annotations')}
    </span>
    <button
      class:btn-active={reviewing}
      class="btn btn-ghost btn-sm"
      type="button"
      aria-label="Review visual feedback"
      aria-expanded={reviewing}
      disabled={editor.busy}
      onclick={onReview}
    >
      <List size={16} aria-hidden="true" />
      Review
    </button>
    <button
      class="btn btn-primary btn-sm"
      type="button"
      aria-label="Send visual feedback to agent"
      title="Send to agent"
      disabled={editor.busy}
      onclick={onSend}
    >
      {#if editor.busy}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      {:else}
        <SendIcon size={16} aria-hidden="true" />
      {/if}
      Send to agent
    </button>
    <button
      class="btn btn-ghost btn-square btn-sm"
      type="button"
      aria-label="Discard visual feedback"
      title="Discard visual feedback"
      disabled={editor.busy}
      onclick={discardSession}
    >
      <Trash2 size={16} aria-hidden="true" />
    </button>
  {/if}
{/if}
