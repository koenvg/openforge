<script lang="ts">
  import { tick } from 'svelte'
  import { Search, X } from '@lucide/svelte'
  import { isInputFocused } from '../../lib/domUtils'

  interface Props {
    query: string
    matchingCount: number
    shortcutBlocked: boolean
    onBoardKeydown: (event: KeyboardEvent) => void
  }

  let {
    query = $bindable(),
    matchingCount,
    shortcutBlocked,
    onBoardKeydown,
  }: Props = $props()
  let isEditing = $state(false)
  let input: HTMLInputElement | null = $state(null)

  async function edit() {
    isEditing = true
    await tick()
    input?.focus()
  }

  function clear() {
    query = ''
    isEditing = false
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.stopPropagation()
      event.preventDefault()
      isEditing = false
    } else if (event.key === 'Escape') {
      event.preventDefault()
      clear()
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (isInputFocused()) return
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement.closest('[role="dialog"], [role="menu"]')) return

    if (event.key === 'Escape' && query.trim()) {
      event.preventDefault()
      clear()
      return
    }

    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !shortcutBlocked) {
      event.preventDefault()
      void edit()
      return
    }
    onBoardKeydown(event)
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if isEditing}
  <div class="flex h-11 shrink-0 items-center gap-2 border-t border-base-300 bg-base-100 px-4" role="search">
    <Search size={15} class="shrink-0 text-base-content/45" aria-hidden="true" />
    <span class="font-mono text-sm text-primary" aria-hidden="true">/</span>
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      aria-label="Filter tasks"
      aria-keyshortcuts="/"
      placeholder="Filter tasks…"
      class="min-w-0 flex-1 bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/35"
      onkeydown={handleInputKeydown}
    />
    <span class="text-xs text-base-content/45">Enter to apply · Esc to clear</span>
  </div>
{:else if query.trim()}
  <div class="flex h-11 shrink-0 items-center gap-2 border-t border-base-300 bg-base-100 px-4" aria-label="Active task filter">
    <Search size={15} class="shrink-0 text-base-content/45" aria-hidden="true" />
    <button
      type="button"
      class="min-w-0 flex-1 truncate rounded px-1 py-1 text-left font-mono text-sm text-base-content hover:bg-base-200/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={`Edit task filter: ${query}`}
      onclick={() => void edit()}
    >
      / {query}
    </button>
    <span class="text-xs text-base-content/45" aria-live="polite">{matchingCount} matching</span>
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-square"
      aria-label="Clear task filter"
      onclick={clear}
    >
      <X size={16} aria-hidden="true" />
    </button>
  </div>
{/if}
