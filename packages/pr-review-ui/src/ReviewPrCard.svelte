<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import { hasDoNotReviewLabel } from '@openforge-app/plugin-sdk/domain'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Card from './ui/Card.svelte'
  import { timeAgoFromSeconds } from './timeAgo'
  import { getPrStatusChips } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import PrStatusChip from './ui/PrStatusChip.svelte'
  import { labelChipStyle } from './labelColors'

  interface Props {
    pr: ReviewPullRequest
    selected?: boolean
    onClick: () => void
    onMarkUnread?: () => void
    /** Optional content rendered inside the card, below the labels (e.g. walkthrough controls). */
    footer?: Snippet
  }

  let { pr, selected = false, onClick, onMarkUnread, footer }: Props = $props()

  const MAX_VISIBLE_LABELS = 4
  let visibleLabels = $derived((pr.labels ?? []).slice(0, MAX_VISIBLE_LABELS))
  let overflowCount = $derived(Math.max(0, (pr.labels ?? []).length - MAX_VISIBLE_LABELS))
  // Gray out PRs marked "DO NOT REVIEW"; the label itself is shown in the label row below.
  let doNotReview = $derived(hasDoNotReviewLabel(pr))
</script>

<div class="relative group">
{#if pr.viewed_at && onMarkUnread}
  <IconButton
    label="Mark as unread"
    size="xs"
    class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    type="button"
    title="Mark as unread"
    onclick={(e) => { e.stopPropagation(); onMarkUnread?.() }}
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  </IconButton>
{/if}
<Card
  class="flex flex-col gap-2.5 p-4 duration-150 {!selected ? 'hover:-translate-y-px' : ''} {pr.viewed_at || doNotReview ? 'opacity-50' : ''}"
  {selected}
  onclick={onClick}
>
  <div class="flex items-center gap-2">
    <Badge variant="info">{pr.repo_owner}/{pr.repo_name}</Badge>
    {#if pr.draft}
      <Badge>Draft</Badge>
    {/if}
  </div>

  <div class="flex items-start">
    <h3 class="text-[0.9rem] font-medium text-base-content m-0 leading-snug">{pr.title}</h3>
  </div>

  <div class="flex items-center gap-2 text-xs text-base-content/50">
    <span class="font-semibold text-base-content">#{pr.number}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium">{pr.user_login}</span>
    <span class="text-base-300">•</span>
    <span>{timeAgoFromSeconds(pr.created_at)}</span>
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#each getPrStatusChips(pr, 'compact') as chip}
      {#if chip.type !== 'draft'}
        <PrStatusChip {chip} />
        <span class="text-base-300">•</span>
      {/if}
    {/each}
    <span class="font-medium text-base-content/50">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium text-success">+{pr.additions}</span>
    <span class="font-medium text-error">−{pr.deletions}</span>
  </div>

  {#if visibleLabels.length > 0}
    <div class="flex flex-wrap items-center gap-1">
      {#each visibleLabels as label}
        {@const style = labelChipStyle(label.color)}
        <Badge style={style} title={label.name}>{label.name}</Badge>
      {/each}
      {#if overflowCount > 0}
        <Badge>+{overflowCount}</Badge>
      {/if}
    </div>
  {/if}

  {#if footer}
    <div class="mt-0.5">
      {@render footer()}
    </div>
  {/if}
</Card>
</div>
