<script lang="ts">
  import type { PullRequestInfo } from '../../lib/types'
  import { hasMergeConflicts } from '../../lib/types'
  import { openUrl } from '../../lib/ipc'
  import { getPrStatusChips } from '../../lib/prStatusPresentation'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import { createPrCommentLoader } from '../../lib/prComments.svelte'
  import PrStatusChip from '../shared/ui/PrStatusChip.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import PrPipelineChecks from '../shared/pr/PrPipelineChecks.svelte'

  interface Props {
    taskPrs: PullRequestInfo[]
  }

  let { taskPrs }: Props = $props()

  const commentLoader = createPrCommentLoader({ getPullRequests: () => taskPrs })

  function prNumberLabel(pr: PullRequestInfo): string {
    const match = pr.url.match(/\/pull\/(\d+)/)
    return match ? `#${match[1]}` : `PR ${pr.id}`
  }

  function stateClass(pr: PullRequestInfo): string {
    if (pr.state === 'merged') return 'badge-ghost'
    if (pr.state === 'open') return 'badge-success badge-outline'
    return 'badge-ghost'
  }

  function prCardAriaLabel(pr: PullRequestInfo): string {
    const label = prNumberLabel(pr)
    return pr.state === 'merged' ? `Merged pull request ${label} (done)` : `Pull request ${label}`
  }

  function cardSurfaceClass(pr: PullRequestInfo): string {
    return pr.state === 'merged' ? 'bg-base-200/50 border-base-300/60' : 'bg-base-100 border-base-300/70'
  }

  function cardAccentClass(pr: PullRequestInfo): string {
    if (pr.state === 'merged') return 'border-l-base-300'
    if (pr.ci_status === 'failure' || hasMergeConflicts(pr)) return 'border-l-error'
    if ((pr.unaddressed_comment_count ?? 0) > 0 || pr.review_status === 'changes_requested') return 'border-l-warning'
    if (pr.ci_status === 'success') return 'border-l-success'
    return 'border-l-base-300'
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
    <div class="flex items-center justify-between gap-2 rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2">
      <span class="text-xs text-base-content/55">No linked pull requests yet</span>
      <span class="text-xs font-medium text-primary">Add PR</span>
    </div>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each taskPrs as pr (pr.id)}
        {@const chips = getPrStatusChips(pr, 'detail').filter((chip) => chip.type !== 'merge')}
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
            <span class="badge badge-xs capitalize {stateClass(pr)}">{pr.state}</span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5" aria-label="Pull request signals">
            {#each chips as chip (`${pr.id}-${chip.type}-${chip.label}`)}
              <PrStatusChip {chip} />
            {/each}
            {#if chips.length === 0}
              <span class="badge badge-ghost badge-sm">No CI or review signals</span>
            {/if}
            <span class="badge badge-ghost badge-sm">{pr.unaddressed_comment_count} {pr.unaddressed_comment_count === 1 ? 'comment' : 'comments'}</span>
          </div>

          <PrPipelineChecks ciCheckRuns={pr.ci_check_runs} variant="detail" />

          {#if unaddressedComments.length > 0}
            <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Unaddressed comments">
              <div class="text-[0.7rem] font-medium text-base-content/55">Unaddressed comments</div>
              <PrCommentsList
                comments={unaddressedComments}
                imageBaseUrlForComment={() => getGitHubMarkdownImageBaseUrl(pr)}
                showLocation={true}
                density="detail"
              />
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
