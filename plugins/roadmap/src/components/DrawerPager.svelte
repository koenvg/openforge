<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'

  interface Props {
    /** 0-based position within the group; the label reads 1-based. */
    index: number
    total: number
    groupTitle: string
    onPrev: () => void
    onNext: () => void
  }

  let { index, total, groupTitle, onPrev, onNext }: Props = $props()

  // Nothing to step to in a group of one. Rendered disabled rather than hidden so the
  // header doesn't reflow between issues.
  let alone = $derived(total <= 1)
</script>

<div class="flex items-center gap-1 min-w-0">
  <button
    type="button"
    class="btn btn-sm btn-square shrink-0"
    onclick={onPrev}
    disabled={alone}
    aria-label={`Previous issue in ${groupTitle}`}
  >
    <ChevronLeft size={16} />
  </button>
  <span
    class="text-xs text-base-content/60 truncate max-w-[24ch]"
    title={groupTitle}
    aria-live="polite"
  >
    {index + 1} of {total} · {groupTitle}
  </span>
  <button
    type="button"
    class="btn btn-sm btn-square shrink-0"
    onclick={onNext}
    disabled={alone}
    aria-label={`Next issue in ${groupTitle}`}
  >
    <ChevronRight size={16} />
  </button>
</div>
