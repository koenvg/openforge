<script lang="ts">
  import type { PullRequestInfo } from '../../lib/types'
  import { canMergePullRequest, hasMergeConflicts, isClosedOrMergedPullRequest } from '../../lib/types'
  import { linkPullRequest, openUrl } from '../../lib/ipc'
  import { getPrStatusChips } from '@openforge/plugin-sdk/prStatusPresentation'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import { createPrCommentLoader } from '../../lib/prComments.svelte'
  import { mergingTaskIds } from '../../lib/stores'
  import { useMergeOrchestration } from './useMergeOrchestration.svelte'
  import PrStatusChip from '@openforge/pr-review-ui/PrStatusChip.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import PrPipelineChecks from '../shared/pr/PrPipelineChecks.svelte'

  interface Props {
    taskId: string
    taskPrs: PullRequestInfo[]
    onPullRequestLinked?: () => Promise<void> | void
    allowCommentAddressing?: boolean
  }

  let { taskId, taskPrs, onPullRequestLinked, allowCommentAddressing = false }: Props = $props()
  let isAddingPr = $state(false)
  let prUrl = $state('')
  let linkError = $state<string | null>(null)
  let isLinking = $state(false)

  const commentLoader = createPrCommentLoader({ getPullRequests: () => taskPrs })
  const orchestration = useMergeOrchestration()
  const showMergeSmokeControls = typeof window !== 'undefined' && window.location.protocol.startsWith('http')

  function prNumberLabel(pr: PullRequestInfo): string {
    const match = pr.url.match(/\/pull\/(\d+)/)
    return match ? `#${match[1]}` : `PR ${pr.id}`
  }

  function displayStateLabel(pr: PullRequestInfo): string {
    return isClosedOrMergedPullRequest(pr.state) ? 'merged' : pr.state
  }

  function stateClass(pr: PullRequestInfo): string {
    if (isClosedOrMergedPullRequest(pr.state)) return 'badge-ghost'
    if (pr.state === 'open') return 'badge-success badge-outline'
    return 'badge-ghost'
  }

  function prCardAriaLabel(pr: PullRequestInfo): string {
    const label = prNumberLabel(pr)
    return isClosedOrMergedPullRequest(pr.state) ? `Merged pull request ${label} (done)` : `Pull request ${label}`
  }

  function cardSurfaceClass(pr: PullRequestInfo): string {
    return isClosedOrMergedPullRequest(pr.state) ? 'bg-base-200/50 border-base-300/60' : 'bg-base-100 border-base-300/70'
  }

  function cardAccentClass(pr: PullRequestInfo): string {
    if (isClosedOrMergedPullRequest(pr.state)) return 'border-l-base-300'
    if (pr.ci_status === 'failure' || hasMergeConflicts(pr)) return 'border-l-error'
    if ((pr.unaddressed_comment_count ?? 0) > 0 || pr.review_status === 'changes_requested') return 'border-l-warning'
    if (pr.ci_status === 'success') return 'border-l-success'
    return 'border-l-base-300'
  }

  async function submitPullRequestLink() {
    const trimmedUrl = prUrl.trim()
    if (!trimmedUrl) {
      linkError = 'Enter a GitHub pull request URL'
      return
    }

    isLinking = true
    linkError = null
    try {
      await linkPullRequest(taskId, trimmedUrl)
      await onPullRequestLinked?.()
      prUrl = ''
      isAddingPr = false
    } catch (error) {
      linkError = error instanceof Error ? error.message : String(error)
    } finally {
      isLinking = false
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  function shouldShowMergeDetails(pr: PullRequestInfo): boolean {
    return (isClosedOrMergedPullRequest(pr.state) && pr.merged_at !== null)
      || canMergePullRequest(pr)
      || orchestration.mergeFeedbackByPr.has(pr.id)
  }
</script>

<section data-task-info-card="pull-requests" data-card-sizing="natural" class="flex flex-col gap-2.5 border-b border-base-300/70 pb-3 shrink-0" aria-label="Pull Requests">
  <div class="flex items-center justify-between gap-2">
    <h3 class="m-0 text-sm font-semibold text-base-content">Pull Requests</h3>
    {#if taskPrs.length > 0}
      <span class="badge badge-ghost badge-sm font-mono">{taskPrs.length} {taskPrs.length === 1 ? 'PR' : 'PRs'}</span>
    {/if}
  </div>

  {#if taskPrs.length === 0}
    <div class="flex flex-col gap-2 rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/55">No linked pull requests yet</span>
        <button type="button" class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline" onclick={() => { isAddingPr = !isAddingPr; linkError = null }}>
          Add PR
        </button>
      </div>
      {#if isAddingPr}
        <form class="flex flex-col gap-2" novalidate onsubmit={(event) => { event.preventDefault(); void submitPullRequestLink() }}>
          <label class="form-control w-full">
            <span class="label-text text-xs">GitHub pull request URL</span>
            <input
              class="input input-bordered input-sm w-full"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123"
              bind:value={prUrl}
              disabled={isLinking}
            />
          </label>
          {#if linkError}
            <p class="m-0 text-xs text-error" role="alert">{linkError}</p>
          {/if}
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="btn btn-ghost btn-xs" disabled={isLinking} onclick={() => { isAddingPr = false; prUrl = ''; linkError = null }}>Cancel</button>
            <button type="submit" class="btn btn-primary btn-xs" disabled={isLinking}>{isLinking ? 'Linking…' : 'Link PR'}</button>
          </div>
        </form>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each taskPrs as pr (pr.id)}
        {@const chips = getPrStatusChips(pr, 'detail')}
        {@const unaddressedComments = commentLoader.unaddressedCommentsForPr(pr.id)}
        <article data-testid="task-attention-pr-card" data-card-sizing="natural" class="rounded-lg border border-l-2 {cardSurfaceClass(pr)} {cardAccentClass(pr)} overflow-hidden shrink-0" aria-label={prCardAriaLabel(pr)}>
          <div class="flex items-start justify-between gap-2 p-2.5">
            <div class="min-w-0 flex-1 flex flex-col gap-1">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-sm font-bold text-base-content shrink-0">{prNumberLabel(pr)}</span>
                <span class="text-sm font-medium text-base-content truncate" title={pr.title}>{pr.title}</span>
              </div>
              <button class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start w-fit" onclick={() => openUrl(pr.url)}>
                {pr.url}
              </button>
            </div>
            <span class="badge badge-xs capitalize {stateClass(pr)}">{displayStateLabel(pr)}</span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5" aria-label="Pull request signals">
            {#each chips as chip (`${pr.id}-${chip.type}-${chip.label}`)}
              <PrStatusChip {chip} />
            {/each}
            {#if pr.unaddressed_comment_count > 0}
              <span class="badge badge-ghost badge-sm">{pr.unaddressed_comment_count} {pr.unaddressed_comment_count === 1 ? 'comment' : 'comments'}</span>
            {/if}
          </div>

          <PrPipelineChecks ciCheckRuns={pr.ci_check_runs} variant="detail" />

          {#if shouldShowMergeDetails(pr)}
            {@const feedback = orchestration.mergeFeedbackByPr.get(pr.id)}
            <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Pull request merge status">
              {#if isClosedOrMergedPullRequest(pr.state) && pr.merged_at}
                <div class="text-[0.7rem] text-base-content/60">Merged on {formatDate(pr.merged_at)}</div>
              {/if}

              {#if canMergePullRequest(pr)}
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-success btn-xs"
                    disabled={orchestration.mergingPrId !== null || $mergingTaskIds.has(taskId)}
                    onclick={() => orchestration.handleMerge(taskId, pr)}
                  >
                    {#if orchestration.mergingPrId === pr.id || $mergingTaskIds.has(taskId)}
                      <span class="loading loading-spinner loading-xs"></span>
                      Merging...
                    {:else}
                      Merge
                    {/if}
                  </button>
                  {#if feedback}
                    <span class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">{feedback.message}</span>
                  {/if}
                </div>

                {#if showMergeSmokeControls}
                  <div class="flex flex-wrap items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2 py-1.5">
                    <span class="text-[0.65rem] font-mono text-base-content/50">smoke:</span>
                    <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(taskId, pr, 'success')}>Success</button>
                    <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(taskId, pr, 'warning')}>Warning</button>
                    <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(taskId, pr, 'error')}>Failure</button>
                  </div>
                {/if}
              {:else if feedback}
                <div class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">
                  {feedback.message}
                </div>
              {/if}
            </div>
          {/if}

          {#if unaddressedComments.length > 0}
            <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Unaddressed comments">
              <div class="text-[0.7rem] font-medium text-base-content/55">Unaddressed comments</div>
              <PrCommentsList
                comments={unaddressedComments}
                imageBaseUrlForComment={() => getGitHubMarkdownImageBaseUrl(pr)}
                onMarkAddressed={commentLoader.markAddressedAndRefresh}
                showLocation={true}
                showMarkAddressed={allowCommentAddressing}
                density="detail"
              />
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
