<script lang="ts">
  import { Check, Plus } from '@lucide/svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type {
    CoverageFinding,
    CriterionStatus,
    TicketCoverage,
    TicketCoverageVerdict,
    TicketSnapshot,
  } from '../../lib/ticketCoverage'

  interface Props {
    /**
     * null when this walkthrough was generated without Jira, either because it
     * predates the connection or because Jira is still unconfigured.
     * `jiraConfigured` is what separates those two cases.
     */
    snapshot: TicketSnapshot | null
    /** null when the agent produced no usable assessment. */
    coverage: TicketCoverage | null
    jiraConfigured: boolean
    /** Ids of findings the reviewer has already flagged to include in the review. */
    includedFindingIds: Set<string>
    onOpenUrl: (url: string) => void | Promise<void>
    onSetIssueKey: (issueKey: string) => void
    onRegenerate: () => void
    onToggleFinding: (finding: CoverageFinding) => void
  }

  let {
    snapshot,
    coverage,
    jiraConfigured,
    includedFindingIds,
    onOpenUrl,
    onSetIssueKey,
    onRegenerate,
    onToggleFinding,
  }: Props = $props()

  let ticket = $derived(snapshot?.item ?? null)
  let issueKeyDraft = $state('')

  // Seed the input from whatever was detected, so correcting a wrong key is an
  // edit rather than retyping.
  $effect(() => {
    issueKeyDraft = snapshot?.issue_key ?? ''
  })

  function submitIssueKey() {
    const key = issueKeyDraft.trim()
    if (!key) return
    onSetIssueKey(key.toUpperCase())
  }

  const VERDICT_LABELS: Record<TicketCoverageVerdict, string> = {
    complete: 'Complete',
    partial: 'Partial',
    missing: 'Missing',
    unassessable: 'Unassessable',
  }

  const VERDICT_CLASSES: Record<TicketCoverageVerdict, string> = {
    complete: 'badge-success',
    partial: 'badge-warning',
    missing: 'badge-error',
    unassessable: 'badge-ghost',
  }

  const STATUS_LABELS: Record<CriterionStatus, string> = {
    covered: 'Covered',
    partial: 'Partial',
    missing: 'Missing',
    unclear: 'Unclear',
  }

  const STATUS_CLASSES: Record<CriterionStatus, string> = {
    covered: 'badge-success',
    partial: 'badge-warning',
    missing: 'badge-error',
    unclear: 'badge-ghost',
  }

  function criterionFinding(criterion: TicketCoverage['criteria'][number]): CoverageFinding {
    return {
      id: criterion.id,
      label: STATUS_LABELS[criterion.status],
      text: criterion.notes ? `${criterion.text} — ${criterion.notes}` : criterion.text,
    }
  }

  function outOfScopeFinding(change: TicketCoverage['out_of_scope'][number], index: number): CoverageFinding {
    return { id: `oos-${index}`, label: 'Not in the ticket', text: change.description }
  }
</script>

