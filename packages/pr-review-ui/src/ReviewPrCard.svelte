<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import { hasDoNotReviewLabel } from '@openforge-app/plugin-sdk/domain'
  import { GitPullRequest, Mail, Tags, X } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Card from './ui/Card.svelte'
  import { timeAgoFromSeconds } from './timeAgo'
  import { getPrStatusBadgeStatus, getPrStatusChips } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import StatusBadge from '@openforge-app/plugin-sdk/ui/StatusBadge.svelte'
  import { labelMarkerStyle } from './labelColors'

  interface Props {
    pr: ReviewPullRequest
    selected?: boolean
    onClick: () => void
    onMarkUnread?: () => void
    /** Remove this PR from the review list. Optional; the button only renders when wired. */
    onRemove?: () => void
    /** Optional content rendered inside the card, below the labels (e.g. walkthrough controls). */
    footer?: Snippet
  }

  let { pr, selected = false, onClick, onMarkUnread, onRemove, footer }: Props = $props()

  const MAX_VISIBLE_LABELS = 4
  let visibleLabels = $derived((pr.labels ?? []).slice(0, MAX_VISIBLE_LABELS))
  let overflowCount = $derived(Math.max(0, (pr.labels ?? []).length - MAX_VISIBLE_LABELS))
  // Gray out PRs marked "DO NOT REVIEW"; the label itself is shown in the label row below.
  let doNotReview = $derived(hasDoNotReviewLabel(pr))
  let statusChips = $derived(getPrStatusChips(pr, 'compact'))
  let terminalChip = $derived(
    statusChips.find(candidate => candidate.variant === 'merged' || candidate.variant === 'closed') ?? null,
  )
  let isUnread = $derived(!pr.viewed_at && !terminalChip)
  let showMarkUnread = $derived(Boolean(!terminalChip && pr.viewed_at && onMarkUnread))
  let titleWeight = $derived(isUnread ? 'font-semibold' : 'font-medium')
  let headerActionPadding = $derived(
    onRemove && showMarkUnread ? 'pr-16' : onRemove || showMarkUnread ? 'pr-7' : '',
  )
</script>

<div class="relative group">
{#if onRemove}
  <IconButton
    label="Remove from list"
    size="xs"
    class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    type="button"
    title="Remove from list"
    onclick={(e) => { e.stopPropagation(); onRemove?.() }}
  >
    <X size={14} strokeWidth={1.5} aria-hidden="true" />
  </IconButton>
{/if}
{#if showMarkUnread}
  <IconButton
    label="Mark as unread"
    size="xs"
    class="absolute top-2 {onRemove ? 'right-9' : 'right-2'} z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    type="button"
    title="Mark as unread"
    onclick={(e) => { e.stopPropagation(); onMarkUnread?.() }}
  >
    <Mail size={14} strokeWidth={1.5} aria-hidden="true" />
  </IconButton>
{/if}
<Card
  class="flex flex-col gap-3 p-4 duration-150 {!selected ? 'hover:-translate-y-px' : ''}"
  {selected}
  onclick={onClick}
>
  <div class="flex flex-wrap items-center justify-between gap-2 {headerActionPadding}">
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex items-center gap-1.5 text-xs font-medium text-of-text/70">
        <GitPullRequest class="size-3.5 text-of-text/50" aria-hidden="true" />
        {pr.repo_owner}/{pr.repo_name}
      </span>
      {#if pr.draft}
        <Badge>Draft</Badge>
      {/if}
    </div>
    {#if terminalChip}
      <StatusBadge status={getPrStatusBadgeStatus(terminalChip) ?? 'expired'}>{terminalChip.label}</StatusBadge>
    {/if}
  </div>

  <div class="flex flex-col gap-2.5 transition-opacity {doNotReview ? 'opacity-60' : ''}">
    <div class="flex items-start gap-2">
      {#if isUnread}
        <span
          class="mt-[0.4rem] size-2 shrink-0 rounded-[var(--of-radius-round)] bg-of-info ring-2 ring-of-info/15"
          role="img"
          aria-label="Unread review request"
          title="Unread"
        ></span>
      {/if}
      <h3 class="text-[0.9rem] {titleWeight} text-of-text m-0 leading-snug">{pr.title}</h3>
    </div>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-of-text/60">
      <span class="font-semibold text-of-text">#{pr.number}</span>
      <span class="text-of-border" aria-hidden="true">•</span>
      <span class="font-medium">{pr.user_login}</span>
      <span class="text-of-border" aria-hidden="true">•</span>
      <span>{timeAgoFromSeconds(pr.created_at)}</span>
    </div>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      {#each statusChips as chip}
        {@const status = getPrStatusBadgeStatus(chip)}
        {#if chip.type !== 'draft' && chip.variant !== 'merged' && chip.variant !== 'closed' && status}
          <StatusBadge {status}>{chip.label}</StatusBadge>
        {/if}
      {/each}
      <span class="font-medium text-of-text/60">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
      <span class="text-of-border" aria-hidden="true">•</span>
      <span class="font-semibold text-of-success">+{pr.additions}</span>
      <span class="font-semibold text-of-danger">−{pr.deletions}</span>
    </div>

    {#if visibleLabels.length > 0}
      <div class="flex min-w-0 items-start gap-2 text-xs text-of-text/75">
        <Tags class="mt-0.5 size-3.5 shrink-0 text-of-text/50" aria-hidden="true" />
        <ul class="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-3 gap-y-1 p-0" aria-label="Pull request labels">
          {#each visibleLabels as label}
            <li class="flex min-w-0 items-center gap-1.5">
              <span
                class="size-2 shrink-0 rounded-[var(--of-radius-round)] ring-1 ring-of-text/15"
                style={labelMarkerStyle(label.color)}
                aria-hidden="true"
              ></span>
              <span class="truncate font-medium" title={label.name}>{label.name}</span>
            </li>
          {/each}
        </ul>
        {#if overflowCount > 0}
          <span class="shrink-0 font-medium text-of-text/60" aria-label={`${overflowCount} more labels`}>+{overflowCount}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if footer}
    <div class="mt-0.5">
      {@render footer()}
    </div>
  {/if}
</Card>
</div>
