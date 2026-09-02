<script lang="ts">
  import { Check, ChevronDown, Tags } from '@lucide/svelte'
  import type { TaskLabel } from '../../lib/types'
  import AnchoredMenu from '../shared/ui/AnchoredMenu.svelte'

  interface Props {
    labels: TaskLabel[]
    labelCounts: ReadonlyMap<number, number>
    selectedLabelIds: ReadonlySet<number>
    onToggle: (labelId: number) => void
  }

  let { labels, labelCounts, selectedLabelIds, onToggle }: Props = $props()

  let open = $state(false)
  let trigger = $state<HTMLButtonElement | null>(null)
  const menuId = `backlog-label-filter-menu-${Math.random().toString(36).slice(2)}`
  const summaryId = `${menuId}-summary`

  let selectedCount = $derived(labels.filter((label) => selectedLabelIds.has(label.id)).length)

  function toggleOpen() {
    open = !open
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    toggleOpen()
  }

  function handleOptionKeydown(event: KeyboardEvent, labelId: number) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onToggle(labelId)
  }
</script>

<div class="relative inline-flex">
  <button
    bind:this={trigger}
    type="button"
    class="btn btn-ghost h-8 min-h-8 gap-1.5 border border-base-300 bg-base-100 px-2.5 text-xs font-medium"
    aria-label="Filter by Task Labels"
    aria-haspopup="menu"
    aria-controls={menuId}
    aria-expanded={open}
    aria-describedby={selectedCount > 0 ? summaryId : undefined}
    onclick={toggleOpen}
    onkeydown={handleTriggerKeydown}
  >
    <Tags size={14} aria-hidden="true" />
    <span>Labels</span>
    {#if selectedCount > 0}
      <span class="badge badge-primary badge-xs min-w-4 px-1 font-mono" aria-hidden="true">{selectedCount}</span>
      <span id={summaryId} class="sr-only">{selectedCount} selected</span>
    {/if}
    <ChevronDown size={13} class="transition-transform duration-150 {open ? 'rotate-180' : ''}" aria-hidden="true" />
  </button>

  <AnchoredMenu visible={open} {trigger} id={menuId} detached onClose={() => { open = false }}>
    <div class="max-h-64 min-w-52 overflow-y-auto py-0.5">
      {#each labels as label (label.id)}
        {@const selected = selectedLabelIds.has(label.id)}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={selected}
          tabindex="-1"
          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-base-content hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
          onclick={() => onToggle(label.id)}
          onkeydown={(event) => handleOptionKeydown(event, label.id)}
        >
          <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border {selected ? 'border-primary bg-primary text-primary-content' : 'border-base-content/25'}" aria-hidden="true">
            {#if selected}<Check size={12} strokeWidth={2.5} />{/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{label.name}</span>
          <span class="font-mono text-[10px] text-base-content/55">{labelCounts.get(label.id) ?? 0}</span>
        </button>
      {/each}
    </div>
  </AnchoredMenu>
</div>
