<script lang="ts">
  import type { Task, PrComment } from '../lib/types'
  import { parseCheckRuns, isReadyToMerge } from '../lib/types'
  import { ticketPrs } from '../lib/stores'
  import { getPrComments, markCommentAddressed, openUrl } from '../lib/ipc'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  let prCommentsByPr = $state<Map<number, PrComment[]>>(new Map())

  async function loadPrComments() {
    const prs = $ticketPrs.get(task.id) || []
    prCommentsByPr = new Map()
    
    for (const pr of prs) {
      try {
        const comments = await getPrComments(pr.id)
        prCommentsByPr.set(pr.id, comments)
      } catch (e) {
        console.error(`Failed to load comments for PR ${pr.id}:`, e)
      }
    }
    prCommentsByPr = prCommentsByPr
  }

  $effect(() => {
    // Reload PR comments when task changes or ticketPrs updates
    const prs = $ticketPrs.get(task.id)
    if (prs) {
      loadPrComments()
    }
  })

  async function handleMarkAddressed(commentId: number, prId: number) {
    try {
      await markCommentAddressed(commentId)
      // Reload comments for this PR
      const comments = await getPrComments(prId)
      prCommentsByPr.set(prId, comments)
      prCommentsByPr = prCommentsByPr
    } catch (e) {
      console.error('Failed to mark comment as addressed:', e)
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  function getUnaddressedCount(comments: PrComment[]): number {
    return comments.filter(c => c.addressed === 0).length
  }

  let taskPrs = $derived($ticketPrs.get(task.id) || [])
</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <!-- Title / Initial Prompt Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Initial Prompt</h3>
    <div class="text-sm text-base-content leading-relaxed whitespace-pre-wrap break-words">{task.title}</div>
  </section>

  <!-- Merge Status Section -->
  {#if taskPrs.some(pr => pr.state === 'merged' || isReadyToMerge(pr))}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Merge Status</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.state === 'merged'}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-secondary/15 text-secondary">&#x2714; Merged</span>
            </div>
            {#if pr.merged_at}
              <div class="text-[0.7rem] text-base-content/50 mt-1">
                Merged on {formatDate(pr.merged_at)}
              </div>
            {/if}
          </div>
        {:else if isReadyToMerge(pr)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-success/25 text-success merge-ready">&#x25CF; Ready to Merge</span>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- PR Links Section -->
  {#if taskPrs.length > 0}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Pull Requests</h3>
      <div class="flex flex-col gap-2">
        {#each taskPrs as pr (pr.id)}
          <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider {pr.state === 'open' ? 'bg-success text-success-content' : pr.state === 'merged' ? 'bg-secondary text-secondary-content' : 'bg-error text-error-content'}">
                {pr.state}
              </span>
              <span class="text-sm text-base-content font-medium">{pr.title}</span>
            </div>
            <button class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start" onclick={() => openUrl(pr.url)}>
              {pr.url}
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Pipeline Status Section -->
  {#if taskPrs.some(pr => pr.ci_status)}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Pipeline Status</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.ci_status}
          {@const checkRuns = parseCheckRuns(pr.ci_check_runs)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.ci_status === 'success' ? 'bg-success/15 text-success' : pr.ci_status === 'failure' ? 'bg-error/15 text-error' : pr.ci_status === 'pending' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'}">
                {#if pr.ci_status === 'success'}✓ Passing
                {:else if pr.ci_status === 'failure'}✗ Failing
                {:else if pr.ci_status === 'pending'}⏳ Running
                {:else if pr.ci_status === 'none'}— No CI
                {/if}
              </span>
            </div>
            {#if checkRuns.length > 0}
              <div class="flex flex-col gap-1">
                {#each checkRuns as check (check.id)}
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="w-4 text-center font-semibold {check.conclusion === 'success' ? 'text-success' : check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">
                      {#if check.conclusion === 'success'}✓
                      {:else if check.conclusion === 'failure'}✗
                      {:else if check.status !== 'completed'}⏳
                      {:else}—{/if}
                    </span>
                    <span class="text-base-content">{check.name}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- Review Status Section -->
  {#if taskPrs.some(pr => pr.review_status && pr.review_status !== 'none')}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Review Status</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.review_status && pr.review_status !== 'none'}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.review_status === 'approved' ? 'bg-success/15 text-success' : pr.review_status === 'changes_requested' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'}">
                {#if pr.review_status === 'approved'}✓ Approved
                {:else if pr.review_status === 'changes_requested'}✗ Changes Requested
                {:else if pr.review_status === 'review_required'}⏳ Review Required
                {/if}
              </span>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- PR Comments Section -->
  {#if taskPrs.length > 0}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">PR Comments</h3>
      {#each taskPrs as pr (pr.id)}
        {@const comments = prCommentsByPr.get(pr.id) || []}
        {@const unaddressedCount = getUnaddressedCount(comments)}
        {#if comments.length > 0}
          <div class="mb-4">
            <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-base-300">
              <span class="text-xs text-base-content/50 font-medium">{pr.title}</span>
              {#if unaddressedCount > 0}
                <span class="badge badge-error badge-sm">{unaddressedCount} unaddressed</span>
              {/if}
            </div>
            <div class="flex flex-col gap-2">
              {#each comments as comment (comment.id)}
                <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2 {comment.addressed === 1 ? 'opacity-60' : ''}">
                  <div class="flex gap-2 items-center flex-wrap">
                    <span class="text-xs font-semibold text-primary">@{comment.author}</span>
                    {#if comment.file_path}
                      <span class="text-[0.7rem] text-base-content/50 font-mono">
                        {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
                      </span>
                    {/if}
                  </div>
                  <div class="text-sm text-base-content leading-snug whitespace-pre-wrap break-words">{comment.body}</div>
                  {#if comment.addressed === 0}
                    <button 
                      class="btn btn-soft btn-xs w-fit shadow-sm hover:shadow-md transition-shadow"
                      onclick={() => handleMarkAddressed(comment.id, pr.id)}>
                      Mark Addressed
                    </button>
                  {:else}
                    <span class="text-[0.7rem] text-success font-medium">✓ Addressed</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
     </section>
   {/if}

 </div>
 
 <style>
  @keyframes ready-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  .merge-ready {
    animation: ready-pulse 2s ease-in-out infinite;
  }
</style>
