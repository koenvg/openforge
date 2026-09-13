<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'
  import Modal from './Modal.svelte'
  import PaletteListbox from './PaletteListbox.svelte'

  interface Props {
    items: T[]
    query: string
    onQueryChange: (query: string) => void
    selectedIndex: number
    onSelectedIndexChange: (index: number) => void
    getKey: (item: T) => string
    onSelect: (item: T) => void
    onClose: () => void
    ariaLabel: string
    listboxLabel: string
    placeholder: string
    loading?: boolean
    groupLabel?: (item: T, index: number) => string | null
    item: Snippet<[T, number, boolean]>
    leading?: Snippet<[T]>
    trailing?: Snippet<[T]>
    loadingContent?: Snippet
    emptyContent?: Snippet
    resultsFooter?: Snippet
    maxResultsHeight?: string
    actionLabel: string
    cancelLabel?: string
    trailingKey?: string
    trailingLabel?: string
    testId?: string
    alternateContent?: Snippet
    alternateInitialFocus?: string
    onKeydown?: (event: KeyboardEvent) => boolean | void
  }

  let {
    items, query, onQueryChange, selectedIndex, onSelectedIndexChange, getKey,
    onSelect, onClose, ariaLabel, listboxLabel, placeholder, loading = false,
    groupLabel, item, leading, trailing, loadingContent, emptyContent,
    resultsFooter, maxResultsHeight,
    actionLabel, cancelLabel = 'close', trailingKey, trailingLabel = 'navigate', testId,
    alternateContent, alternateInitialFocus, onKeydown,
  }: Props = $props()

  let listbox: { handleKeydown: (event: KeyboardEvent) => boolean } | undefined = $state()

  let alternateElement: HTMLDivElement | undefined = $state()
  let inputElement: HTMLInputElement | undefined = $state()
  let wasAlternate = false
  $effect(() => {
    const showingAlternate = Boolean(alternateContent)
    if (!showingAlternate && !wasAlternate) return
    wasAlternate = showingAlternate
    let cancelled = false
    void tick().then(() => {
      if (cancelled) return
      if (showingAlternate) {
        const target = alternateInitialFocus ? alternateElement?.querySelector<HTMLElement>(alternateInitialFocus) : null
        ;(target ?? alternateElement)?.focus()
      } else inputElement?.focus()
    })
    return () => { cancelled = true }
  })

  function handleKeydown(event: KeyboardEvent): boolean {
    if (onKeydown?.(event)) return true
    if (alternateContent) return false
    return listbox?.handleKeydown(event) ?? false
  }
</script>

<Modal
  {ariaLabel} {onClose} {testId} showHeader={false} maxWidth="640px"
  initialFocus={alternateContent ? '[data-palette-part="alternate"]' : '[data-palette-initial-focus]'}
  onKeydown={handleKeydown}
  modalClass="of-search-palette" boxClass="of-search-palette-panel"
>
  {#if alternateContent}
    <div bind:this={alternateElement} class="alternate" data-palette-part="alternate" tabindex="-1">{@render alternateContent()}</div>
  {:else}
    <PaletteListbox bind:this={listbox} {items} {selectedIndex} {onSelectedIndexChange} {getKey} {onSelect}
      {listboxLabel} {loading} {groupLabel} {loadingContent} {emptyContent} onCancel={onClose} presentation="palette" maxHeight={maxResultsHeight}>
      {#snippet input(listboxId, activeDescendantId)}
        <div class="search" data-palette-part="input">
          <input
            bind:this={inputElement} data-palette-initial-focus
            aria-label={placeholder} {placeholder} value={query}
            oninput={(event) => onQueryChange(event.currentTarget.value)}
            role="combobox" aria-autocomplete="list" aria-expanded="true"
            aria-controls={listboxId} aria-activedescendant={activeDescendantId}
            autocomplete="off" spellcheck="false"
          />
        </div>
      {/snippet}
      {#snippet item(entry, index, highlighted)}
        {#if leading}<span class="leading" aria-hidden="true">{@render leading(entry)}</span>{/if}
        <div class="content">{@render item(entry, index, highlighted)}</div>
        {#if trailing}<div class="trailing">{@render trailing(entry)}</div>{/if}
      {/snippet}
    </PaletteListbox>
    {#if resultsFooter}{@render resultsFooter()}{/if}
  {/if}
  <div class="footer" data-palette-part="footer">
    <span><kbd>↑↓</kbd> navigate</span>
    <span><kbd>Esc</kbd> {cancelLabel}</span>
    <div class="footer-actions">
      <span class="primary-hint"><kbd aria-label="Enter">↵</kbd> {actionLabel}</span>
      {#if trailingKey}
        <span class="footer-trailing">
          <span class="shortcut" aria-label={trailingKey}>{#each trailingKey.split('+') as key, index}{#if index > 0}<span aria-hidden="true">+</span>{/if}<kbd>{key}</kbd>{/each}</span> {trailingLabel}
        </span>
      {/if}
    </div>
  </div>
</Modal>

<style>
  :global(.of-modal-layer.of-search-palette) {
    align-items: flex-start;
    padding-top: min(15vh, 100px);
  }
  :global(.of-modal-box.of-search-palette-panel) {
    max-height: calc(100dvh - min(15vh, 100px) - var(--of-space4));
    overflow: hidden;
    color: var(--of-text);
    background: var(--of-palette-background, var(--of-surface-raised));
    border-color: var(--of-palette-border, var(--of-border-strong));
    border-radius: var(--of-palette-radius, var(--of-radius-overlay));
    box-shadow: var(--of-palette-shadow, var(--of-shadow-overlay));
    backdrop-filter: var(--of-palette-backdrop-filter, none);
  }
  .alternate { min-height: 0; overflow-y: auto; }
  .search { flex: none; padding: var(--of-space5); border-bottom: var(--of-border-width) solid var(--of-border); }
  input {
    box-sizing: border-box; width: 100%; min-width: 0;
    border: 0; border-radius: var(--of-radius-control); padding: var(--of-space2);
    background: transparent; color: var(--of-text); font: inherit;
    font-size: var(--of-text-lg); line-height: var(--of-line-height-lg);
  }
  input::placeholder { color: var(--of-text-muted); }
  input:focus, input:focus-visible { outline: none; box-shadow: none; }
  .content { flex: 1; min-width: 0; overflow: hidden; overflow-wrap: anywhere; }
  .leading { flex: none; display: flex; align-items: center; color: var(--of-icon); }
  .trailing { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow-wrap: anywhere; color: var(--of-text-secondary); }
  .footer {
    flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: var(--of-space3);
    padding: var(--of-space4);
    color: var(--of-text-secondary); font-size: var(--of-text-sm); line-height: var(--of-line-height-sm);
  }
  .footer > span, .footer-actions > span { display: inline-flex; flex-direction: row-reverse; align-items: center; gap: var(--of-space2); text-transform: capitalize; }
  .shortcut { display: inline-flex; align-items: center; gap: var(--of-space1); }
  .footer-actions {
    margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: var(--of-space4);
    padding: var(--of-space4) var(--of-space5); border-radius: var(--of-radius-overlay);
    background: var(--of-surface-subtle); border: var(--of-border-width) solid var(--of-border);
  }
  .footer-actions > span { color: var(--of-text); font-weight: var(--of-weight-semibold); }
  kbd { font: inherit; font-size: var(--of-text-xs); border: var(--of-border-width) solid var(--of-border); border-radius: var(--of-radius-control); padding: var(--of-space1) var(--of-space2); background: transparent; }
</style>
