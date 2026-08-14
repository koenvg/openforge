<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk/frontend'
  import type { PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
  import { canEnqueuePullRequest, canMergePullRequest, getMergeReadiness, isClosedOrMergedPullRequest, isClosedUnmergedPullRequest, isMergedPullRequest, parseCheckRuns, splitCheckRuns } from '@openforge-app/plugin-sdk/domain'
  import { getPrStatusChips } from '@openforge-app/plugin-sdk/prStatusPresentation'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import PrStatusChip from '@openforge-app/pr-review-ui/PrStatusChip.svelte'
  import { getGitHubMarkdownImageBaseUrl } from '@openforge-app/pr-review-ui/githubMarkdown'
  import { createGithubTaskClient } from './githubTaskClient'
  import { getTaskPullRequestCache } from './taskPullRequestCache.svelte'
  import { useMergeOrchestration } from './useMergeOrchestration.svelte'

  interface Props extends PluginTaskUISectionProps {
    taskActionPending?: boolean
  }
  let { api, taskId, taskActionPending = false }: Props = $props()

  const client = createGithubTaskClient(untrack(() => api))
  const cache = getTaskPullRequestCache(untrack(() => api), client)
  let cachedTask = $derived(cache.forTask(taskId))
  let pullRequests = $derived(cachedTask.pullRequests)
  let commentsByPrId = $derived(cachedTask.commentsByPrId)
  let loading = $derived(cachedTask.loading)
  let loadError = $derived(cachedTask.loaded ? null : cachedTask.error)
  let cachedRefreshError = $derived(cachedTask.loaded ? cachedTask.error : null)
  let showLoading = $state(false)
  let refreshError = $state<string | null>(null)
  let visibleRefreshError = $derived(refreshError ?? cachedRefreshError)
  let refreshing = $state(false)
  let adding = $state(false)
  let prUrl = $state('')
  let linkError = $state<string | null>(null)
  let linking = $state(false)
  let confirmingEnqueue = $state<PullRequestInfo | null>(null)
  let requestedTaskId: string | null = null
  let loadingIndicatorTimer: ReturnType<typeof setTimeout> | null = null

  const LOADING_INDICATOR_DELAY_MS = 300

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function clearLoadingIndicatorTimer() {
    if (loadingIndicatorTimer === null) return
    clearTimeout(loadingIndicatorTimer)
    loadingIndicatorTimer = null
  }


  async function refreshAfterAction() {
    const currentTaskId = taskId
    await client.refreshTask(currentTaskId)
    await cache.invalidateAndRefresh(currentTaskId)
  }

  const orchestration = useMergeOrchestration(client, refreshAfterAction)

  const invalidationSubscriptions = [
    'github-sync-complete',
    'new-pr-comment',
    'comment-addressed',
    'ci-status-changed',
    'review-status-changed',
  ].map((eventName) => api.events.onGlobal(eventName, () => {
    const visibleTaskId = taskId
    void cache.invalidateAndRefresh(visibleTaskId).catch(() => undefined)
  }))

  $effect(() => {
    const currentTaskId = taskId
    if (currentTaskId === requestedTaskId) return

    requestedTaskId = currentTaskId
    refreshError = null
    showLoading = false
    clearLoadingIndicatorTimer()

    const request = cache.load(currentTaskId)
    if (!cache.forTask(currentTaskId).loaded) {
      loadingIndicatorTimer = setTimeout(() => {
        const current = cache.forTask(currentTaskId)
        if (requestedTaskId === currentTaskId && current.loading && !current.loaded) showLoading = true
      }, LOADING_INDICATOR_DELAY_MS)
    }

    void request.catch(() => undefined).finally(() => {
      if (requestedTaskId !== currentTaskId) return
      showLoading = false
      clearLoadingIndicatorTimer()
    })
  })

  onDestroy(() => {
    clearLoadingIndicatorTimer()
    for (const subscription of invalidationSubscriptions) subscription.dispose()
  })

  async function refreshGithubStatus() {
    if (refreshing) return
    refreshing = true
    refreshError = null
    try {
      await client.refreshTask(taskId)
      await cache.invalidateAndRefresh(taskId)
    } catch (error) {
      refreshError = errorMessage(error)
    } finally {
      refreshing = false
    }
  }

  async function submitPullRequestLink() {
    const trimmedUrl = prUrl.trim()
    if (!trimmedUrl) {
      linkError = 'Enter a GitHub pull request URL'
      return
    }
    linking = true
    linkError = null
    try {
      await client.linkPullRequest(taskId, trimmedUrl)
      await cache.invalidateAndRefresh(taskId)
      prUrl = ''
      adding = false
    } catch (error) {
      linkError = errorMessage(error)
    } finally {
      linking = false
    }
  }

  async function markAddressed(commentId: number) {
    await client.markCommentAddressed(commentId)
    await cache.invalidateAndRefresh(taskId)
  }

  function prNumber(pr: PullRequestInfo): number { return pr.pr_number ?? pr.id }
  function displayState(pr: PullRequestInfo): string {
    if (isMergedPullRequest(pr)) return 'merged'
    if (isClosedUnmergedPullRequest(pr)) return 'closed'
    if (pr.is_queued) return 'queued'
    if (pr.draft) return 'draft'
    return pr.state
  }
  function cardLabel(pr: PullRequestInfo): string {
    if (isMergedPullRequest(pr)) return `Merged pull request #${prNumber(pr)} (done)`
    if (isClosedUnmergedPullRequest(pr)) return `Closed pull request #${prNumber(pr)} (not merged)`
    return `Pull request #${prNumber(pr)}`
  }
  function readinessText(pr: PullRequestInfo): string | null {
    const readiness = getMergeReadiness(pr)
    if (readiness.status === 'ready_to_enqueue') return 'Ready to enqueue in the merge queue.'
    if (readiness.status === 'queued_pull_request') return 'Queued pull request — waiting for merge queue validation.'
    if (readiness.status === 'readiness_unknown') return readiness.warnings[0]?.message ?? 'Readiness unknown — waiting for GitHub to report definitive mergeability.'
    if (readiness.status === 'blocked') return readiness.blockers[0]?.message ?? null
    return null
  }
  function imageBaseUrl(pr: PullRequestInfo): string | null { return getGitHubMarkdownImageBaseUrl(pr) }
  function openExternal(url: string) { void api.system.openUrl(url) }
  function requestAction(pr: PullRequestInfo, action: 'merge' | 'enqueue') {
    if (orchestration.pendingPrId !== null) return
    if (action === 'merge') {
      void orchestration.merge(pr)
      return
    }
    confirmingEnqueue = pr
  }
  async function confirmEnqueue() {
    const pr = confirmingEnqueue
    if (!pr) return
    confirmingEnqueue = null
    await orchestration.enqueue(pr)
  }
</script>

<section data-task-info-card="pull-requests" data-card-sizing="natural" class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0" aria-label="Pull Requests">
  <div class="flex items-center border-b border-base-300/70">
    <h3 class="m-0 min-w-0 flex-1 px-3 py-2 text-sm font-semibold">Pull Requests</h3>
    <div class="flex items-center gap-2 pr-2">
      {#if pullRequests.length > 0}
        <button type="button" class="btn btn-ghost btn-xs" disabled={refreshing} onclick={() => void refreshGithubStatus()}>{refreshing ? 'Refreshing…' : 'Refresh GitHub status'}</button>
        <span class="badge badge-ghost badge-sm font-mono">{pullRequests.length} {pullRequests.length === 1 ? 'PR' : 'PRs'}</span>
      {/if}
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => { adding = !adding; linkError = null }}>Add PR</button>
    </div>
  </div>

  <div
    class="flex flex-col gap-2.5 px-3 py-2"
    class:min-h-8={loading && !adding && pullRequests.length === 0}
    aria-busy={loading}
  >
    {#if loadError}<p class="m-0 text-xs text-error" role="alert">Could not load pull requests: {loadError}</p>{/if}
    {#if visibleRefreshError}<p class="m-0 text-xs text-error" role="alert">Could not refresh GitHub status: {visibleRefreshError}</p>{/if}
    {#if showLoading}<p class="m-0 text-xs text-base-content/55">Loading pull requests…</p>{/if}

    {#if adding}
      <form class="flex flex-col gap-2 rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2" novalidate onsubmit={(event) => { event.preventDefault(); void submitPullRequestLink() }}>
        <label class="form-control w-full"><span class="label-text text-xs">GitHub pull request URL</span><input class="input input-bordered input-sm w-full" type="url" placeholder="https://github.com/owner/repo/pull/123" bind:value={prUrl} disabled={linking} /></label>
        {#if linkError}<p class="m-0 text-xs text-error" role="alert">{linkError}</p>{/if}
        <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost btn-xs" disabled={linking} onclick={() => { adding = false; prUrl = ''; linkError = null }}>Cancel</button><button type="submit" class="btn btn-primary btn-xs" disabled={linking}>{linking ? 'Linking…' : 'Link PR'}</button></div>
      </form>
    {/if}

    {#if !loading && pullRequests.length === 0 && !adding}<div class="rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2 text-xs text-base-content/55">No linked pull requests yet</div>{/if}

    {#each pullRequests as pr (pr.id)}
      {@const chips = getPrStatusChips(pr, 'detail')}
      {@const feedback = orchestration.feedbackByPr.get(pr.id)}
      {@const detail = readinessText(pr)}
      {@const comments = (commentsByPrId.get(pr.id) ?? []).filter((comment) => comment.addressed === 0)}
      {@const checkSummary = splitCheckRuns(parseCheckRuns(pr.ci_check_runs))}
      <article class="rounded-lg border border-l-2 {isClosedOrMergedPullRequest(pr.state) ? 'bg-base-200/50 border-base-300/60' : 'bg-base-100 border-base-300/70'} overflow-hidden" aria-label={cardLabel(pr)}>
        <div class="flex items-start justify-between gap-2 p-2.5">
          <div class="min-w-0 flex-1 flex flex-col gap-1">
            <div class="flex items-center gap-2"><span class="font-mono text-sm font-bold">#{prNumber(pr)}</span><span class="text-sm font-medium truncate" title={pr.title}>{pr.title}</span></div>
            <span class="text-[0.7rem] text-base-content/55">{pr.repo_owner}/{pr.repo_name}</span>
            <button class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start w-fit" onclick={() => openExternal(pr.url)}>{pr.url}</button>
          </div>
          <span class="badge badge-xs capitalize {pr.state === 'open' ? 'badge-success badge-outline' : 'badge-ghost'}">{displayState(pr)}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5" aria-label="Pull request signals">{#each chips as chip (`${pr.id}-${chip.type}-${chip.label}`)}<PrStatusChip {chip} />{/each}{#if pr.unaddressed_comment_count > 0}<span class="badge badge-ghost badge-sm">{pr.unaddressed_comment_count} {pr.unaddressed_comment_count === 1 ? 'comment' : 'comments'}</span>{/if}</div>
        {#if checkSummary.visible.length > 0 || checkSummary.passingCount > 0}<div class="border-t border-base-300/70 px-2.5 py-2 flex flex-col gap-1" aria-label="Pipeline checks"><div class="text-[0.7rem] font-medium text-base-content/55">Pipeline checks</div>{#each checkSummary.visible as check (check.id)}<div class="flex items-center gap-2 text-xs"><span class="font-semibold {check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">{check.conclusion === 'failure' ? 'Failed' : check.status !== 'completed' ? 'Running' : 'Skipped'}</span><span class="text-base-content/70">{check.name}</span></div>{/each}{#if checkSummary.passingCount > 0}<div class="flex items-center gap-2 text-xs"><span class="font-semibold text-success">Passed</span><span class="text-base-content/50">{checkSummary.passingCount} passing</span></div>{/if}</div>{/if}
        {#if detail || canMergePullRequest(pr) || canEnqueuePullRequest(pr) || feedback}
          <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Pull request merge status">
            {#if detail}<div class="text-[0.7rem] text-base-content/60">{detail}</div>{/if}
            <div class="flex items-center gap-2">
              {#if canEnqueuePullRequest(pr)}
                <Button size="xs" aria-label={orchestration.pendingPrId === pr.id || taskActionPending ? 'Enqueueing…' : 'Enqueue'} disabled={orchestration.pendingPrId !== null || taskActionPending} onclick={() => requestAction(pr, 'enqueue')}>
                  {#if orchestration.pendingPrId === pr.id || taskActionPending}
                    <span class="loading loading-spinner loading-xs" role="status" aria-label="Enqueueing pull request"></span>
                    Enqueueing…
                  {:else}
                    Enqueue
                  {/if}
                </Button>
              {:else if canMergePullRequest(pr)}
                <Button size="xs" aria-label={orchestration.pendingPrId === pr.id || taskActionPending ? 'Merging…' : 'Merge'} disabled={orchestration.pendingPrId !== null || taskActionPending} onclick={() => requestAction(pr, 'merge')}>
                  {#if orchestration.pendingPrId === pr.id || taskActionPending}
                    <span class="loading loading-spinner loading-xs" role="status" aria-label="Merging pull request"></span>
                    Merging…
                  {:else}
                    Merge
                  {/if}
                </Button>
              {/if}
              {#if feedback}<span class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">{feedback.message}</span>{/if}
            </div>
          </div>
        {/if}
        {#if comments.length > 0}
          <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Unaddressed comments"><div class="text-[0.7rem] font-medium text-base-content/55">Unaddressed comments</div>{#each comments as comment (comment.id)}<article class="rounded-md border border-base-300/70 bg-base-100 p-2.5" aria-label={`Comment by ${comment.author}`}><div class="flex justify-between gap-2"><span class="text-[0.65rem] font-semibold text-base-content/60">{comment.author}{comment.file_path ? ` · ${comment.file_path}${comment.line_number ? `:${comment.line_number}` : ''}` : ''}</span><button class="btn btn-ghost btn-xs text-success" onclick={() => void markAddressed(comment.id)}>✓ Mark addressed</button></div><div class="text-xs text-base-content/75"><MarkdownContent content={comment.body} imageBaseUrl={imageBaseUrl(pr)} onOpenUrl={openExternal} /></div></article>{/each}</div>
        {/if}
      </article>
    {/each}
  </div>
</section>

{#if confirmingEnqueue}
  <Modal onClose={() => { confirmingEnqueue = null }} ariaLabel="Enqueue pull request confirmation" maxWidth="32rem">
    {#snippet header()}<h2 class="text-lg font-semibold">Confirm Enqueue</h2>{/snippet}
    <div class="flex flex-col gap-4 p-5">
      <p>Enqueue {confirmingEnqueue.repo_owner}/{confirmingEnqueue.repo_name} pull request #{prNumber(confirmingEnqueue)} “{confirmingEnqueue.title}”?</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={() => { confirmingEnqueue = null }}>Cancel</button>
        <button class="btn btn-primary btn-sm" onclick={() => void confirmEnqueue()}>Confirm Enqueue</button>
      </div>
    </div>
  </Modal>
{/if}
