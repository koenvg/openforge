<script lang="ts">
  import type { PrComment, PullRequestInfo } from '../../lib/types'
  import { hasMergeConflicts, parseCheckRuns, splitCheckRuns } from '../../lib/types'
  import { getPrComments, openUrl } from '../../lib/ipc'
  import { getPrStatusChips } from '../../lib/prStatusPresentation'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'
  import PrStatusChip from '../shared/ui/PrStatusChip.svelte'

  interface Props {
    taskPrs: PullRequestInfo[]
  }

  let { taskPrs }: Props = $props()

  let commentsByPrId = $state<Map<number, PrComment[]>>(new Map())
  let commentLoadGeneration = 0
  let prSignature = $derived(taskPrs.map((pr) => `${pr.id}:${pr.updated_at}:${pr.unaddressed_comment_count}`).join('|'))

  async function fetchComments(signature: string) {
    const generation = ++commentLoadGeneration
    if (taskPrs.length === 0) {
      commentsByPrId = new Map()
      return
    }

    const pairs = await Promise.all(taskPrs.map(async (pr) => {
      try {
        const comments = await getPrComments(pr.id)
        return [pr.id, comments] as const
      } catch (error) {
        console.error(`Failed to load comments for PR ${pr.id}:`, error)
        return [pr.id, []] as const
      }
    }))

    if (generation === commentLoadGeneration && signature === prSignature) {
      commentsByPrId = new Map(pairs)
    }
  }

  function unaddressedCommentsForPr(prId: number): PrComment[] {
    return (commentsByPrId.get(prId) ?? []).filter((comment) => comment.addressed === 0)
  }

  function getCommentImageBaseUrl(pr: PullRequestInfo): string | null {
    return getGitHubMarkdownImageBaseUrl(pr)
  }

  function prNumberLabel(pr: PullRequestInfo): string {
    const match = pr.url.match(/\/pull\/(\d+)/)
    return match ? `#${match[1]}` : `PR ${pr.id}`
  }

  function stateClass(pr: PullRequestInfo): string {
    if (pr.state === 'merged') return 'badge-secondary badge-outline'
    if (pr.state === 'open') return 'badge-success badge-outline'
    return 'badge-ghost'
  }

  function cardAccentClass(pr: PullRequestInfo): string {
    if (pr.ci_status === 'failure' || hasMergeConflicts(pr)) return 'border-l-error'
    if ((pr.unaddressed_comment_count ?? 0) > 0 || pr.review_status === 'changes_requested') return 'border-l-warning'
    if (pr.state === 'merged' || pr.ci_status === 'success') return 'border-l-success'
    return 'border-l-base-300'
  }

  $effect(() => {
    void fetchComments(prSignature)
  })
</script>

<section class="flex flex-col gap-2.5 border-b border-base-300/70 pb-3" aria-label="Pull Requests">
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
        {@const checkRuns = parseCheckRuns(pr.ci_check_runs)}
        {@const { visible, passingCount } = splitCheckRuns(checkRuns)}
        {@const chips = getPrStatusChips(pr, 'detail').filter((chip) => chip.type !== 'merge')}
        {@const unaddressedComments = unaddressedCommentsForPr(pr.id)}
        <article data-testid="task-attention-pr-card" class="rounded-lg bg-base-100 border border-base-300/70 border-l-2 {cardAccentClass(pr)} overflow-hidden" aria-label={`Pull request ${prNumberLabel(pr)}`}>
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

          {#if visible.length > 0 || passingCount > 0}
            <div class="border-t border-base-300/70 px-2.5 py-2 flex flex-col gap-1" aria-label="Pipeline checks">
              <div class="text-[0.7rem] font-medium text-base-content/55">Pipeline checks</div>
              {#each visible as check (check.id)}
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold {check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">
                    {#if check.conclusion === 'failure'}Failed
                    {:else if check.status !== 'completed'}Running
                    {:else}Skipped{/if}
                  </span>
                  <span class="text-base-content/70">{check.name}</span>
                </div>
              {/each}
              {#if passingCount > 0}
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-success">Passed</span>
                  <span class="text-base-content/50">{passingCount} passing</span>
                </div>
              {/if}
            </div>
          {/if}

          {#if unaddressedComments.length > 0}
            <div class="border-t border-base-300/70 bg-base-200/35 p-2.5 flex flex-col gap-2" aria-label="Unaddressed comments">
              <div class="text-[0.7rem] font-medium text-base-content/55">Unaddressed comments</div>
              {#each unaddressedComments as comment (comment.id)}
                <article class="rounded-md border border-base-300/70 bg-base-100 p-2.5 flex flex-col gap-1.5" aria-label={`Comment by ${comment.author}`}>
                  <div class="flex flex-wrap items-center gap-1.5 text-[0.7rem] text-base-content/50">
                    <span class="font-semibold text-base-content/80">{comment.author}</span>
                    {#if comment.file_path}
                      <span>·</span>
                      <span>{comment.file_path}{comment.line_number ? `:${comment.line_number}` : ''}</span>
                    {/if}
                  </div>
                  <div class="text-xs text-base-content/75 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1">
                    <MarkdownContent content={comment.body} imageBaseUrl={getCommentImageBaseUrl(pr)} />
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
