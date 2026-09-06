<script lang="ts">
  import { Ticket, ExternalLink, Pencil, Plus } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import { openUrl } from '../../lib/ipc'
  import { getSourceTicketLink, normalizeSourceTicketUrl } from '../../lib/sourceTicket'

  interface Props {
    url: string | null
    /**
     * When provided, the chip becomes editable: it exposes an add/edit
     * affordance and calls `onSave` with the normalized value (or `null` when
     * cleared). Omit it for a purely read-only display.
     */
    onSave?: (url: string | null) => Promise<void> | void
  }

  let { url, onSave }: Props = $props()

  const link = $derived(getSourceTicketLink(url))
  const editable = $derived(onSave != null)

  let isEditing = $state(false)
  let draft = $state('')
  let isSaving = $state(false)
  let error = $state<string | null>(null)

  function handleOpen() {
    if (link?.clickable) {
      void openUrl(link.url)
    }
  }

  function startEditing() {
    draft = url ?? ''
    error = null
    isEditing = true
  }

  function cancelEditing() {
    isEditing = false
    draft = ''
    error = null
  }

  async function submit() {
    if (!onSave) return
    const normalized = normalizeSourceTicketUrl(draft)
    isSaving = true
    error = null
    try {
      await onSave(normalized)
      isEditing = false
      draft = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      isSaving = false
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }
</script>

{#if link || editable}
  <section
    data-task-info-card="source-ticket"
    data-card-sizing="natural"
    data-card-layout="row"
    class="flex flex-col gap-1.5 rounded-[var(--of-radius-container)] border border-base-300/70 bg-base-100 px-3 py-2 shrink-0"
    aria-label="Source ticket"
  >
    <div class="flex items-center gap-2">
      <!-- Blank stand-in for the collapsible sections' caret column, so this row's icon
           and title sit in the same columns as theirs. -->
      <span class="w-3 shrink-0" aria-hidden="true"></span>
      <Ticket size={14} class="shrink-0 text-base-content/50" aria-hidden="true" />
      <!-- Same heading treatment as the collapsible sections below it (Initial Prompt,
           Details, Changes) so the whole panel reads as one column of sections. -->
      <h3 class="m-0 shrink-0 text-sm font-semibold text-base-content">Ticket</h3>

      {#if isEditing}
        <div class="flex-1 min-w-0">
        <TextField label="Source ticket link" hideLabel size="sm"
          type="text"
          inputmode="url"
          placeholder="GitHub issue or Jira URL"
          aria-label="Source ticket link"
          bind:value={draft}
          disabled={isSaving}
          onkeydown={handleKeydown}
        />
        </div>
      {:else if link}
        {#if link.clickable}
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onclick={handleOpen}
            title={link.url}
            aria-label="Open source ticket {link.label}"
          >
            <span class="truncate">{link.label}</span>
            <ExternalLink size={12} class="shrink-0" aria-hidden="true" />
          </Button>
        {:else}
          <span class="truncate text-xs text-base-content/70" title={link.url}>{link.label}</span>
        {/if}
        {#if editable}
          <IconButton
            label="Edit source ticket link"
            size="xs"
            class="ml-auto shrink-0"
            type="button"
            onclick={startEditing}
          >
            <Pencil size={12} aria-hidden="true" />
          </IconButton>
        {/if}
      {:else}
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onclick={startEditing}
          aria-label="Add source ticket link"
        >
          <Plus size={12} class="shrink-0" aria-hidden="true" />
          <span>Add ticket link</span>
        </Button>
      {/if}
    </div>

    {#if isEditing}
      {#if error}
        <p class="m-0 text-xs text-error" role="alert">{error}</p>
      {/if}
      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" size="xs" type="button" disabled={isSaving} onclick={cancelEditing}>Cancel</Button>
        <Button size="xs" type="button" disabled={isSaving} onclick={() => void submit()}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    {/if}
  </section>
{/if}
