<script lang="ts">
  import type { WalkthroughButtonState } from '../../lib/walkthroughButtonState'

  interface Props {
    state: WalkthroughButtonState
    onGenerate: () => void
    /** Stops an in-flight generation. Omitted where a stop isn't wired up. */
    onStop?: () => void
  }

  let { state, onGenerate, onStop }: Props = $props()

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
  <span class="inline-flex items-center gap-1">
    <span class="inline-flex items-center gap-1 text-xs text-base-content/60" aria-label="Generating walkthrough">
      <span class="loading loading-spinner loading-xs"></span>
      Generating…
    </span>
    {#if onStop}
      <button
        type="button"
        class="btn btn-xs btn-ghost text-error"
        aria-label="Stop walkthrough generation"
        onclick={(e) => { e.stopPropagation(); onStop?.() }}
      >
        Stop
      </button>
    {/if}
  </span>
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
