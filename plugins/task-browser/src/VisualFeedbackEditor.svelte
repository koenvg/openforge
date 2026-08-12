<script lang="ts">
  import { MessageSquarePlus, Send as SendIcon, Trash2 } from '@lucide/svelte'
  import type { VisualFeedbackEditorState } from './visualFeedbackEditorState.svelte'

  interface Props {
    available: boolean
    editor: VisualFeedbackEditorState
    onSend: () => void
  }

  let { available, editor, onSend }: Props = $props()
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
  {#if editor.annotations.length > 0}
    <span class="text-xs text-base-content/60">
      {editor.annotations.length} {editor.annotations.length === 1 ? 'comment' : 'comments'}
    </span>
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
      onclick={() => void editor.discard()}
    >
      <Trash2 size={16} aria-hidden="true" />
    </button>
  {/if}
{/if}
