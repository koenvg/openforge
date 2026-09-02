<script lang="ts">
  import { Check, ListFilter } from '@lucide/svelte'

  interface Props {
    active: boolean
    readyCount: number
    onToggle: () => void
  }

  let { active, readyCount, onToggle }: Props = $props()
</script>

<button
  type="button"
  class="btn h-8 min-h-8 gap-1.5 border px-2.5 text-xs font-medium {active
    ? 'border-primary bg-primary/[0.03] text-primary ring-1 ring-primary/20'
    : 'btn-ghost composited-hover-layer border-base-300 bg-base-100 text-base-content'}"
  aria-pressed={active}
  onclick={onToggle}
>
  {#if active}
    <Check size={14} aria-hidden="true" />
  {:else}
    <ListFilter size={14} aria-hidden="true" />
  {/if}
  <span>Ready to start</span>
  <span class="badge badge-ghost badge-xs min-w-4 px-1 font-mono">{readyCount}</span>
</button>
