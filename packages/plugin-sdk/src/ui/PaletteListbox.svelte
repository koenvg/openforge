<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { fromAction } from 'svelte/attachments'
  import { useListNavigation } from '../listNavigation.js'
  import { paletteSelection } from './paletteSelection.js'

  interface Props {
    items: T[]
    selectedIndex: number
    onSelectedIndexChange: (index: number) => void
    onSelect: (item: T) => void
    getKey: (item: T) => string
    listboxLabel: string
    onCancel?: () => void
    wrap?: boolean
    visible?: boolean
    loading?: boolean
    presentation?: 'inline' | 'palette'
    listClass?: string
    maxHeight?: string
    optionClass?: (item: T, index: number, highlighted: boolean) => string
    groupLabel?: (item: T, index: number) => string | null
    input?: Snippet<[string, string | undefined]>
    item: Snippet<[T, number, boolean]>
    loadingContent?: Snippet
    emptyContent?: Snippet
  }

  let {
    items, selectedIndex, onSelectedIndexChange, onSelect, getKey, listboxLabel, onCancel,
    wrap = true, visible = true, loading = false, presentation = 'inline', listClass = '', maxHeight,
    optionClass, groupLabel, input, item, loadingContent, emptyContent,
  }: Props = $props()

  const instanceId = $props.id()
  const listboxId = `${instanceId}-results`
  let listElement: HTMLDivElement | undefined = $state()
  let activeDescendantId = $derived(visible && !loading && selectedIndex >= 0 && selectedIndex < items.length
    ? optionId(items[selectedIndex]) : undefined)
  const selection = fromAction(paletteSelection, () => activeDescendantId)

  function optionId(value: T): string {
    return `${listboxId}-${encodeURIComponent(getKey(value))}`
  }

  const navigation = useListNavigation({
    get itemCount() { return visible && !loading ? items.length : 0 },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) { onSelectedIndexChange(index) },
    get wrap() { return wrap },
    onSelect() { if (activeDescendantId) onSelect(items[selectedIndex]) },
    onCancel: () => onCancel?.(),
  })

  export function handleKeydown(event: KeyboardEvent): boolean {
    if (!visible || (event.key === 'Escape' && !onCancel)) return false
    return navigation.handleKeydown(event)
  }

  $effect(() => {
    if (!activeDescendantId || !listElement) return
    const option = Array.from(listElement.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(element => element.id === activeDescendantId)
    option?.scrollIntoView?.({ block: 'nearest' })
  })
</script>

{#if input}{@render input(listboxId, activeDescendantId)}{/if}
{#if visible}
  {#if loading || items.length === 0}
    <div id={listboxId} class="state {listClass}" style:max-height={maxHeight} data-palette-part="list" role="status" aria-live="polite" aria-atomic="true">
      {#if loading}
        {#if loadingContent}{@render loadingContent()}{/if}
      {:else}
        {#if emptyContent}{@render emptyContent()}{/if}
      {/if}
    </div>
  {:else}
    <div bind:this={listElement} {@attach presentation === 'palette' ? selection : undefined}
      id={listboxId} class="results {listClass}" class:palette={presentation === 'palette'} style:max-height={maxHeight}
      data-palette-part="list" role="listbox" aria-label={listboxLabel} tabindex="-1">
      {#if presentation === 'palette'}<span class="selection" data-palette-part="selection" aria-hidden="true"></span>{/if}
      {#each items as entry, index (getKey(entry))}
        {@const heading = groupLabel?.(entry, index)}
        {#if heading}<div class="heading" data-palette-part="group" role="presentation">{heading}</div>{/if}
        <div id={optionId(entry)} role="option" aria-selected={index === selectedIndex} tabindex="-1"
          data-palette-item data-palette-part="option" data-selected={index === selectedIndex ? '' : undefined}
          class={optionClass ? optionClass(entry, index, index === selectedIndex) : 'option'}
          onmousedown={(event) => event.preventDefault()} onclick={() => onSelect(entry)}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onSelect(entry)
          }}>
          {@render item(entry, index, index === selectedIndex)}
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .results { min-height: 0; overflow-y: auto; }
  .palette { position: relative; isolation: isolate; padding: var(--of-space4) var(--of-space2); }
  .selection { position: absolute; top: 0; z-index: -1; pointer-events: none; opacity: 0; border-radius: var(--of-radius-control); background: var(--of-palette-selection, var(--of-accent-subtle)); }
  .state { min-height: 0; overflow-y: auto; padding: var(--of-space6); color: var(--of-text-muted); text-align: center; }
  .heading { padding: var(--of-space4) var(--of-space3) var(--of-space3); color: var(--of-text); font-size: var(--of-text-sm); font-weight: var(--of-weight-semibold); }
  .option {
    display: flex; align-items: center; gap: var(--of-space3);
    padding: var(--of-space3); border-radius: var(--of-radius-control);
    font-size: var(--of-text-md); line-height: var(--of-line-height-md); cursor: pointer;
  }
  .option:not([data-selected]):hover { background: var(--of-control-hover); }
  .results:not(.palette) .option[data-selected] { background: var(--of-accent-subtle); }
</style>
