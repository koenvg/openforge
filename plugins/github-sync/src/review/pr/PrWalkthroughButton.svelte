<script lang="ts">
  import type { WalkthroughButtonState } from '../../lib/walkthroughButtonState'

  interface Props {
    state: WalkthroughButtonState
    onGenerate: () => void
  }

  let { state, onGenerate }: Props = $props()

  // The label carries the reason to press it, so a stale walkthrough reads as
  // "new commits" rather than an unexplained second Generate.
  const IDLE_LABELS: Record<'idle' | 'stale' | 'error', string> = {
    idle: 'Generate Walkthrough + AI Review',
    stale: 'Regenerate — new commits',
    error: 'Retry — generation failed',
  }
</script>

{#if state === 'ready'}
  <span class="inline-flex items-center gap-1 text-xs text-success" aria-label="Walkthrough ready">
    <span class="inline-block w-1.5 h-1.5 rounded-full bg-success"></span>
    Walkthrough ready
  </span>
{:else if state === 'generating'}
  <button type="button" class="btn btn-xs btn-ghost gap-1" disabled aria-label="Generating walkthrough">
    <span class="loading loading-spinner loading-xs"></span>
    Generating…
  </button>
{:else}
  <button
    type="button"
    class="btn btn-xs btn-outline"
    aria-label="Generate walkthrough and AI review"
    onclick={(e) => { e.stopPropagation(); onGenerate() }}
  >
    {IDLE_LABELS[state]}
  </button>
{/if}
