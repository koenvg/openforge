<script lang="ts">
  import { tick } from 'svelte'
  import Badge from './Badge.svelte'

  type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

  interface Option {
    value: string
    label: string
    badge?: string
    badgeVariant?: BadgeVariant
  }

  interface Props {
    options: Option[]
    value: string
    placeholder?: string
    size?: 'xs' | 'sm' | 'md'
    ariaLabel?: string
    onSelect: (value: string) => void
  }

  let { options, value, placeholder = 'Search...', size = 'sm', ariaLabel, onSelect }: Props = $props()

  let query = $state('')
  let open = $state(false)
  let highlightedIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLUListElement | null>(null)
  const listboxId = `searchable-select-listbox-${Math.random().toString(36).slice(2)}`

  let selectedOption = $derived(options.find(o => o.value === value) ?? null)
  let selectedLabel = $derived(selectedOption?.label ?? '')

  let filtered = $derived.by(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  })

  $effect(() => {
    filtered
    highlightedIndex = 0
  })

  $effect(() => {
    if (open && listEl) {
      const element = listEl.children.item(highlightedIndex)
      if (element instanceof HTMLElement) {
        element.scrollIntoView?.({ block: 'nearest' })
      }
    }
  })

  function openDropdown() {
    query = ''
    open = true
    highlightedIndex = 0
    tick().then(() => inputEl?.focus())
  }

  function closeDropdown() {
    open = false
    query = ''
  }

  function selectOption(option: Option) {
    onSelect(option.value)
    closeDropdown()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return
    if (filtered.length === 0 && event.key !== 'Escape') return

    if (event.key === 'ArrowDown' || (event.ctrlKey && (event.key === 'j' || event.key === 'n'))) {
      event.preventDefault()
      event.stopPropagation()
      highlightedIndex = Math.min(highlightedIndex + 1, filtered.length - 1)
      return
    }

    if (event.key === 'ArrowUp' || (event.ctrlKey && (event.key === 'k' || event.key === 'p'))) {
      event.preventDefault()
      event.stopPropagation()
      highlightedIndex = Math.max(highlightedIndex - 1, 0)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const option = filtered[highlightedIndex]
      if (option) selectOption(option)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeDropdown()
    }
  }
</script>

<div class="searchable-select">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="searchable-select-trigger"
    data-size={size}
    onclick={openDropdown}
    onkeydown={(event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        openDropdown()
      }
    }}
    role="combobox"
    aria-label={ariaLabel}
    aria-controls={listboxId}
    aria-expanded={open}
    tabindex="0"
  >
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate">{selectedLabel || placeholder}</span>
      {#if selectedOption?.badge}
        <Badge variant={selectedOption.badgeVariant ?? 'neutral'} class="shrink-0">{selectedOption.badge}</Badge>
      {/if}
    </span>
  </div>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div role="presentation" class="fixed inset-0 z-40" onclick={closeDropdown}></div>
    <div class="searchable-select-popover">
      <div class="searchable-select-search">
        <input
          bind:this={inputEl}
          type="text"
          class="searchable-select-input"
          aria-label="Search options"
          placeholder="Search..."
          bind:value={query}
          onkeydown={handleKeydown}
        />
      </div>
      <ul
        id={listboxId}
        bind:this={listEl}
        class="max-h-[200px] overflow-y-auto py-1"
        role="listbox"
      >
        {#each filtered as option, index (option.value)}
          <li
            role="option"
            aria-selected={index === highlightedIndex}
            data-highlighted={index === highlightedIndex ? '' : undefined}
            data-current={option.value === value && index !== highlightedIndex ? '' : undefined}
            tabindex="-1"
            class="searchable-select-option"
            onclick={() => selectOption(option)}
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                selectOption(option)
              }
            }}
            onmouseenter={() => { highlightedIndex = index }}
          >
            <span class="flex min-w-0 items-center justify-between gap-2">
              <span class="truncate">{option.label}</span>
              {#if option.badge}
                <Badge variant={option.badgeVariant ?? 'neutral'} class="shrink-0">{option.badge}</Badge>
              {/if}
            </span>
          </li>
        {:else}
          <li class="px-3 py-2 text-xs text-[var(--of-text-muted)]">No matches</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .searchable-select {
    position: relative;
  }

  .searchable-select-trigger,
  .searchable-select-input {
    box-sizing: border-box;
    width: 100%;
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-text);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-sm);
  }

  .searchable-select-trigger {
    display: flex;
    min-height: var(--of-control-height);
    align-items: center;
    padding-inline: var(--of-space3);
    cursor: pointer;
  }

  .searchable-select-trigger[data-size='xs'],
  .searchable-select-trigger[data-size='sm'] {
    min-height: var(--of-control-height-compact);
    font-size: var(--of-text-xs);
  }

  .searchable-select-trigger:hover,
  .searchable-select-input:hover {
    background: var(--of-field-hover);
  }

  .searchable-select-trigger:focus-visible,
  .searchable-select-input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .searchable-select-popover {
    position: absolute;
    z-index: 50;
    top: calc(100% + var(--of-space1));
    right: 0;
    left: 0;
    overflow: hidden;
    border: var(--of-border-width) solid var(--of-border-strong);
    border-radius: var(--of-radius-overlay);
    background: var(--of-surface-raised);
    color: var(--of-text);
    box-shadow: var(--of-shadow-raised);
  }

  .searchable-select-search {
    padding: var(--of-space2);
    border-bottom: var(--of-border-width) solid var(--of-border);
  }

  .searchable-select-input {
    min-height: var(--of-control-height-compact);
    padding-inline: var(--of-space3);
  }

  .searchable-select-option {
    padding: var(--of-space2) var(--of-space3);
    color: var(--of-text);
    font-size: var(--of-text-sm);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  .searchable-select-option[data-highlighted] {
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  .searchable-select-option[data-current] {
    color: var(--of-accent);
    font-weight: var(--of-weight-medium);
  }

  @media (prefers-reduced-motion: reduce) {
    .searchable-select-option {
      transition: none;
    }
  }
</style>
