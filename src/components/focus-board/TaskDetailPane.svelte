<script lang="ts">
  import type { Task, PullRequestInfo, PrComment } from '../../lib/types'
  import { getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import { openUrl } from '../../lib/ipc'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'
  import { getPrStatusChips } from '../../lib/prStatusPresentation'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import { createPrCommentLoader } from '../../lib/prComments.svelte'
  import PrStatusChip from '../shared/ui/PrStatusChip.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import PrPipelineChecks from '../shared/pr/PrPipelineChecks.svelte'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'

  interface Props {
    task: Task | null
    allTasks?: Task[]
    pullRequests: PullRequestInfo[]
    onOpenFullView: () => void
  }

  let { task, allTasks = [], pullRequests, onOpenFullView }: Props = $props()

  const commentLoader = createPrCommentLoader({
    getPullRequests: () => pullRequests,
    isEnabled: () => task !== null,
  })

  let markdownImageBaseUrlsByPrId = $derived(new Map(pullRequests.map((pr) => [pr.id, getGitHubMarkdownImageBaseUrl(pr)])))
  let dependencies = $derived(task ? getTaskDependencySummaries(task, allTasks) : [])
  let waitingDependencyCount = $derived(task ? getWaitingDependencyCount(task, allTasks) : 0)
  let dependents = $derived(task ? getTaskDependentSummaries(task, allTasks) : [])

  function getCommentImageBaseUrl(comment: PrComment): string | null {
    return markdownImageBaseUrlsByPrId.get(comment.pr_id) ?? null
  }
</script>

{#if task === null}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full items-center justify-center">
    <p class="text-xs text-base-content/40">Select a task to see details</p>
  </div>
{:else}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full">

    <div class="flex items-center gap-2 flex-wrap">
      <span class="font-mono text-sm font-bold text-primary">{task.id}</span>
      <button
        class="btn btn-ghost btn-xs ml-auto text-base-content/60 hover:text-primary"
        onclick={onOpenFullView}
      >
        Open full view →
      </button>
    </div>

    <section class="flex flex-col gap-1.5">
      <span class="font-mono text-[10px] font-bold text-primary">// INITIAL_PROMPT</span>
      <p class="text-xs text-base-content/70 leading-relaxed whitespace-pre-wrap break-words">{task.initial_prompt}</p>
    </section>

    <section class="flex flex-col gap-1.5">
      <span class="font-mono text-[10px] font-bold text-primary">// HANDOFF_NOTES</span>
      {#if task.summary}
        <div class="text-xs text-base-content/70 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0">
          <MarkdownContent content={task.summary.replace(/\\n/g, '\n')} />
        </div>
      {:else}
        <p class="text-xs text-base-content/40">No handoff notes yet.</p>
      {/if}
    </section>

    <TaskRelationshipDetailSection
      kind="dependencies"
      items={dependencies}
      {waitingDependencyCount}
      density="compact"
    />

    <TaskRelationshipDetailSection
      kind="dependents"
      items={dependents}
      density="compact"
    />

    {#if pullRequests.length > 0}
      <section class="flex flex-col gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PULL_REQUESTS</span>
        {#each pullRequests as pr (pr.id)}
          <div class="rounded-xl bg-base-200/50 border border-base-300/40 p-3 flex flex-col gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider {pr.state === 'open' ? 'bg-success/15 text-success' : pr.state === 'merged' ? 'bg-secondary/15 text-secondary' : 'bg-error/15 text-error'}">
                {pr.state}
              </span>
              {#each getPrStatusChips(pr, 'compact').filter(c => c.type === 'merge' && c.variant === 'error') as chip}
                <PrStatusChip {chip} />
              {/each}
              <span class="text-xs text-base-content font-medium">{pr.title}</span>
            </div>
            <button
              class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start"
              onclick={() => openUrl(pr.url)}
            >
              {pr.url}
            </button>
          </div>
        {/each}
      </section>
    {/if}

    {#if pullRequests.some((pr) => pr.ci_status)}
      <section class="flex flex-col gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PIPELINE_STATUS</span>
        {#each pullRequests as pr (pr.id)}
          {#if pr.ci_status}
            {@const ciChip = getPrStatusChips(pr, 'detail').find(c => c.type === 'ci')}
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-base-content/50">{pr.title}</span>
                {#if ciChip}
                  <PrStatusChip chip={ciChip} />
                {:else if pr.ci_status}
                  <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.ci_status === 'success' ? 'bg-success/15 text-success' : pr.ci_status === 'failure' ? 'bg-error/15 text-error' : pr.ci_status === 'pending' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'} flex items-center gap-1 w-fit">
                    {#if pr.ci_status === 'success'}Passing
                    {:else if pr.ci_status === 'failure'}Failing
                    {:else if pr.ci_status === 'pending'}Running
                    {:else}— No CI{/if}
                  </span>
                {/if}
              </div>
              <PrPipelineChecks ciCheckRuns={pr.ci_check_runs} variant="compact" />
            </div>
          {/if}
        {/each}
      </section>
    {/if}

    <section class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PR_COMMENTS</span>
        {#if commentLoader.unaddressedComments.length > 0}
          <span class="badge badge-error badge-sm text-[10px] font-mono">{commentLoader.unaddressedComments.length}</span>
        {/if}
      </div>
      {#if commentLoader.unaddressedComments.length === 0}
        <p class="text-xs text-base-content/40">No comments.</p>
      {:else}
        <PrCommentsList
          comments={commentLoader.unaddressedComments}
          imageBaseUrlForComment={getCommentImageBaseUrl}
          onMarkAddressed={commentLoader.markAddressedAndRefresh}
          showMarkAddressed={true}
          density="compact"
        />
      {/if}
    </section>

  </div>
{/if}
