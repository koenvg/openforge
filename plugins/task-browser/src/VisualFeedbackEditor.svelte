<script lang="ts">
  import { MessageSquarePlus, Trash2 } from '@lucide/svelte'
  import type { VisualFeedbackEditorState } from './visualFeedbackEditorState.svelte'

  interface Props {
    available: boolean
    editor: VisualFeedbackEditorState
  }

  let { available, editor }: Props = $props()
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
    onclick={() => void editor.toggle()}
  >
    <MessageSquarePlus size={17} aria-hidden="true" />
  </button>
  {#if editor.annotations.length > 0}
    <span class="text-xs text-base-content/60">
      {editor.annotations.length} {editor.annotations.length === 1 ? 'comment' : 'comments'}
    </span>
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
