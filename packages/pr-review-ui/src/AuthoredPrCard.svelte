<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AuthoredPullRequest } from '@openforge-app/plugin-sdk/domain'
  import Card from './ui/Card.svelte'
  import { timeAgoFromSeconds } from './timeAgo'
  import { getPrStatusChips } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import PrStatusChip from './ui/PrStatusChip.svelte'
  import { labelChipStyle } from './labelColors'

  interface Props {
    pr: AuthoredPullRequest
    selected?: boolean
    onClick: () => void
    /** Optional content rendered inside the card, below the labels (e.g. start-task control). */
    footer?: Snippet
  }

  let { pr, selected = false, onClick, footer }: Props = $props()

  const MAX_VISIBLE_LABELS = 4
  let visibleLabels = $derived((pr.labels ?? []).slice(0, MAX_VISIBLE_LABELS))
  let overflowCount = $derived(Math.max(0, (pr.labels ?? []).length - MAX_VISIBLE_LABELS))
</script>

<Card
  class="flex flex-col gap-2.5 p-4 duration-150 {!selected ? 'hover:-translate-y-px' : ''}"
  {selected}
  onclick={onClick}
>
  <div class="flex items-center gap-2">
    <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-primary bg-primary/15 rounded">{pr.repo_owner}/{pr.repo_name}</span>
    {#if pr.draft}
      <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-base-content/50 bg-base-200 border border-base-300 rounded">Draft</span>
    {/if}
    {#if pr.task_id}
      <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-secondary bg-secondary/15 rounded">{pr.task_id}</span>
    {/if}
  </div>

  <div class="flex items-start">
    <h3 class="text-[0.9rem] font-medium text-base-content m-0 leading-snug">{pr.title}</h3>
  </div>

  <div class="flex items-center gap-2 text-xs text-base-content/50">
    <span class="font-semibold text-base-content">#{pr.number}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium">{pr.head_ref}</span>
    <span class="text-base-300">•</span>
    <span>{timeAgoFromSeconds(pr.created_at)}</span>
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#each getPrStatusChips(pr, 'compact') as chip}
      {#if chip.type !== 'draft'}
        <PrStatusChip {chip} />
      {/if}
    {/each}

    <span class="flex-1"></span>
    <span class="font-medium text-base-content/50">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium text-success">+{pr.additions}</span>
    <span class="font-medium text-error">−{pr.deletions}</span>
  </div>

  {#if visibleLabels.length > 0}
    <div class="flex flex-wrap items-center gap-1">
      {#each visibleLabels as label}
        {@const style = labelChipStyle(label.color)}
        <span
          class="badge badge-sm {style ? '' : 'badge-outline'}"
          style={style}
          title={label.name}
        >{label.name}</span>
      {/each}
      {#if overflowCount > 0}
        <span class="badge badge-sm badge-ghost">+{overflowCount}</span>
      {/if}
    </div>
  {/if}

  {#if footer}
    <div class="mt-0.5">
      {@render footer()}
    </div>
  {/if}
</Card>
