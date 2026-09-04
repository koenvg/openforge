<script lang="ts">
  import { Check, ListFilter } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'

  interface Props {
    active: boolean
    readyCount: number
    onToggle: () => void
  }

  let { active, readyCount, onToggle }: Props = $props()
</script>

<Button
  type="button"
  size="sm"
  variant={active ? 'outline' : 'secondary'}
  class="backlog-ready-filter gap-1.5 {active ? 'backlog-ready-filter--active' : ''}"
  aria-pressed={active}
  onclick={onToggle}
>
  {#if active}
    <Check size={14} aria-hidden="true" />
  {:else}
    <ListFilter size={14} aria-hidden="true" />
  {/if}
  <span>Ready to start</span>
  <span class="filter-count">{readyCount}</span>
</Button>

<style>
  :global(.backlog-ready-filter--active) {
    color: var(--of-accent);
  }

  .filter-count {
    display: inline-grid;
    min-width: var(--of-space4);
    min-height: var(--of-space4);
    place-items: center;
    padding-inline: var(--of-space1);
    border-radius: var(--of-radius-round);
    background: var(--of-status-neutral-subtle);
    color: var(--of-on-status-neutral);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }
</style>
