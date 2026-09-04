<script lang="ts">
  import { tick } from 'svelte'
  import { Search, X } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
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
  <div class="flex h-[var(--of-control-height-touch)] shrink-0 items-center gap-2 border-t border-[var(--of-border)] bg-[var(--of-surface)] px-4" role="search">
    <Search size={15} class="shrink-0 text-[var(--of-icon-muted)]" aria-hidden="true" />
    <span class="font-mono text-sm text-[var(--of-accent)]" aria-hidden="true">/</span>
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      aria-label="Filter tasks"
      aria-keyshortcuts="/"
      placeholder="Filter tasks…"
      class="min-w-0 flex-1 bg-transparent text-sm text-[var(--of-text)] outline-none placeholder:text-[var(--of-text-muted)]"
      onkeydown={handleInputKeydown}
    />
    <span class="text-xs text-[var(--of-text-muted)]">Enter to apply · Esc to clear</span>
  </div>
{:else if query.trim()}
  <div class="flex h-[var(--of-control-height-touch)] shrink-0 items-center gap-2 border-t border-[var(--of-border)] bg-[var(--of-surface)] px-4" aria-label="Active task filter">
    <Search size={15} class="shrink-0 text-[var(--of-icon-muted)]" aria-hidden="true" />
    <Button
      type="button"
      size="sm"
      variant="ghost"
      class="min-w-0 flex-1 justify-start truncate text-left font-mono"
      aria-label={`Edit task filter: ${query}`}
      onclick={() => void edit()}
    >
      / {query}
    </Button>
    <span class="text-xs text-[var(--of-text-muted)]" aria-live="polite">{matchingCount} matching</span>
    <IconButton
      type="button"
      size="sm"
      variant="ghost"
      label="Clear task filter"
      onclick={clear}
    >
      <X size={16} aria-hidden="true" />
    </IconButton>
  </div>
{/if}
