<script lang="ts">
  import type { PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
  import { canEnqueuePullRequest, canMergePullRequest, getMergeReadiness, isClosedOrMergedPullRequest, isClosedUnmergedPullRequest, isMergedPullRequest, parseCheckRuns, splitCheckRuns } from '@openforge-app/plugin-sdk/domain'
  import { getPrStatusChips, getPullRequestMergeActionLabel } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
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
  let detail = $derived(readinessText(pr))
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

  function readinessText(value: PullRequestInfo): string | null {
    if (isMergedPullRequest(value)) return null
    const readiness = getMergeReadiness(value)
    if (readiness.status === 'ready_to_enqueue') return 'Ready to enqueue in the merge queue.'
    if (readiness.status === 'queued_pull_request') return 'Queued pull request — waiting for merge queue validation.'
    if (readiness.status === 'readiness_unknown') return readiness.warnings[0]?.message ?? 'Readiness unknown — waiting for GitHub to report definitive mergeability.'
    if (readiness.status === 'blocked') return readiness.blockers[0]?.message ?? null
    return null
  }
</script>

<article class="rounded-lg border border-l-2 {isClosedOrMergedPullRequest(pr.state) ? 'bg-base-200/50 border-base-300/60' : 'bg-base-100 border-base-300/70'} overflow-hidden" aria-label={cardLabel(pr)}>
  <!-- A linked pull request carries checks, merge state and review comments, so several
       of them stack up taller than the task panel. Collapsing leaves the identity row:
       number, title, state. The caret column matches CollapsibleSection's so a card
       toggle lines up with the section toggle above it. -->
  <div class="flex items-center gap-2 pr-2.5">
    <h4 class="m-0 min-w-0 flex-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2.5 pt-2.5 text-left hover:bg-base-200/40 focus-visible:ring-2 focus-visible:ring-primary {collapsed ? 'pb-2.5' : 'pb-1'}"
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
    <span class="badge badge-xs shrink-0 capitalize {pr.state === 'open' ? 'badge-success badge-outline' : 'badge-ghost'}">{displayState(pr)}</span>
  </div>

  {#if !collapsed}
    <div id={bodyId}>
      <div class="flex flex-col gap-1 px-2.5 pb-2.5">
        <span class="text-[0.7rem] text-base-content/55">{pr.repo_owner}/{pr.repo_name}</span>
        <button class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start w-fit" onclick={() => onOpenUrl(pr.url)}>{pr.url}</button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5" aria-label="Pull request signals">
        {#each chips as chip (`${pr.id}-${chip.type}-${chip.label}`)}<PrStatusChip {chip} />{/each}
        {#if pr.unaddressed_comment_count > 0}<span class="badge badge-ghost badge-sm">{pr.unaddressed_comment_count} {pr.unaddressed_comment_count === 1 ? 'comment' : 'comments'}</span>{/if}
      </div>

      {#if checkSummary.visible.length > 0 || checkSummary.passingCount > 0}
        <div class="border-t border-base-300/70 px-2.5 py-2 flex flex-col gap-1" aria-label="Pipeline checks">
          <div class="text-[0.7rem] font-medium text-base-content/55">Pipeline checks</div>
          {#each checkSummary.visible as check (check.id)}
            <div class="flex items-center gap-2 text-xs"><span class="font-semibold {check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">{check.conclusion === 'failure' ? 'Failed' : check.status !== 'completed' ? 'Running' : 'Skipped'}</span><span class="text-base-content/70">{check.name}</span></div>
          {/each}
          {#if checkSummary.passingCount > 0}<div class="flex items-center gap-2 text-xs"><span class="font-semibold text-success">Passed</span><span class="text-base-content/50">{checkSummary.passingCount} passing</span></div>{/if}
        </div>
      {/if}

      {#if detail || canMerge || canEnqueuePullRequest(pr) || feedback}
        <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Pull request merge status">
          {#if detail}<div class="text-[0.7rem] text-base-content/60">{detail}</div>{/if}
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
            <article class="rounded-md border border-base-300/70 bg-base-100 p-2.5" aria-label={`Comment by ${comment.author}`}>
              <div class="flex justify-between gap-2">
                <span class="text-[0.65rem] font-semibold text-base-content/60">{comment.author}{comment.file_path ? ` · ${comment.file_path}${comment.line_number ? `:${comment.line_number}` : ''}` : ''}</span>
                <button class="btn btn-ghost btn-xs text-success" onclick={() => void onMarkAddressed(comment.id)}>✓ Mark addressed</button>
              </div>
              <div class="text-xs text-base-content/75"><MarkdownContent content={comment.body} imageBaseUrl={getGitHubMarkdownImageBaseUrl(pr)} {resolveRemoteMedia} {onOpenUrl} /></div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</article>
