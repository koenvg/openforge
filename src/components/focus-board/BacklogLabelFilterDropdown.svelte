<script lang="ts">
  import { Check, ChevronDown, Tags } from '@lucide/svelte'
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'
  import type { TaskLabel } from '../../lib/types'

  interface Props {
    labels: TaskLabel[]
    labelCounts: ReadonlyMap<number, number>
    selectedLabelIds: ReadonlySet<number>
    onToggle: (labelId: number) => void
  }

  let { labels, labelCounts, selectedLabelIds, onToggle }: Props = $props()
  let open = $state(false)
  const generatedId = $props.id()
  const summaryId = `backlog-label-filter-summary-${generatedId}`

  let selectedCount = $derived(labels.filter((label) => selectedLabelIds.has(label.id)).length)
  let labelByValue = $derived(new Map(labels.map((label) => [String(label.id), label])))
  let menuItems = $derived(labels.map((label) => ({
    value: String(label.id),
    label: label.name,
    checked: selectedLabelIds.has(label.id),
    closeOnSelect: false,
  })))

  function handleSelect(value: string) {
    const labelId = Number(value)
    if (Number.isInteger(labelId)) onToggle(labelId)
  }
</script>

<AnchoredMenu
  label="Filter by Task Labels"
  items={menuItems}
  bind:open
  align="end"
  ariaDescribedby={selectedCount > 0 ? summaryId : undefined}
  onSelect={handleSelect}
>
  {#snippet trigger()}
    <Tags size={14} aria-hidden="true" />
    <span>Labels</span>
    {#if selectedCount > 0}
      <span class="selected-count" aria-hidden="true">{selectedCount}</span>
      <span id={summaryId} class="sr-only">{selectedCount} selected</span>
    {/if}
    <ChevronDown size={13} class="label-filter-chevron {open ? 'rotate-180' : ''}" aria-hidden="true" />
  {/snippet}
  {#snippet item(item)}
    {@const label = labelByValue.get(item.value)}
    {#if label}
      <span class="selection-box" data-selected={item.checked ? '' : undefined} aria-hidden="true">
        {#if item.checked}<Check size={12} strokeWidth={2.5} />{/if}
      </span>
      <span class="min-w-0 flex-1 truncate">{label.name}</span>
      <span class="label-count">{labelCounts.get(label.id) ?? 0}</span>
    {/if}
  {/snippet}
</AnchoredMenu>

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
    :global(.label-filter-chevron) {
      transition: none;
    }
  }
</style>