<div class="flex flex-col gap-5 px-6 py-5 overflow-y-auto">
  {#if !jiraConfigured}
    <div class="text-sm text-base-content/70">
      Jira is not connected. Add your site URL, email, and API token in Settings → GitHub Sync →
      Jira, then regenerate this walkthrough to compare the changes against their ticket.
    </div>
  {:else if !snapshot}
    <div class="flex items-center justify-between gap-3 px-3 py-2 bg-base-200 rounded-md text-xs">
      <span class="text-base-content/70">
        This walkthrough was generated before Jira was connected, so no ticket was looked up.
      </span>
      <button type="button" class="btn btn-xs" onclick={onRegenerate}>Regenerate</button>
    </div>
  {:else}
    {#if ticket}
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            class="badge badge-outline font-mono"
            onclick={() => void onOpenUrl(ticket.url)}
            title="Open in Jira"
          >{ticket.issue_key}</button>
          {#if ticket.issue_type}
            <span class="text-[0.7rem] uppercase tracking-wider text-base-content/50">{ticket.issue_type}</span>
          {/if}
          {#if ticket.status}
            <span class="badge badge-sm badge-ghost">{ticket.status}</span>
          {/if}
        </div>
        <h4 class="text-sm font-semibold text-base-content m-0">{ticket.summary}</h4>
      </div>
    {/if}

    {#if snapshot.error}
      <div class="flex items-center justify-between gap-3 px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs">
        <span class="text-base-content/80">{snapshot.error}</span>
        <button type="button" class="btn btn-xs btn-error" onclick={onRegenerate}>Retry</button>
      </div>
    {/if}

    {#if coverage}
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="badge {VERDICT_CLASSES[coverage.verdict]}">{VERDICT_LABELS[coverage.verdict]}</span>
          <span class="text-[0.7rem] uppercase tracking-wider text-base-content/50">
            {coverage.criteria.length} criteria
          </span>
        </div>
        {#if coverage.summary}
          <p class="text-sm leading-relaxed text-base-content/90 m-0">{coverage.summary}</p>
        {/if}
      </div>

      <ul class="flex flex-col gap-3 list-none p-0 m-0">
        {#each coverage.criteria as criterion (criterion.id)}
          <li class="flex flex-col gap-1.5 px-3 py-2 bg-base-100 border border-base-300 rounded-md">
            <div class="flex items-start gap-2">
              <span class="badge badge-sm {STATUS_CLASSES[criterion.status]} shrink-0 mt-0.5">
                {STATUS_LABELS[criterion.status]}
              </span>
              <span class="text-sm text-base-content leading-snug flex-1">{criterion.text}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs gap-1 shrink-0 {includedFindingIds.has(criterion.id) ? 'text-success' : 'text-base-content/50'}"
                onclick={() => onToggleFinding(criterionFinding(criterion))}
                title={includedFindingIds.has(criterion.id) ? 'Remove from review' : 'Add to review'}
                aria-pressed={includedFindingIds.has(criterion.id)}
              >
                {#if includedFindingIds.has(criterion.id)}
                  <Check size={12} aria-hidden="true" /> Added
                {:else}
                  <Plus size={12} aria-hidden="true" /> Add to review
                {/if}
              </button>
            </div>
            {#if criterion.notes}
              <p class="text-xs text-base-content/70 m-0 pl-1">{criterion.notes}</p>
            {/if}
            {#if criterion.evidence.length > 0}
              <div class="flex flex-wrap gap-1.5 pl-1">
                {#each criterion.evidence as evidence}
                  <span class="badge badge-sm badge-ghost font-mono text-[0.7rem]" title={evidence.note ?? ''}>
                    {evidence.filename}
                  </span>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if coverage.out_of_scope.length > 0}
        <div class="flex flex-col gap-2">
          <h5 class="text-xs font-semibold uppercase tracking-wider text-base-content/50 m-0">
            Not in the ticket
          </h5>
          <ul class="flex flex-col gap-2 list-none p-0 m-0">
            {#each coverage.out_of_scope as change, index}
              <li class="flex flex-col gap-1 px-3 py-2 bg-base-100 border border-base-300 border-l-4 border-l-info rounded-md">
                <div class="flex items-start gap-2">
                  <span class="text-sm text-base-content leading-snug flex-1">{change.description}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs gap-1 shrink-0 {includedFindingIds.has(`oos-${index}`) ? 'text-success' : 'text-base-content/50'}"
                    onclick={() => onToggleFinding(outOfScopeFinding(change, index))}
                    title={includedFindingIds.has(`oos-${index}`) ? 'Remove from review' : 'Add to review'}
                    aria-pressed={includedFindingIds.has(`oos-${index}`)}
                  >
                    {#if includedFindingIds.has(`oos-${index}`)}
                      <Check size={12} aria-hidden="true" /> Added
                    {:else}
                      <Plus size={12} aria-hidden="true" /> Add to review
                    {/if}
                  </button>
                </div>
                {#if change.files.length > 0}
                  <div class="flex flex-wrap gap-1.5">
                    {#each change.files as filename}
                      <span class="badge badge-sm badge-ghost font-mono text-[0.7rem]">{filename}</span>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {:else if ticket}
      <div class="flex items-center justify-between gap-3 px-3 py-2 bg-base-200 rounded-md text-xs">
        <span class="text-base-content/70">
          The agent did not return a usable coverage assessment for this ticket.
        </span>
        <button type="button" class="btn btn-xs" onclick={onRegenerate}>Regenerate</button>
      </div>
    {:else if !snapshot.error}
      <div class="text-sm text-base-content/70">
        No Jira ticket could be found for this pull request. Set one below to compare the changes
        against it.
      </div>
    {/if}

    {#if ticket?.acceptance_criteria}
      <div class="flex flex-col gap-1.5">
        <h5 class="text-xs font-semibold uppercase tracking-wider text-base-content/50 m-0">
          Acceptance criteria (from the ticket)
        </h5>
        <div class="px-3 py-2 bg-base-100 border border-base-300 rounded-md text-sm">
          <MarkdownContent content={ticket.acceptance_criteria} {onOpenUrl} />
        </div>
      </div>
    {/if}

    {#if ticket?.description}
      <details class="text-sm">
        <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wider text-base-content/50">
          Ticket description
        </summary>
        <div class="mt-2 text-base-content/90">
          <MarkdownContent content={ticket.description} {onOpenUrl} />
        </div>
      </details>
    {/if}

    <div class="flex items-end gap-2 pt-2 border-t border-base-300">
      <label class="form-control flex-1 max-w-xs">
        <span class="label-text text-xs text-base-content/60">Jira ticket key</span>
        <input
          class="input input-bordered input-sm font-mono"
          aria-label="Jira ticket key"
          placeholder="AVIV-304"
          bind:value={issueKeyDraft}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter') { event.preventDefault(); submitIssueKey() }
          }}
        />
      </label>
      <button type="button" class="btn btn-sm" onclick={submitIssueKey}>Set ticket</button>
    </div>
  {/if}
</div>
