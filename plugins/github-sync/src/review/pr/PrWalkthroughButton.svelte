<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
  <Badge variant="success" aria-label="Walkthrough ready">Walkthrough ready</Badge>
{:else if state === 'generating'}
  <span class="inline-flex items-center gap-1">
    <span class="inline-flex items-center gap-1 text-xs text-base-content/60" aria-label="Generating walkthrough">
      <span class="loading loading-spinner loading-xs"></span>
      Generating…
    </span>
    {#if onStop}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class="text-error"
        aria-label="Stop walkthrough generation"
        onclick={(event) => { event.stopPropagation(); onStop?.() }}
      >
        Stop
      </Button>
    {/if}
  </span>
{:else}
  <Button
    type="button"
    variant="outline"
    size="xs"
    aria-label="Generate walkthrough and AI review"
    onclick={(event) => { event.stopPropagation(); onGenerate() }}
  >
    {IDLE_LABELS[state]}
  </Button>
{/if}
