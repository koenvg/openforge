<script lang="ts">
  import { Check, ChevronDown, Tags } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
  <Button
    bind:element={trigger}
    type="button"
    size="xs"
    variant={selectedCount > 0 ? 'secondary' : 'outline'}
    class="label-filter-trigger"
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
      <span class="selected-count" aria-hidden="true">{selectedCount}</span>
      <span id={summaryId} class="sr-only">{selectedCount} selected</span>
    {/if}
    <ChevronDown size={13} class="label-filter-chevron {open ? 'rotate-180' : ''}" aria-hidden="true" />
  </Button>

  <AnchoredMenu visible={open} {trigger} id={menuId} detached onClose={() => { open = false }}>
    <div class="max-h-64 min-w-52 overflow-y-auto py-0.5">
      {#each labels as label (label.id)}
        {@const selected = selectedLabelIds.has(label.id)}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          role="menuitemcheckbox"
          aria-checked={selected}
          tabindex="-1"
          class="label-filter-option w-full justify-start gap-2 text-left"
          onclick={() => onToggle(label.id)}
          onkeydown={(event) => handleOptionKeydown(event, label.id)}
        >
          <span class="selection-box" data-selected={selected ? '' : undefined} aria-hidden="true">
            {#if selected}<Check size={12} strokeWidth={2.5} />{/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{label.name}</span>
          <span class="label-count">{labelCounts.get(label.id) ?? 0}</span>
        </Button>
      {/each}
    </div>
  </AnchoredMenu>
</div>

<style>
  .selected-count,
  .selection-box {
    display: inline-grid;
    place-items: center;
    border-radius: var(--of-radius-round);
  }

  .selected-count {
    min-width: var(--of-space4);
    min-height: var(--of-space4);
    padding-inline: var(--of-space1);
    background: var(--of-accent);
    color: var(--of-on-accent);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }

  .selection-box {
    width: var(--of-space4);
    height: var(--of-space4);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
  }

  .selection-box[data-selected] {
    border-color: var(--of-accent);
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  .label-count {
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }

  :global(.label-filter-chevron) {
    transition: transform var(--of-duration-fast) var(--of-ease-standard);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.label-filter-trigger),
    :global(.label-filter-chevron) {
      transition: none;
    }
  }
</style>
