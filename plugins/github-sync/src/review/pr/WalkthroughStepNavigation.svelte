<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import type { WalkthroughStepEntry } from '../../lib/walkthroughViewState'

  interface Props {
    entries: WalkthroughStepEntry[]
    activeStepIndex: number
  }

  let { entries, activeStepIndex = $bindable() }: Props = $props()

  function goPrevious(): void {
    activeStepIndex -= 1
  }

  function goNext(): void {
    activeStepIndex += 1
  }

  function stepPillClass(isCurrent: boolean, isVisited: boolean): string {
    if (isCurrent) return 'bg-of-accent text-of-on-accent'
    if (isVisited) return 'bg-of-text/20 text-of-text/70 hover:bg-of-text/30'
    return 'bg-of-border/60 text-of-text/50 hover:bg-of-border'
  }
</script>

<div class="flex items-center gap-3 px-4 py-2 border-b border-of-border bg-of-surface-subtle/40 shrink-0">
  <Button
    variant="outline"
    size="sm"
    class="gap-1 shrink-0"
    onclick={goPrevious}
    disabled={activeStepIndex <= 0}
    title="Previous step (←)"
  >
    <ChevronLeft size={16} aria-hidden="true" />
    Prev
  </Button>

  <div class="flex items-center justify-center gap-1 flex-1 min-w-0 overflow-x-auto">
    {#each entries as entry, index}
      <button
        type="button"
        class="size-[var(--of-control-height-compact)] shrink-0 rounded-[var(--of-radius-round)] text-[11px] font-semibold tabular-nums transition-colors {stepPillClass(index === activeStepIndex, index < activeStepIndex)}"
        onclick={() => (activeStepIndex = index)}
        title={entry.kind === 'ticket'
          ? 'Ticket coverage'
          : entry.kind === 'submit'
            ? 'Review & submit'
            : entry.step.title}
        aria-current={index === activeStepIndex ? 'step' : undefined}
      >{index + 1}</button>
    {/each}
  </div>

  <Button
    size="sm"
    class="gap-1 shrink-0"
    onclick={goNext}
    disabled={activeStepIndex >= entries.length - 1}
    title="Next step (→)"
  >
    Next
    <ChevronRight size={16} aria-hidden="true" />
  </Button>
</div>
