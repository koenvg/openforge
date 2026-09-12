<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import { branchDivergenceRequest, resolveBranchDivergence } from '../lib/branchDivergenceModalStore'
  import type { CommitSummary } from '../lib/types'

  interface Props {
    /** Test seam: override the max commits rendered per list. */
    maxVisibleCommits?: number
  }

  let { maxVisibleCommits = 50 }: Props = $props()

  const request = $derived($branchDivergenceRequest)
  const plan = $derived(request?.plan ?? null)
  const aheadCount = $derived(plan?.ahead.length ?? 0)
  const behindCount = $derived(plan?.behind.length ?? 0)

  function visibleCommits(commits: CommitSummary[]): CommitSummary[] {
    return commits.slice(0, maxVisibleCommits)
  }

  function hiddenCount(commits: CommitSummary[], truncated: boolean): number {
    const beyondCap = Math.max(0, commits.length - maxVisibleCommits)
    // The backend `truncated` flag means MORE than the cap existed; surface at
    // least one "+N more" so a hard cap is never a silent drop.
    return truncated ? Math.max(beyondCap, 1) : beyondCap
  }

  const aheadHidden = $derived(plan ? hiddenCount(plan.ahead, plan.aheadTruncated) : 0)
  const behindHidden = $derived(plan ? hiddenCount(plan.behind, plan.behindTruncated) : 0)

  function keepLocal() {
    resolveBranchDivergence('keepLocal')
  }

  function resetToRemote() {
    resolveBranchDivergence('resetToRemote')
  }

  function cancel() {
    resolveBranchDivergence('cancel')
  }
</script>

{#if request && plan}
  <Modal onClose={cancel} maxWidth="560px" boxClass="branch-divergence-box" ariaLabel="Resolve branch divergence">
    {#snippet header()}
      <h2 class="divergence-heading text-[0.95rem] font-semibold text-of-text m-0">
        <code class="text-of-accent">{request.branchName}</code> has diverged from
        <code class="text-of-accent">origin/{request.branchName}</code>
      </h2>
    {/snippet}

    <!-- Keyboard users need a tab stop to scroll the commit comparison. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="commit-comparison p-4 flex flex-col gap-4" role="region" aria-label="Commit comparison" tabindex="0">
      <p class="m-0 text-sm text-of-text/70">
        {aheadCount} ahead, {behindCount} behind. Choose how to start this task.
      </p>

      {#if !plan.remoteReachable}
        <p class="m-0 text-xs text-of-text/50" role="status">
          Couldn't reach remote — comparison may be stale.
        </p>
      {/if}

      {#if aheadCount > 0}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-of-text/60">Your local commits (lost if you reset)</span>
          <ul class="m-0 flex flex-col gap-1 list-none p-0">
            {#each visibleCommits(plan.ahead) as commit (commit.shortSha)}
              <li class="text-xs text-of-text/80">
                <code class="text-of-warning">{commit.shortSha}</code>
                <span class="ml-1">{commit.subject}</span>
                <span class="text-of-text/40"> · {commit.author} · {commit.relativeDate}</span>
              </li>
            {/each}
          </ul>
          {#if aheadHidden > 0}
            <span class="text-xs text-of-text/50">+{aheadHidden} more</span>
          {/if}
        </div>
      {/if}

      {#if behindCount > 0}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-of-text/60">On remote, not local</span>
          <ul class="m-0 flex flex-col gap-1 list-none p-0">
            {#each visibleCommits(plan.behind) as commit (commit.shortSha)}
              <li class="text-xs text-of-text/80">
                <code class="text-of-info">{commit.shortSha}</code>
                <span class="ml-1">{commit.subject}</span>
                <span class="text-of-text/40"> · {commit.author} · {commit.relativeDate}</span>
              </li>
            {/each}
          </ul>
          {#if behindHidden > 0}
            <span class="text-xs text-of-text/50">+{behindHidden} more</span>
          {/if}
        </div>
      {/if}

    </div>

    <div class="flex shrink-0 flex-wrap justify-end gap-2 p-4">
        <Button variant="ghost" size="sm" type="button" onclick={cancel}>Cancel</Button>
        <Button variant="danger" size="sm" type="button" onclick={resetToRemote}>
          Reset to remote
        </Button>
        <Button variant="primary" size="sm" type="button" onclick={keepLocal}>
          Keep local
        </Button>
    </div>
  </Modal>
{/if}

<style>
  .divergence-heading {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .commit-comparison {
    min-height: 0;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }

  :global(.branch-divergence-box) {
    overflow: hidden;
  }

  :global(.branch-divergence-box > .of-modal-header) {
    flex-shrink: 0;
  }

  .commit-comparison:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: calc(-1 * var(--of-focus-width));
  }
</style>
