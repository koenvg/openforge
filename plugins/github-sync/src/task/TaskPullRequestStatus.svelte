<script lang="ts">
  import { untrack } from 'svelte'
  import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk/frontend'
  import type { PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import { createGithubTaskClient } from './githubTaskClient'
  import PullRequestCard from './PullRequestCard.svelte'
  import PullRequestLinkForm from './PullRequestLinkForm.svelte'
  import { getTaskPullRequestCache } from './taskPullRequestCache.svelte'
  import { useMergeOrchestration } from './useMergeOrchestration.svelte'
  import { useTaskPullRequestRevalidation } from './useTaskPullRequestRevalidation.svelte'

  interface Props extends PluginTaskUISectionProps {
    taskActionPending?: boolean
  }

  let { api, taskId, taskActionPending = false }: Props = $props()

  const initialApi = untrack(() => api)
  const client = createGithubTaskClient(initialApi)
  const cache = getTaskPullRequestCache(initialApi, client)

  let cachedTask = $derived(cache.forTask(taskId))
  let pullRequests = $derived(cachedTask.pullRequests)
  let commentsByPrId = $derived(cachedTask.commentsByPrId)
  let loading = $derived(cachedTask.loading)
  let loadError = $derived(cachedTask.loaded ? null : cachedTask.error)
  let cachedRefreshError = $derived(cachedTask.loaded ? cachedTask.error : null)
  let refreshError = $state<string | null>(null)
  const revalidation = useTaskPullRequestRevalidation(initialApi, cache, () => taskId, () => { refreshError = null })
  let visibleRefreshError = $derived(refreshError ?? cachedRefreshError)
  let refreshing = $state(false)
  let adding = $state(false)
  let confirmingEnqueue = $state<PullRequestInfo | null>(null)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function refreshCompletedAction(pr: PullRequestInfo): Promise<void> {
    await cache.invalidateAndRefresh(pr.ticket_id)
  }

  const orchestration = useMergeOrchestration(client, refreshCompletedAction)

  async function refreshGithubStatus(): Promise<void> {
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

  async function linkPullRequest(url: string): Promise<void> {
    await client.linkPullRequest(taskId, url)
    await cache.invalidateAndRefresh(taskId)
  }

  async function markAddressed(commentId: number): Promise<void> {
    await client.markCommentAddressed(commentId)
    await cache.invalidateAndRefresh(taskId)
  }

  function openExternal(url: string): void {
    void api.system.openUrl(url)
  }

  function requestAction(pr: PullRequestInfo, action: 'merge' | 'enqueue'): void {
    if (orchestration.pendingPrId !== null) return
    if (action === 'merge') {
      void orchestration.merge(pr)
      return
    }
    confirmingEnqueue = pr
  }

  async function confirmEnqueue(): Promise<void> {
    const pr = confirmingEnqueue
    if (!pr) return
    confirmingEnqueue = null
    await orchestration.enqueue(pr)
  }

  function prNumber(pr: PullRequestInfo): number {
    return pr.pr_number ?? pr.id
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
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => { adding = !adding }}>Add PR</button>
    </div>
  </div>

  <div
    class="flex flex-col gap-2.5 px-3 py-2"
    class:min-h-8={loading && !adding && pullRequests.length === 0}
    aria-busy={loading}
  >
    {#if loadError}<p class="m-0 text-xs text-error" role="alert">Could not load pull requests: {loadError}</p>{/if}
    {#if visibleRefreshError}<p class="m-0 text-xs text-error" role="alert">Could not refresh GitHub status: {visibleRefreshError}</p>{/if}
    {#if revalidation.showLoading}<p class="m-0 text-xs text-base-content/55">Loading pull requests…</p>{/if}

    {#if adding}
      <PullRequestLinkForm onLink={linkPullRequest} onLinked={() => { adding = false }} onCancel={() => { adding = false }} />
    {/if}

    {#if !loading && pullRequests.length === 0 && !adding}<div class="rounded-lg border border-dashed border-base-300 bg-base-100/60 px-3 py-2 text-xs text-base-content/55">No linked pull requests yet</div>{/if}

    {#each pullRequests as pr (pr.id)}
      <PullRequestCard
        {pr}
        comments={commentsByPrId.get(pr.id) ?? []}
        feedback={orchestration.feedbackByPr.get(pr.id)}
        pendingPrId={orchestration.pendingPrId}
        {taskActionPending}
        onOpenUrl={openExternal}
        onMarkAddressed={markAddressed}
        onRequestAction={requestAction}
      />
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
