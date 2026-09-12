<script lang="ts">
  import type { PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
  import { canEnqueuePullRequest, canMergePullRequest, isClosedOrMergedPullRequest, isClosedUnmergedPullRequest, isMergedPullRequest, parseCheckRuns, splitCheckRuns } from '@openforge-app/plugin-sdk/domain'
  import { getPrStatusChips, getPullRequestMergeActionLabel, type PrStatusChipSpec } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import StatusBadge, { type StatusBadgeStatus } from '@openforge-app/plugin-sdk/ui/StatusBadge.svelte'
  import { collapsedSections, isSectionCollapsed, toggleSection } from '@openforge-app/plugin-sdk/collapsibleSectionState'
  import PrStatusChip from '@openforge-app/pr-review-ui/PrStatusChip.svelte'
  import { getGitHubMarkdownImageBaseUrl } from '@openforge-app/pr-review-ui/githubMarkdown'
  import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
  import type { MergeFeedback } from './useMergeOrchestration.svelte'

  interface Props {
    pr: PullRequestInfo
    // Stable, global key for this card's collapsed state. Built by the section with
    // `pluginSectionKey` so it cannot collide with another plugin's sections.
    sectionKey: string
    comments: PrComment[]
    feedback?: MergeFeedback
    pendingPrId: number | null
    taskActionPending: boolean
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onOpenUrl: (url: string) => void
    onMarkAddressed: (commentId: number) => void | Promise<void>
    onRequestAction: (pr: PullRequestInfo, action: 'merge' | 'enqueue') => void
  }

  let {
    pr,
    sectionKey,
    comments,
    feedback,
    pendingPrId,
    taskActionPending,
    resolveRemoteMedia,
    onOpenUrl,
    onMarkAddressed,
    onRequestAction,
  }: Props = $props()

  let collapsed = $derived(isSectionCollapsed($collapsedSections, sectionKey))
  let bodyId = $derived(`pull-request-body-${sectionKey}`)
  let chips = $derived(getPrStatusChips(pr, 'detail'))
  let mergeActionLabel = $derived(pr.default_merge_method ? getPullRequestMergeActionLabel(pr.default_merge_method) : 'Merge')
  let canMerge = $derived(canMergePullRequest(pr) && pr.default_merge_method !== null && pr.default_merge_method !== undefined)
  let unaddressedComments = $derived(comments.filter((comment) => comment.addressed === 0))
  let checkSummary = $derived(splitCheckRuns(parseCheckRuns(pr.ci_check_runs)))

  function prNumber(value: PullRequestInfo): number {
    return value.pr_number ?? value.id
  }

  function displayState(value: PullRequestInfo): string {
    if (isMergedPullRequest(value)) return 'merged'
    if (isClosedUnmergedPullRequest(value)) return 'closed'
    if (value.is_queued) return 'queued'
    if (value.draft) return 'draft'
    return value.state
  }

  function cardLabel(value: PullRequestInfo): string {
    if (isMergedPullRequest(value)) return `Merged pull request #${prNumber(value)} (done)`
    if (isClosedUnmergedPullRequest(value)) return `Closed pull request #${prNumber(value)} (not merged)`
    return `Pull request #${prNumber(value)}`
  }

  function checkStatus(check: { status: string; conclusion: string | null }): StatusBadgeStatus {
    if (check.conclusion === 'failure') return 'failed'
    if (check.status !== 'completed') return 'in-progress'
    if (check.conclusion === 'success') return 'success'
    return 'expired'
  }

  function checkStatusLabel(check: { status: string; conclusion: string | null }): string {
    if (check.conclusion === 'failure') return 'Failed'
    if (check.status !== 'completed') return 'Running'
    if (check.conclusion === 'success') return 'Passed'
    return 'Skipped'
  }

  function chipStatus(chip: PrStatusChipSpec): StatusBadgeStatus | null {
    if (chip.type === 'ci') {
      if (chip.variant === 'success') return 'success'
      if (chip.variant === 'error') return 'failed'
      if (chip.variant === 'pending') return 'in-progress'
      return 'expired'
    }
    if (chip.type === 'review') {
      if (chip.variant === 'success') return 'success'
      if (chip.variant === 'pending') return 'pending'
      if (chip.variant === 'neutral') return 'in-review'
    }
    if (chip.type === 'merge') {
      if (chip.variant === 'done' || chip.variant === 'merged') return 'success'
      if (chip.variant === 'error') return 'failed'
      if (chip.variant === 'neutral') return 'in-review'
      if (chip.variant === 'closed') return 'expired'
    }
    return null
  }
</script>

<article class="rounded-[var(--of-radius-container)] border border-l-2 {isClosedOrMergedPullRequest(pr.state) ? 'bg-base-200/50 border-base-300/60' : 'bg-base-100 border-base-300/70'} overflow-hidden" aria-label={cardLabel(pr)}>
  <!-- A linked pull request carries checks, merge state and review comments, so several
       of them stack up taller than the task panel. Collapsing leaves the identity row:
       number, title, state. The caret column matches CollapsibleSection's so a card
       toggle lines up with the section toggle above it. -->
  <div class="flex items-center gap-3 px-3.5">
    <h4 class="m-0 min-w-0 flex-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-[var(--of-radius-container)] px-1.5 pt-2.5 text-left hover:bg-base-200/40 focus-visible:ring-2 focus-visible:ring-primary {collapsed ? 'pb-2.5' : 'pb-1'}"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={`#${prNumber(pr)} ${pr.title}`}
        onclick={() => toggleSection(sectionKey)}
      >
        <span
          class="w-3 shrink-0 text-center text-[0.7rem] leading-none text-base-content/40 transition-transform duration-150 {collapsed ? '-rotate-90' : ''}"
          aria-hidden="true"
        >▾</span>
        <span class="font-mono text-sm font-bold">#{prNumber(pr)}</span>
        <span class="text-sm font-medium truncate" title={pr.title}>{pr.title}</span>
      </button>
    </h4>
    <StatusBadge
      status={pr.state === 'open' ? 'success' : 'expired'}
      aria-label={displayState(pr)}
      title={displayState(pr)}
      class="shrink-0 capitalize github-sync-compact-chip github-sync-state-chip"
    >{displayState(pr)}</StatusBadge>
  </div>

  {#if !collapsed}
    <div id={bodyId}>
      <div class="flex flex-col gap-1 px-2.5 pb-2.5">
        <Button
          variant="ghost"
          size="xs"
          class="w-fit justify-start break-all text-left text-[0.7rem] text-primary hover:underline"
          onclick={() => onOpenUrl(pr.url)}
        >{pr.url}</Button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 px-2.5 pb-5" aria-label="Pull request signals">
        {#each chips as chip (`${pr.id}-${chip.type}-${chip.label}`)}
          {@const status = chipStatus(chip)}
          {#if status}
            <StatusBadge status={status} aria-label={chip.label} title={chip.label} class="github-sync-compact-chip github-sync-signal-status">{chip.label}</StatusBadge>
          {:else}
            <PrStatusChip {chip} />
          {/if}
        {/each}
        {#if pr.unaddressed_comment_count > 0}
          <Badge class="github-sync-compact-chip github-sync-signal-count">{pr.unaddressed_comment_count} {pr.unaddressed_comment_count === 1 ? 'comment' : 'comments'}</Badge>
        {/if}
      </div>

      {#if checkSummary.visible.length > 0 || checkSummary.passingCount > 0}
        <div class="border-t border-base-300/70 px-2.5 py-2 flex flex-col gap-1" aria-label="Pipeline checks">
          <div class="text-[0.7rem] font-medium text-base-content/55">Pipeline checks</div>
          {#each checkSummary.visible as check (check.id)}
            <div class="flex items-center gap-2 text-xs">
              <StatusBadge
                status={checkStatus(check)}
                role="img"
                aria-label={checkStatusLabel(check)}
                title={checkStatusLabel(check)}
                class="github-sync-status-icon shrink-0"
              >
                <span class="sr-only">{checkStatusLabel(check)}</span>
              </StatusBadge>
              <span class="text-base-content/70">{check.name}</span>
            </div>
          {/each}
          {#if checkSummary.passingCount > 0}
            <div class="flex items-center gap-2 text-xs">
              <StatusBadge status="success" role="img" aria-label="Passed" title="Passed" class="github-sync-status-icon shrink-0">
                <span class="sr-only">Passed</span>
              </StatusBadge>
              <span class="text-base-content/50">{checkSummary.passingCount} passing</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if canMerge || canEnqueuePullRequest(pr) || feedback}
        <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Pull request merge status">
          <div class="flex items-center gap-2">
            {#if canEnqueuePullRequest(pr)}
              <Button size="xs" aria-label={pendingPrId === pr.id || taskActionPending ? 'Enqueueing…' : 'Enqueue'} disabled={pendingPrId !== null || taskActionPending} onclick={() => onRequestAction(pr, 'enqueue')}>
                {#if pendingPrId === pr.id || taskActionPending}
                  <span class="loading loading-spinner loading-xs" role="status" aria-label="Enqueueing pull request"></span>
                  Enqueueing…
                {:else}
                  Enqueue
                {/if}
              </Button>
            {:else if canMerge}
              <Button size="xs" aria-label={pendingPrId === pr.id || taskActionPending ? 'Merging…' : mergeActionLabel} disabled={pendingPrId !== null || taskActionPending} onclick={() => onRequestAction(pr, 'merge')}>
                {#if pendingPrId === pr.id || taskActionPending}
                  <span class="loading loading-spinner loading-xs" role="status" aria-label="Merging pull request"></span>
                  Merging…
                {:else}
                  {mergeActionLabel}
                {/if}
              </Button>
            {/if}
            {#if feedback}<span class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">{feedback.message}</span>{/if}
          </div>
        </div>
      {/if}

      {#if unaddressedComments.length > 0}
        <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Unaddressed comments">
          <div class="text-[0.7rem] font-medium text-base-content/55">Unaddressed comments</div>
          {#each unaddressedComments as comment (comment.id)}
            <article class="rounded-[var(--of-radius-container)] border border-base-300/70 bg-base-100 p-2.5" aria-label={`Comment by ${comment.author}`}>
              <div class="flex items-start justify-between gap-2">
                <span class="min-w-0 break-all text-[0.65rem] font-semibold text-base-content/60" title={comment.file_path ?? undefined}>{comment.author}{comment.file_path ? ` · ${comment.file_path}${comment.line_number ? `:${comment.line_number}` : ''}` : ''}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  class="shrink-0 whitespace-nowrap text-success"
                  onclick={() => void onMarkAddressed(comment.id)}
                >✓ Mark addressed</Button>
              </div>
              <div class="text-xs text-base-content/75"><MarkdownContent content={comment.body} imageBaseUrl={getGitHubMarkdownImageBaseUrl(pr)} {resolveRemoteMedia} {onOpenUrl} /></div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</article>

<style>
  :global([data-status-badge].github-sync-status-icon) {
    gap: 0;
    padding: 0;
    background: transparent;
    box-shadow: none;
  }

  :global(span.github-sync-compact-chip) {
    min-height: auto;
    padding: 0.125rem 0.375rem;
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1;
  }

  :global(span[data-status-badge].github-sync-signal-status) {
    gap: 0.25rem;
  }

  :global(span[data-status-badge].github-sync-state-chip) {
    gap: 0;
  }

  :global(span[data-status-badge].github-sync-state-chip [data-status-icon]) {
    display: none;
  }

  :global(span[data-status-badge].github-sync-signal-status [data-status-icon]) {
    width: var(--of-space3);
    height: var(--of-space3);
  }

  :global(span.github-sync-signal-count) {
    min-height: auto;
    padding: 0.125rem 0.375rem;
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1;
  }
</style>
