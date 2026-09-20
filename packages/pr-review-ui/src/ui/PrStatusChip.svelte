<script lang="ts">
  import { Check, X, Clock } from '@lucide/svelte';
  import type { PrStatusChipSpec } from '@openforge-app/plugin-sdk/prStatusPresentation';

  let { chip }: { chip: PrStatusChipSpec } = $props();

  const variantClasses: Record<PrStatusChipSpec['variant'], { bg: string, dot: string, text: string }> = {
    success: { bg: 'bg-of-success/15', dot: 'bg-of-success', text: 'text-of-success' },
    error: { bg: 'bg-of-danger/15', dot: 'bg-of-danger', text: 'text-of-danger' },
    pending: { bg: 'bg-of-warning/15', dot: 'bg-of-warning', text: 'text-of-warning' },
    muted: { bg: 'bg-of-text/15', dot: '', text: 'text-of-text/50' },
    neutral: { bg: 'bg-of-text/15', dot: 'bg-of-text/50', text: 'text-of-text/50' },
    done: { bg: 'bg-of-accent/15', dot: 'bg-of-accent', text: 'text-of-accent' },
    merged: { bg: 'bg-of-control/15', dot: '', text: 'text-of-control' },
    closed: { bg: 'bg-of-control/15', dot: '', text: 'text-of-control' }
  };

  const detailClasses: Record<PrStatusChipSpec['variant'], string> = {
    success: 'bg-of-success/15 text-of-success',
    error: 'bg-of-danger/15 text-of-danger',
    pending: 'bg-of-warning/15 text-of-warning',
    muted: 'bg-of-text/15 text-of-text/50',
    neutral: 'bg-of-text/15 text-of-text/50',
    done: 'bg-of-accent/15 text-of-accent',
    merged: 'bg-of-control/15 text-of-control',
    closed: 'bg-of-control/15 text-of-control'
  };
</script>

{#if chip.surface === 'detail'}
  <!-- Detail surface -->
  <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-[var(--of-radius-container)] {detailClasses[chip.variant]} flex items-center gap-1 w-fit">
    {#if chip.icon === 'check'}<Check class="w-3 h-3" />
    {:else if chip.icon === 'cross'}<X class="w-3 h-3" />
    {:else if chip.icon === 'clock'}<Clock class="w-3 h-3" />
    {/if}
    {chip.label}
  </span>
{:else}
  <!-- Compact surface -->
  <span
    class="inline-flex items-center gap-1.5 rounded-[var(--of-radius-round)] px-2.5 py-1.5 {variantClasses[chip.variant].bg}"
  >
    {#if chip.icon === 'check'}<Check class="w-3.5 h-3.5 {variantClasses[chip.variant].text}" aria-hidden="true" />
    {:else if chip.icon === 'cross'}<X class="w-3.5 h-3.5 {variantClasses[chip.variant].text}" aria-hidden="true" />
    {:else if chip.icon === 'clock'}<Clock class="w-3.5 h-3.5 {variantClasses[chip.variant].text}" aria-hidden="true" />
    {:else if chip.variant !== 'muted'}
      <span class="w-1.5 h-1.5 rounded-[var(--of-radius-round)] {variantClasses[chip.variant].dot}"></span>
    {/if}
    <span class="text-xs font-semibold {variantClasses[chip.variant].text}">{chip.label}</span>
  </span>
{/if}
