<script module lang="ts">
  let paletteListboxInstance = 0
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { useListNavigation } from '../../../lib/useListNavigation.svelte'

  interface Props {
    items: T[]
    selectedIndex: number
    onSelectedIndexChange: (index: number) => void
    onSelect: (item: T) => void
    getKey: (item: T) => string
    idPrefix: string
    listboxLabel: string
    onCancel?: () => void
    wrap?: boolean
    visible?: boolean
    loading?: boolean
    listClass?: string
    optionClass?: (item: T, index: number, highlighted: boolean) => string
    groupLabel?: (item: T, index: number) => string | null
    input?: Snippet<[string, string | undefined]>
    item: Snippet<[T, number, boolean]>
    loadingContent?: Snippet
    emptyContent?: Snippet
  }

  let {
    items,
    selectedIndex,
    onSelectedIndexChange,
    onSelect,
    getKey,
    idPrefix,
    listboxLabel,
    onCancel,
    wrap = true,
    visible = true,
    loading = false,
    listClass = '',
    optionClass = (_item: T, _index: number, highlighted: boolean) => highlighted ? 'bg-base-300' : 'hover:bg-base-300/60',
    groupLabel,
    input,
    item,
    loadingContent,
    emptyContent,
  }: Props = $props()

  const instanceId = paletteListboxInstance++
  let listboxId = $derived(`${idPrefix}-listbox-${instanceId}`)
  let listElement: HTMLDivElement | null = $state(null)

  let activeDescendantId = $derived(
    visible && !loading && selectedIndex >= 0 && selectedIndex < items.length
      ? optionId(items[selectedIndex])
      : undefined
  )

  function optionId(option: T): string {
    return `${listboxId}-option-${encodeURIComponent(getKey(option))}`
  }

  const navigation = useListNavigation({
    get itemCount() { return visible && !loading ? items.length : 0 },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) { onSelectedIndexChange(index) },
    get wrap() { return wrap },
    onSelect() {
      const selected = items[selectedIndex]
      if (!loading && selected) onSelect(selected)
    },
    onCancel() { onCancel?.() },
  })

  export function handleKeydown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && !onCancel) return false
    return navigation.handleKeydown(event)
  }

  $effect(() => {
    if (!listElement || !activeDescendantId) return
    const option = Array.from(listElement.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(candidate => candidate.id === activeDescendantId)
    option?.scrollIntoView?.({ block: 'nearest' })
  })
</script>

{#if input}
  {@render input(listboxId, activeDescendantId)}
{/if}

{#if visible}
  {#if loading || items.length === 0}
    <div id={listboxId} class={listClass} role="status" aria-live="polite" aria-atomic="true">
      {#if loading}
        {#if loadingContent}{@render loadingContent()}{/if}
      {:else}
        {#if emptyContent}{@render emptyContent()}{/if}
      {/if}
    </div>
  {:else}
    <div
      bind:this={listElement}
      id={listboxId}
      class={listClass}
      role="listbox"
      aria-label={listboxLabel}
    >
      {#each items as option, index (getKey(option))}
        {@const label = groupLabel?.(option, index)}
        {#if label}
          <div role="presentation" class="text-[10px] text-base-content/40 uppercase tracking-wider px-4 pt-3 pb-1">{label}</div>
        {/if}
        <div
          id={optionId(option)}
          role="option"
          aria-selected={index === selectedIndex}
          tabindex="-1"
          data-palette-item
          class={optionClass(option, index, index === selectedIndex)}
          onclick={() => onSelect(option)}
          onmousedown={(event: MouseEvent) => event.preventDefault()}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect(option)
          }}
        >
          {@render item(option, index, index === selectedIndex)}
        </div>
      {/each}
    </div>
  {/if}
{/if}
