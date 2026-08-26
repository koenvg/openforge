<script lang="ts">
  import { getTaskGitStatus } from '../../lib/ipc'
  import type { GitStatusSummary } from '../../lib/types'
  import { activeSessions } from '../../lib/stores'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import FileDiff from '@lucide/svelte/icons/file-diff'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let summary = $state<GitStatusSummary | null>(null)
  let loading = $state(false)
  let errored = $state(false)
  let loadToken = 0

  // Refresh strategy: on open, whenever the agent's session status changes, and
  // via the manual button. No polling.
  let agentStatus = $derived($activeSessions.get(taskId)?.status ?? null)
  let previousTaskId: string | null = null
  let previousAgentStatus: string | null = null

  async function refresh() {
    const token = ++loadToken
    loading = true
    errored = false
    try {
      const result = await getTaskGitStatus(taskId)
      if (token === loadToken) summary = result
    } catch {
      if (token === loadToken) errored = true
    } finally {
      if (token === loadToken) loading = false
    }
  }

  $effect(() => {
    const status = agentStatus
    if (taskId !== previousTaskId || status !== previousAgentStatus) {
      previousTaskId = taskId
      previousAgentStatus = status
      void refresh()
    }
  })
</script>

<CollapsibleSection sectionKey="git-status" title="Changes" cardId="git-status">
  {#snippet icon()}<FileDiff size={14} />{/snippet}
  {#snippet actions()}
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
      aria-label="Refresh changes"
      disabled={loading}
      onclick={() => void refresh()}
    >↻</button>
  {/snippet}

  {#if errored}
    <div class="py-2 text-xs text-base-content/50">Unable to read changes</div>
  {:else}
    <div class="flex flex-col gap-1.5 py-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/55">Remote</span>
        {#if !summary?.has_remote}
          <span class="text-xs text-base-content/40">no remote</span>
        {:else if summary.remote_ahead === 0 && summary.remote_behind === 0}
          <span class="text-xs text-base-content/50">up to date</span>
        {:else}
          <span class="flex items-center gap-1.5 font-mono text-xs" aria-label="Commits ahead and behind remote">
            {#if summary.remote_ahead > 0}<span class="text-success">↑{summary.remote_ahead}</span>{/if}
            {#if summary.remote_behind > 0}<span class="text-warning">↓{summary.remote_behind}</span>{/if}
          </span>
        {/if}
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/55">Commits</span>
        {#if (summary?.local_commits ?? 0) === 0}
          <span class="text-xs text-base-content/50">none</span>
        {:else}
          <span class="font-mono text-xs text-base-content/70" aria-label="Local commits">{summary.local_commits} {summary.local_commits === 1 ? 'commit' : 'commits'}</span>
        {/if}
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/55">Uncommitted</span>
        {#if (summary?.uncommitted_files ?? 0) === 0}
          <span class="text-xs text-base-content/50">none</span>
        {:else}
          <span class="flex items-center gap-2 font-mono text-xs" aria-label="Uncommitted changes">
            <span class="text-base-content/70">{summary.uncommitted_files} {summary.uncommitted_files === 1 ? 'file' : 'files'}</span>
            <span class="text-success">+{summary.insertions}</span>
            <span class="text-error">−{summary.deletions}</span>
          </span>
        {/if}
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/55">Untracked</span>
        {#if (summary?.untracked_files ?? 0) === 0}
          <span class="text-xs text-base-content/50">none</span>
        {:else}
          <span class="flex items-center gap-2 font-mono text-xs" aria-label="Untracked files">
            <span class="text-base-content/70">{summary.untracked_files} {summary.untracked_files === 1 ? 'file' : 'files'}</span>
            <span class="text-success">+{summary.untracked_insertions}</span>
          </span>
        {/if}
      </div>
    </div>
  {/if}
</CollapsibleSection>
