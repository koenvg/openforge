<script lang="ts">
  import { FolderCog, FolderOpen, Search, X } from '@lucide/svelte'
  import type { FileTreeToolbarActions, FileTreeToolbarModel } from './lib/fileBrowserView'

  interface Props {
    model: FileTreeToolbarModel
    actions: FileTreeToolbarActions
  }

  let { model, actions }: Props = $props()

  const hiddenRootEntriesToggleLabel = $derived(
    model.showHiddenRootEntries
      ? 'Hide generated folders'
      : `Show generated folders (${model.hiddenRootEntryCount})`,
  )
</script>

<div class="border-b border-base-300 bg-base-100 p-3">
  {#if model.sourceLabel}
    <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-base-content/65" aria-label="File source: {model.sourceLabel}">
      <FolderOpen size={14} aria-hidden="true" />
      <span>{model.sourceLabel}</span>
    </div>
  {/if}
  <div class="flex items-center gap-2">
    <label class="input input-bordered input-sm flex h-9 min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-base-100 transition-shadow focus-within:border-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/15">
      <Search size={16} class="shrink-0 text-base-content/50" />
      <input
        type="search"
        class="min-w-0 grow"
        placeholder="Search files…"
        aria-label="Search files"
        value={model.searchQuery}
        oninput={(event) => actions.onSearchInput(event.currentTarget.value)}
      />
      {#if model.searchQuery.length > 0}
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-xs"
          aria-label="Clear search"
          onclick={actions.onClearSearch}
        >
          <X size={14} />
        </button>
      {/if}
    </label>
    {#if model.hiddenRootEntryCount > 0}
      <button
        type="button"
        class="btn btn-outline btn-sm btn-square h-9 min-h-9 w-9 shrink-0 {model.showHiddenRootEntries ? 'border-primary bg-primary/10 text-primary' : ''}"
        aria-label={hiddenRootEntriesToggleLabel}
        title={hiddenRootEntriesToggleLabel}
        aria-pressed={model.showHiddenRootEntries}
        onclick={actions.onToggleHiddenRootEntries}
      >
        <FolderCog size={16} />
      </button>
    {/if}
  </div>
</div>
