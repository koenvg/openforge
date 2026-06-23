<script lang="ts">
  import MarkdownContent from '@openforge/plugin-sdk/ui/MarkdownContent.svelte'
  import type { RepoLabel } from '../lib/types'

  interface Props {
    labelOptions: RepoLabel[]
    busy: boolean
    onClose: () => void
    onCreate: (title: string, body: string, labels: string[]) => void
    onOpenUrl: (url: string) => void
  }

  let { labelOptions, busy, onClose, onCreate, onOpenUrl }: Props = $props()

  let title = $state('')
  let body = $state('')
  let editingBody = $state(true)
  let labels = $state<string[]>([])

  const HEX6 = /^[0-9a-fA-F]{6}$/
  function chipStyle(color: string): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color}33; border-color: #${color};`
  }

  function toggleLabel(name: string) {
    labels = labels.includes(name) ? labels.filter((l) => l !== name) : [...labels, name]
  }

  function submit() {
    const t = title.trim()
    if (!t || busy) return
    onCreate(t, body.trim(), labels)
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="modal-box bg-base-100 max-w-xl p-0 flex flex-col max-h-[90vh]">
    <div class="flex items-center justify-between px-5 py-3 border-b border-base-300 shrink-0">
      <h3 class="text-base font-semibold m-0">New issue</h3>
      <button class="btn btn-ghost btn-sm btn-square" type="button" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-title">Title</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="create-title" class="input input-bordered input-sm w-full" bind:value={title} autofocus placeholder="Issue title" />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-body">Description</label>
          <button class="btn btn-ghost btn-xs" type="button" onclick={() => (editingBody = !editingBody)}>
            {editingBody ? 'Preview' : 'Edit'}
          </button>
        </div>
        {#if editingBody}
          <textarea id="create-body" class="textarea textarea-bordered w-full min-h-40" bind:value={body} placeholder="Description…"></textarea>
        {:else if body.trim()}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <MarkdownContent content={body} onOpenUrl={onOpenUrl} />
          </div>
        {:else}
          <span class="text-sm text-base-content/40">No description.</span>
        {/if}
      </div>

      {#if labelOptions.length > 0}
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Labels (optional)</span>
          <div class="flex flex-wrap gap-2">
            {#each labelOptions as label (label.name)}
              {@const on = labels.includes(label.name)}
              <button
                type="button"
                class="badge badge-lg gap-1 cursor-pointer {on ? 'border' : 'badge-ghost'}"
                style={on ? chipStyle(label.color) : ''}
                onclick={() => toggleLabel(label.name)}
              >
                {on ? '✓ ' : ''}{label.name}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="flex justify-end gap-2 px-5 py-3 border-t border-base-300 shrink-0">
      <button class="btn btn-sm btn-ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <button class="btn btn-sm btn-primary" onclick={submit} disabled={!title.trim() || busy}>
        {busy ? 'Creating…' : 'Create issue'}
      </button>
    </div>
  </div>
</div>
