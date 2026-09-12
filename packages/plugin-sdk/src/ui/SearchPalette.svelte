<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'
  import Modal from './Modal.svelte'
  import { useListNavigation } from '../listNavigation.js'
  import { paletteSelection } from './paletteSelection.js'

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
    actionLabel, cancelLabel = 'close', trailingKey, trailingLabel = 'navigate', testId,
    alternateContent, alternateInitialFocus, onKeydown,
  }: Props = $props()

  const instanceId = $props.id()
  const listboxId = `${instanceId}-results`
  let listElement: HTMLDivElement | undefined = $state()
  let activeDescendantId = $derived(!alternateContent && !loading && selectedIndex >= 0 && selectedIndex < items.length
    ? optionId(items[selectedIndex]) : undefined)

  function optionId(value: T): string {
    return `${listboxId}-${encodeURIComponent(getKey(value))}`
  }

  const navigation = useListNavigation({
    get itemCount() { return loading ? 0 : items.length },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) { onSelectedIndexChange(index) },
    wrap: true,
    onSelect() {
      if (activeDescendantId) onSelect(items[selectedIndex])
    },
    onCancel: () => onClose(),
  })

  $effect(() => {
    if (!activeDescendantId || !listElement) return
    const option = Array.from(listElement.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(element => element.id === activeDescendantId)
    option?.scrollIntoView?.({ block: 'nearest' })
  })

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
    return navigation.handleKeydown(event)
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
  <div class="search" data-palette-part="input">
    <input
      bind:this={inputElement}
      data-palette-initial-focus
      aria-label={placeholder} {placeholder} value={query}
      oninput={(event) => onQueryChange(event.currentTarget.value)}
      role="combobox" aria-autocomplete="list" aria-expanded="true"
      aria-controls={listboxId} aria-activedescendant={activeDescendantId}
      autocomplete="off" spellcheck="false"
    />
  </div>
  {#if loading || items.length === 0}
    <div id={listboxId} class="state" data-palette-part="list" role="status" aria-live="polite" aria-atomic="true">
      {#if loading}
        {#if loadingContent}{@render loadingContent()}{/if}
      {:else}
        {#if emptyContent}{@render emptyContent()}{/if}
      {/if}
    </div>
  {:else}
    <div bind:this={listElement} use:paletteSelection={activeDescendantId} id={listboxId} class="results" data-palette-part="list" role="listbox" aria-label={listboxLabel}>
      <span class="selection" data-palette-part="selection" aria-hidden="true"></span>
      {#each items as entry, index (getKey(entry))}
        {@const heading = groupLabel?.(entry, index)}
        {#if heading}<div class="heading" data-palette-part="group" role="presentation">{heading}</div>{/if}
        <div
          id={optionId(entry)} role="option" aria-selected={index === selectedIndex}
          tabindex="-1" data-palette-item data-palette-part="option"
          data-selected={index === selectedIndex ? '' : undefined}
          class="option"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => onSelect(entry)}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onSelect(entry)
          }}
        >
          {#if leading}<span class="leading" aria-hidden="true">{@render leading(entry)}</span>{/if}
          <div class="content">{@render item(entry, index, index === selectedIndex)}</div>
          {#if trailing}<div class="trailing">{@render trailing(entry)}</div>{/if}
        </div>
      {/each}
    </div>
  {/if}
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
  .results { position: relative; isolation: isolate; min-height: 0; overflow-y: auto; padding: var(--of-space4) var(--of-space2); }
  .selection { position: absolute; top: 0; z-index: -1; pointer-events: none; opacity: 0; border-radius: var(--of-radius-control); background: var(--of-palette-selection, var(--of-accent-subtle)); }
  .state { min-height: 0; overflow-y: auto; padding: var(--of-space6); color: var(--of-text-muted); text-align: center; }
  .heading { padding: var(--of-space4) var(--of-space3) var(--of-space3); color: var(--of-text); font-size: var(--of-text-sm); font-weight: var(--of-weight-semibold); }
  .option {
    display: flex; align-items: center; gap: var(--of-space3);
    padding: var(--of-space3); border-radius: var(--of-radius-control);
    font-size: var(--of-text-md); line-height: var(--of-line-height-md); cursor: pointer;
  }
  .option:not([data-selected]):hover { background: var(--of-control-hover); }
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
