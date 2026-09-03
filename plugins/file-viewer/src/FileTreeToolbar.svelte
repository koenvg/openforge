<script lang="ts">
  import { FolderCog, FolderOpen, Search, X } from '@lucide/svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
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
    <div class="file-search-field relative min-w-0 flex-1">
      <Search size={16} class="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-base-content/50" aria-hidden="true" />
      <label class="sr-only" for="file-search">Search files</label>
      <input
        id="file-search"
        type="search"
        class="file-search-input"
        placeholder="Search files…"
        value={model.searchQuery}
        oninput={(event) => actions.onSearchInput(event.currentTarget.value)}
      />
      {#if model.searchQuery.length > 0}
        <div class="absolute right-1 top-1/2 z-10 -translate-y-1/2">
          <IconButton label="Clear search" size="xs" type="button" onclick={actions.onClearSearch}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      {/if}
    </div>
    {#if model.hiddenRootEntryCount > 0}
      <IconButton
        label={hiddenRootEntriesToggleLabel}
        variant={model.showHiddenRootEntries ? 'primary' : 'outline'}
        size="md"
        type="button"
        title={hiddenRootEntriesToggleLabel}
        aria-pressed={model.showHiddenRootEntries}
        onclick={actions.onToggleHiddenRootEntries}
      >
        <FolderCog size={16} aria-hidden="true" />
      </IconButton>
    {/if}
  </div>
</div>

<style>
  .file-search-input {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space8);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    appearance: none;
    background: var(--of-field);
    color: var(--of-text);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .file-search-input:hover {
    background: var(--of-field-hover);
  }

  .file-search-input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .file-search-input::placeholder {
    color: var(--of-text-muted);
  }

  .file-search-input::-webkit-search-cancel-button {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .file-search-input {
      transition: none;
    }
  }
</style>
