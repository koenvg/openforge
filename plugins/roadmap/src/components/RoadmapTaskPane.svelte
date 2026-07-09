<script lang="ts">
  import { ExternalLink } from '@lucide/svelte'
  import type { PluginTaskPaneProps } from '@openforge-app/plugin-sdk/frontend'
  import type { RoadmapIssue } from '../lib/types'
  import { loadRoadmapIssueTaskLinkForTask } from '../lib/roadmapActions'
  import { createRoadmapClient } from '../lib/roadmapClient'

  interface LinkedTicket {
    issueNumber: number
    repo: string | null
    title: string | null
  }

  interface Props extends PluginTaskPaneProps {}

  let { api, taskId, projectId }: Props = $props()

  // `api` is a stable prop; build the client once. (Intentional initial capture.)
  // svelte-ignore state_referenced_locally
  const client = createRoadmapClient(api)

  let linkedTicket = $state<LinkedTicket | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let loadRequest = 0

  function repoFromIssueBoard(repo: { owner: string; name: string }): string {
    return `${repo.owner}/${repo.name}`
  }

  function resolveTitle(issue: RoadmapIssue | undefined, fallback: string | null): string | null {
    return issue?.title ?? fallback
  }

  async function loadLinkedTicket(pid: string | null, tid: string) {
    const requestId = ++loadRequest
    linkedTicket = null
    error = null
    if (!pid) {
      loading = false
      return
    }

    loading = true
    try {
      const match = await loadRoadmapIssueTaskLinkForTask(api, pid, tid)
      if (!match) return

      let repo = match.link.repo
      let title = match.link.title
      try {
        const board = await client.getBoard(pid)
        repo = repoFromIssueBoard(board.repo)
        title = resolveTitle(board.issues.find((issue) => issue.number === match.issueNumber), title)
      } catch {
        // Stored link metadata is enough to show the relationship even if GitHub board refresh fails.
      }

      if (requestId === loadRequest) linkedTicket = { issueNumber: match.issueNumber, repo, title }
    } catch (e) {
      if (requestId === loadRequest) error = String(e instanceof Error ? e.message : e)
    } finally {
      if (requestId === loadRequest) loading = false
    }
  }

  function openIssue() {
    if (!linkedTicket?.repo) return
    void api.system.openUrl(`https://github.com/${linkedTicket.repo}/issues/${linkedTicket.issueNumber}`)
  }

  $effect(() => {
    void loadLinkedTicket(projectId, taskId)
  })
</script>

<section class="flex flex-col gap-3 text-sm">
  <div>
    <h3 class="font-semibold m-0">Roadmap ticket</h3>
    <p class="text-base-content/60 m-0">GitHub issue that started this task.</p>
  </div>

  {#if loading}
    <p class="text-base-content/60 m-0">Loading linked ticket…</p>
  {:else if error}
    <p class="text-error m-0">{error}</p>
  {:else if linkedTicket}
    <div class="rounded-box border border-base-300 p-3 flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <span class="badge badge-outline shrink-0">#{linkedTicket.issueNumber}</span>
        <div class="min-w-0">
          <p class="font-medium m-0 break-words">{linkedTicket.title ?? 'Linked roadmap ticket'}</p>
          {#if linkedTicket.repo}
            <p class="text-xs text-base-content/60 m-0">{linkedTicket.repo}</p>
          {/if}
        </div>
      </div>
      {#if linkedTicket.repo}
        <button class="btn btn-sm self-start" type="button" onclick={openIssue}>
          <ExternalLink size={14} /> Open GitHub issue
        </button>
      {/if}
    </div>
  {:else}
    <p class="text-base-content/60 m-0">No roadmap ticket is linked to this task.</p>
  {/if}
</section>
