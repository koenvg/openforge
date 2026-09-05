<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { isInputFocused } from '../../lib/domUtils'
  import { clampStepIndex, type WalkthroughStepEntry } from '../../lib/walkthroughViewState'

  interface Props {
    entries: WalkthroughStepEntry[]
    activeStepIndex: number
  }

  let { entries, activeStepIndex = $bindable() }: Props = $props()
  let currentIndex = $derived(clampStepIndex(activeStepIndex, entries.length))

  function selectStep(index: number): void {
    activeStepIndex = clampStepIndex(index, entries.length)
  }

  function goPrevious(): void {
    selectStep(activeStepIndex - 1)
  }

  function goNext(): void {
    selectStep(activeStepIndex + 1)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isInputFocused() || entries.length === 0) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goPrevious()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      goNext()
    }
  }

  function stepPillClass(isCurrent: boolean, isVisited: boolean): string {
    if (isCurrent) return 'bg-primary text-primary-content'
    if (isVisited) return 'bg-base-content/20 text-base-content/70 hover:bg-base-content/30'
    return 'bg-base-300/60 text-base-content/50 hover:bg-base-300'
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-200/40 shrink-0">
  <Button
    variant="outline"
    size="sm"
    class="gap-1 shrink-0"
    onclick={goPrevious}
    disabled={currentIndex <= 0}
    title="Previous step (←)"
  >
    <ChevronLeft size={16} aria-hidden="true" />
    Prev
  </Button>

  <div class="flex items-center justify-center gap-1 flex-1 min-w-0 overflow-x-auto">
    {#each entries as entry, index}
      <button
        type="button"
        class="size-[var(--of-control-height-compact)] shrink-0 rounded-[var(--of-radius-round)] text-[11px] font-semibold tabular-nums transition-colors {stepPillClass(index === currentIndex, index < currentIndex)}"
        onclick={() => selectStep(index)}
        title={entry.kind === 'ticket'
          ? 'Ticket coverage'
          : entry.kind === 'submit'
            ? 'Review & submit'
            : entry.step.title}
        aria-current={index === currentIndex ? 'step' : undefined}
      >{index + 1}</button>
    {/each}
  </div>

  <Button
    size="sm"
    class="gap-1 shrink-0"
    onclick={goNext}
    disabled={currentIndex >= entries.length - 1}
    title="Next step (→)"
  >
    Next
    <ChevronRight size={16} aria-hidden="true" />
  </Button>
</div>
