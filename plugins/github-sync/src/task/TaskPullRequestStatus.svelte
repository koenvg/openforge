<script lang="ts">
  import { untrack } from 'svelte'
  import { GitPullRequest, Plus } from '@lucide/svelte'
  import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk/frontend'
  import type { PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import { pluginSectionKey, setSectionCollapsed } from '@openforge-app/plugin-sdk/collapsibleSectionState'
  import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
  import { isGitHubAttachmentUrl } from '@openforge-app/pr-review-ui/githubMarkdown'
  import { createGithubTaskClient } from './githubTaskClient'
  import PullRequestCard from './PullRequestCard.svelte'
  import PullRequestLinkForm from './PullRequestLinkForm.svelte'
  import { getTaskPullRequestCache } from './taskPullRequestCache.svelte'
  import { useMergeOrchestration } from './useMergeOrchestration.svelte'
  import { useTaskPullRequestRevalidation } from './useTaskPullRequestRevalidation.svelte'

  interface Props extends PluginTaskUISectionProps {
    taskActionPending?: boolean
  }

  let { api, context, taskId, taskActionPending = false }: Props = $props()

  const initialApi = untrack(() => api)
  const pluginId = untrack(() => context.pluginId)
  // Namespaced so this key cannot collide with another plugin's 'pull-requests' section.
  const sectionKey = pluginSectionKey(pluginId, 'pull-requests')
  const client = createGithubTaskClient(initialApi)
  const cache = getTaskPullRequestCache(initialApi, client)

  let cachedTask = $derived(cache.forTask(taskId))
  let pullRequests = $derived(cachedTask.pullRequests)
  let isEmpty = $derived(pullRequests.length === 0)
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

  // Uploads pasted into a review comment live behind a github.com URL only a
  // signed-in browser session can fetch; the sidecar trades it for a URL the app
  // can render. See PrReviewView for the same exchange on the review screen.
  function resolveCommentMedia(pr: PullRequestInfo) {
    return async (url: string): Promise<ResolvedMarkdownMedia | null> => {
      if (!isGitHubAttachmentUrl(url)) return null

      try {
        return await client.resolveGithubAsset({ owner: pr.repo_owner, repo: pr.repo_name, url })
      } catch {
        return null
      }
    }
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

  // Keyed by repository and number rather than by the local row id: the id is reassigned
  // when a pull request is unlinked and relinked, and two repositories hand out the same
  // pull request numbers.
  function cardSectionKey(pr: PullRequestInfo): string {
    return pluginSectionKey(pluginId, `pull-request:${pr.repo_owner}/${pr.repo_name}#${prNumber(pr)}`)
  }

  // The header actions stay clickable while the section is collapsed, so opening the
  // link form has to expand the section or the form appears in hidden content.
  function toggleAdding() {
    adding = !adding
    if (adding) setSectionCollapsed(sectionKey, false)
  }
</script>

{#snippet body()}
  {#if loadError}<p class="m-0 text-xs text-error" role="alert">Could not load pull requests: {loadError}</p>{/if}
  {#if visibleRefreshError}<p class="m-0 text-xs text-error" role="alert">Could not refresh GitHub status: {visibleRefreshError}</p>{/if}
  {#if revalidation.showLoading}<p class="m-0 text-xs text-base-content/55">Loading pull requests…</p>{/if}

  {#if adding}
    <PullRequestLinkForm onLink={linkPullRequest} onLinked={() => { adding = false }} onCancel={() => { adding = false }} />
  {/if}

  {#each pullRequests as pr (pr.id)}
    <PullRequestCard
      {pr}
      sectionKey={cardSectionKey(pr)}
      comments={commentsByPrId.get(pr.id) ?? []}
      feedback={orchestration.feedbackByPr.get(pr.id)}
      pendingPrId={orchestration.pendingPrId}
      {taskActionPending}
      resolveRemoteMedia={resolveCommentMedia(pr)}
      onOpenUrl={openExternal}
      onMarkAddressed={markAddressed}
      onRequestAction={requestAction}
    />
  {/each}
{/snippet}

{#if isEmpty}
  <!-- Nothing linked means no list to collapse, so the card shrinks to the row the
       source ticket uses: icon, section heading, add affordance. The host reads
       data-card-layout="row" to give both rows the same padding in the task inspector. -->
  <section
    data-task-info-card="pull-requests"
    data-card-sizing="natural"
    data-card-layout="row"
    class="flex flex-col gap-1.5 rounded-lg border border-base-300/70 bg-base-100 px-3 py-2 shrink-0"
    aria-label="Pull Requests"
    aria-busy={loading}
  >
    <div class="flex items-center gap-2" data-testid="task-pull-requests-empty">
      <!-- Blank stand-in for the collapsible sections' caret column, so this row's icon
           and title sit in the same columns as theirs. -->
      <span class="w-3 shrink-0" aria-hidden="true"></span>
      <GitPullRequest size={14} class="shrink-0 text-base-content/50" aria-hidden="true" />
      <h3 class="m-0 shrink-0 text-sm font-semibold text-base-content">Pull Requests</h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs h-auto min-h-0 gap-1 px-1 font-normal text-base-content/60"
        onclick={toggleAdding}
      >
        <Plus size={12} class="shrink-0" aria-hidden="true" />
        <span>Add PR</span>
      </button>
    </div>

    {@render body()}
  </section>
{:else}
  <CollapsibleSection {sectionKey} title="Pull Requests" cardId="pull-requests">
    {#snippet icon()}<GitPullRequest size={14} />{/snippet}
    {#snippet actions()}
      <span class="badge badge-ghost badge-sm font-mono">{pullRequests.length} {pullRequests.length === 1 ? 'PR' : 'PRs'}</span>
      <button type="button" class="btn btn-ghost btn-xs" onclick={toggleAdding}>Add PR</button>
      <!-- Icon only, in the same spot and shape as the Changes card's refresh: the label
           this used to carry pushed the section title into an ellipsis. -->
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
        aria-label="Refresh GitHub status"
        disabled={refreshing}
        onclick={() => void refreshGithubStatus()}
      >↻</button>
    {/snippet}

    <div class="flex flex-col gap-2.5 py-2" aria-busy={loading}>
      {@render body()}
    </div>
  </CollapsibleSection>
{/if}

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
