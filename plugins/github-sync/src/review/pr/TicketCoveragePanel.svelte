<script lang="ts">
  import { Check, Plus } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import { criterionFinding, outOfScopeFinding, STATUS_LABELS } from '../../lib/ticketCoverage'
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

  type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger'

  const VERDICT_VARIANTS: Record<TicketCoverageVerdict, BadgeVariant> = {
    complete: 'success',
    partial: 'warning',
    missing: 'danger',
    unassessable: 'neutral',
  }

  const STATUS_VARIANTS: Record<CriterionStatus, BadgeVariant> = {
    covered: 'success',
    partial: 'warning',
    missing: 'danger',
    unclear: 'neutral',
  }
</script>

<div class="flex flex-col gap-5 px-6 py-5 overflow-y-auto">
  {#if !jiraConfigured}
    <div class="text-sm text-base-content/70">
      Jira is not connected. Add your site URL, email, and API token in Settings → GitHub Sync →
      Jira, then regenerate this walkthrough to compare the changes against their ticket.
    </div>
  {:else if !snapshot}
    <Panel variant="subtle">
      <div class="flex items-center justify-between gap-3 text-xs">
        <span class="text-base-content/70">
          This walkthrough was generated before Jira was connected, so no ticket was looked up.
        </span>
        <Button type="button" variant="secondary" size="xs" onclick={onRegenerate}>Regenerate</Button>
      </div>
    </Panel>
  {:else}
    {#if ticket}
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="font-mono"
            onclick={() => void onOpenUrl(ticket.url)}
            title="Open in Jira"
          >{ticket.issue_key}</Button>
          {#if ticket.issue_type}
            <span class="text-[0.7rem] uppercase tracking-wider text-base-content/50">{ticket.issue_type}</span>
          {/if}
          {#if ticket.status}
            <Badge>{ticket.status}</Badge>
          {/if}
        </div>
        <h4 class="text-sm font-semibold text-base-content m-0">{ticket.summary}</h4>
      </div>
    {/if}

    {#if snapshot.error}
      <Panel variant="subtle">
        <div class="flex items-center justify-between gap-3 text-xs text-error">
          <span>{snapshot.error}</span>
          <Button type="button" variant="danger" size="xs" onclick={onRegenerate}>Retry</Button>
        </div>
      </Panel>
    {/if}

    {#if coverage}
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <Badge variant={VERDICT_VARIANTS[coverage.verdict]}>
            {VERDICT_LABELS[coverage.verdict]}
          </Badge>
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
              <Badge variant={STATUS_VARIANTS[criterion.status]} class="mt-0.5 shrink-0">
                {STATUS_LABELS[criterion.status]}
              </Badge>
              <span class="text-sm text-base-content leading-snug flex-1">{criterion.text}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                class="gap-1 shrink-0 {includedFindingIds.has(criterion.id) ? 'text-success' : 'text-base-content/50'}"
                onclick={() => onToggleFinding(criterionFinding(criterion))}
                title={includedFindingIds.has(criterion.id) ? 'Remove from review' : 'Add to review'}
                aria-pressed={includedFindingIds.has(criterion.id)}
              >
                {#if includedFindingIds.has(criterion.id)}
                  <Check size={12} aria-hidden="true" /> Added
                {:else}
                  <Plus size={12} aria-hidden="true" /> Add to review
                {/if}
              </Button>
            </div>
            {#if criterion.notes}
              <p class="text-xs text-base-content/70 m-0 pl-1">{criterion.notes}</p>
            {/if}
            {#if criterion.evidence.length > 0}
              <div class="flex flex-wrap gap-1.5 pl-1">
                {#each criterion.evidence as evidence}
                  <Badge class="font-mono text-[0.7rem]" title={evidence.note ?? ''}>
                    {evidence.filename}
                  </Badge>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="gap-1 shrink-0 {includedFindingIds.has(`oos-${index}`) ? 'text-success' : 'text-base-content/50'}"
                    onclick={() => onToggleFinding(outOfScopeFinding(change, index))}
                    title={includedFindingIds.has(`oos-${index}`) ? 'Remove from review' : 'Add to review'}
                    aria-pressed={includedFindingIds.has(`oos-${index}`)}
                  >
                    {#if includedFindingIds.has(`oos-${index}`)}
                      <Check size={12} aria-hidden="true" /> Added
                    {:else}
                      <Plus size={12} aria-hidden="true" /> Add to review
                    {/if}
                  </Button>
                </div>
                {#if change.files.length > 0}
                  <div class="flex flex-wrap gap-1.5">
                    {#each change.files as filename}
                      <Badge class="font-mono text-[0.7rem]">{filename}</Badge>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {:else if ticket}
      <Panel variant="subtle">
        <div class="flex items-center justify-between gap-3 text-xs">
          <span class="text-base-content/70">
            The agent did not return a usable coverage assessment for this ticket.
          </span>
          <Button type="button" variant="secondary" size="xs" onclick={onRegenerate}>Regenerate</Button>
        </div>
      </Panel>
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
        <Panel>
          <div class="text-sm">
            <MarkdownContent content={ticket.acceptance_criteria} {onOpenUrl} />
          </div>
        </Panel>
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
      <div class="max-w-xs flex-1">
        <TextField
          label="Jira ticket key"
          placeholder="AVIV-304"
          class="font-mono"
          bind:value={issueKeyDraft}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter') { event.preventDefault(); submitIssueKey() }
          }}
        />
      </div>
      <Button type="button" variant="secondary" size="sm" onclick={submitIssueKey}>Set ticket</Button>
    </div>
  {/if}
</div>
