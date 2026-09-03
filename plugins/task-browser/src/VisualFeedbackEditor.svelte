<script lang="ts">
  import { List, MessageSquarePlus, RefreshCw, Send as SendIcon, Trash2, Undo2 } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
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
  <IconButton
    label={editor.active ? 'Stop adding visual feedback' : 'Add visual feedback'}
    variant={editor.active ? 'primary' : 'ghost'}
    size="sm"
    type="button"
    title={editor.active ? 'Stop adding visual feedback' : 'Add visual feedback'}
    aria-pressed={editor.active}
    disabled={editor.busy}
    onclick={() => void editor.toggle()}
  >
    <MessageSquarePlus size={17} aria-hidden="true" />
  </IconButton>
  {#if editor.canUndo}
    <IconButton
      label="Undo last visual feedback change"
      size="sm"
      type="button"
      title="Undo last change"
      disabled={editor.busy}
      onclick={() => void editor.undo()}
    >
      <Undo2 size={16} aria-hidden="true" />
    </IconButton>
  {/if}
  {#if editor.saveError !== null}
    <span class="max-w-48 truncate text-xs text-error" title={editor.saveError} role="alert">{editor.saveError}</span>
    <Button
      variant="outline"
      size="sm"
      style="border-color: var(--of-warning); color: var(--of-warning);"
      type="button"
      aria-label="Retry saving visual feedback"
      disabled={editor.busy}
      onclick={() => void editor.retrySave()}
    >
      <RefreshCw size={15} aria-hidden="true" />
      Retry save
    </Button>
  {/if}
  {#if editor.annotations.length > 0}
    <span class="whitespace-nowrap text-xs text-base-content/60" aria-live="polite">
      {countLabel(editor.captures.length, 'screenshot', 'screenshots')} ·
      {countLabel(editor.annotations.length, 'annotation', 'annotations')}
    </span>
    <Button
      variant={reviewing ? 'secondary' : 'ghost'}
      size="sm"
      type="button"
      aria-label="Review visual feedback"
      aria-expanded={reviewing}
      disabled={editor.busy}
      onclick={onReview}
    >
      <List size={16} aria-hidden="true" />
      Review
    </Button>
    <Button
      size="sm"
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
    </Button>
    <IconButton
      label="Discard visual feedback"
      size="sm"
      type="button"
      title="Discard visual feedback"
      disabled={editor.busy}
      onclick={discardSession}
    >
      <Trash2 size={16} aria-hidden="true" />
    </IconButton>
  {/if}
{/if}
