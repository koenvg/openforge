<script lang="ts">
  import type { Task, PullRequestInfo } from '../../lib/types'
  import { hasMergeConflicts, isReadyToMerge, isQueuedForMerge } from '../../lib/types'
  import { useMergeOrchestration } from './useMergeOrchestration.svelte'

  interface Props {
    task: Task
    taskPrs: PullRequestInfo[]
  }

  let { task, taskPrs }: Props = $props()

  const orchestration = useMergeOrchestration()

  const showMergeSmokeControls = typeof window !== 'undefined' && window.location.protocol.startsWith('http')

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }
</script>

{#if taskPrs.some((pr) => pr.state === 'merged' || hasMergeConflicts(pr) || isReadyToMerge(pr) || isQueuedForMerge(pr))}
  <section class="flex flex-col gap-2.5">
    <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Merge Status">// MERGE_STATUS</h3>
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
          {#if orchestration.mergeFeedbackByPr.has(pr.id)}
            {@const feedback = orchestration.mergeFeedbackByPr.get(pr.id)}
            {#if feedback}
              <div class="text-[0.7rem] mt-1 {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">
                {feedback.message}
              </div>
            {/if}
          {/if}
        </div>
      {:else if hasMergeConflicts(pr)}
        <div class="mb-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-base-content/50">{pr.title}</span>
            <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span>
              <span class="text-[10px] font-medium text-[var(--chip-error-text)]">Merge Conflict</span>
            </span>
          </div>
        </div>
      {:else if isQueuedForMerge(pr)}
        <div class="mb-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-base-content/50">{pr.title}</span>
            <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-info/15 text-info merge-ready">&#x25CF; In Merge Queue</span>
          </div>
        </div>
      {:else if isReadyToMerge(pr)}
        <div class="mb-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-base-content/50">{pr.title}</span>
            <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-info/15 text-info animate-pulse">&#x25CF; Ready to Merge</span>
          </div>
          <div class="mt-1.5 flex items-center gap-2">
            <button
              class="btn btn-success btn-xs"
              disabled={orchestration.mergingPrId !== null}
              onclick={() => orchestration.handleMerge(task.id, pr)}
            >
              {#if orchestration.mergingPrId === pr.id}
                <span class="loading loading-spinner loading-xs"></span>
                Merging...
              {:else}
                Merge
              {/if}
            </button>
            {#if orchestration.mergeFeedbackByPr.has(pr.id)}
              {@const feedback = orchestration.mergeFeedbackByPr.get(pr.id)}
              {#if feedback}
                <span class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">{feedback.message}</span>
              {/if}
            {/if}
          </div>
          {#if showMergeSmokeControls}
              <div class="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2 py-1.5">
                <span class="text-[0.65rem] font-mono text-base-content/50">smoke:</span>
                <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(task.id, pr, 'success')}>Success</button>
                <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(task.id, pr, 'warning')}>Warning</button>
                <button class="btn btn-ghost btn-xs" onclick={() => orchestration.runMergeSmokeTest(task.id, pr, 'error')}>Failure</button>
              </div>
            {/if}
        </div>
      {/if}
    {/each}
  </section>
{/if}
