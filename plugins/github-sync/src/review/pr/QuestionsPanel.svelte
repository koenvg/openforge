<script lang="ts">
  import { X } from '@lucide/svelte'
  import type { QuestionGroupKey, QuestionItem, QuestionsIndex } from '../../lib/questionsIndex'

  interface Props {
    index: QuestionsIndex
    stepLabelById?: Map<string, { number: number; title: string }>
    onSelect: (item: QuestionItem) => void
    onClose: () => void
  }

  let { index, stepLabelById, onSelect, onClose }: Props = $props()

  // Answered-and-read questions collapse by default so the panel stays a list of
  // things still to do, not a growing archive.
  let showDone = $state(false)

  const GROUP_META: Record<QuestionGroupKey, { label: string; dot: string }> = {
    needs_sending: { label: 'Needs sending', dot: 'bg-warning' },
    answers_to_read: { label: 'Answers to read', dot: 'bg-info' },
    suggestions_to_review: { label: 'Suggestions to review', dot: 'bg-success' },
    waiting: { label: 'Waiting on AI', dot: 'bg-base-content/40' },
    done: { label: 'Done', dot: 'bg-base-content/20' },
  }

  function locationLabel(item: QuestionItem): string {
    const target = item.target
    if (target.kind === 'step') {
      const label = stepLabelById?.get(target.stepId)
      return label ? `Step ${label.number} · ${label.title}` : 'Walkthrough step'
    }
    return target.line != null ? `${target.filename}:${target.line}` : target.filename
  }
</script>

<div class="absolute inset-0 z-40 flex justify-end">
  <button
    type="button"
    class="absolute inset-0 bg-black/20"
    aria-label="Close questions panel"
    onclick={onClose}
  ></button>
  <aside class="relative flex flex-col h-full w-96 max-w-full bg-base-100 border-l border-base-300 shadow-xl">
  <div class="flex items-center gap-2 px-4 py-2.5 border-b border-base-300 bg-base-200 shrink-0">
    <h3 class="text-sm font-semibold text-base-content m-0 flex-1">
      Questions
      {#if index.actionableCount > 0}
        <span class="badge badge-primary badge-sm ml-1">{index.actionableCount} to check</span>
      {/if}
    </h3>
    <button class="btn btn-ghost btn-xs btn-square" onclick={onClose} aria-label="Close questions panel">
      <X class="w-4 h-4" />
    </button>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto">
    {#if index.totalCount === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 text-base-content/50 text-sm text-center p-6">
        <span class="text-3xl" aria-hidden="true">✓</span>
        <span>No open questions — you're all caught up.</span>
      </div>
    {:else}
      {#each index.order as groupKey (groupKey)}
        {@const items = index.groups[groupKey]}
        {#if items.length > 0}
          {@const collapsible = groupKey === 'done'}
          {@const expanded = !collapsible || showDone}
          <section class="border-b border-base-200">
            <button
              type="button"
              class="flex items-center gap-2 w-full px-4 py-2 text-left {collapsible ? 'hover:bg-base-200 cursor-pointer' : 'cursor-default'}"
              disabled={!collapsible}
              onclick={() => { if (collapsible) showDone = !showDone }}
            >
              <span class="w-2 h-2 rounded-full {GROUP_META[groupKey].dot} shrink-0" aria-hidden="true"></span>
              <span class="text-xs font-semibold uppercase tracking-wide text-base-content/70">
                {GROUP_META[groupKey].label}
              </span>
              <span class="badge badge-ghost badge-xs">{items.length}</span>
              {#if collapsible}
                <span class="flex-1"></span>
                <span class="text-xs text-base-content/40">{expanded ? 'Hide' : 'Show'}</span>
              {/if}
            </button>
            {#if expanded}
              <ul class="flex flex-col pb-1">
                {#each items as item (item.key)}
                  <li>
                    <button
                      type="button"
                      class="flex flex-col gap-0.5 w-full px-4 py-2 text-left hover:bg-primary/10 focus:bg-primary/10 focus:outline-none"
                      onclick={() => onSelect(item)}
                    >
                      <span class="text-xs {item.target.kind === 'diff' ? 'font-mono' : ''} text-primary truncate w-full" title={locationLabel(item)}>
                        {locationLabel(item)}
                      </span>
                      <span class="text-sm text-base-content/80 line-clamp-2">{item.preview}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      {/each}
    {/if}
  </div>
  </aside>
</div>
