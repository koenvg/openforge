<script lang="ts">
  import type { WalkthroughReview } from './reviewWorkspace.svelte'
  import type { ReviewThread, ReviewThreadSide, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import type { PrFileDiff, PrWalkthroughStep, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { ChevronDown, ChevronUp, RefreshCw } from '@lucide/svelte'
  import { buildSyntheticStepFiles, isWalkthroughStale } from '../../lib/walkthroughViewState'
  import {
    loadWalkthroughStepDetailsExpanded,
    saveWalkthroughStepDetailsExpanded,
  } from '../../lib/walkthroughPreferences'
  import TicketCoveragePanel from './TicketCoveragePanel.svelte'
  import WalkthroughAiQuestions from './WalkthroughAiQuestions.svelte'
  import WalkthroughDiffPresentation from './WalkthroughDiffPresentation.svelte'
  import WalkthroughStepNavigation from './WalkthroughStepNavigation.svelte'

  interface Props {
    workspace: WalkthroughReview
    pr: ReviewPullRequest
    files: PrFileDiff[]
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    resolveRepositoryImage: (repositoryPath: string) => Promise<string | null>
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    pendingCommentsToReview?: ReviewSubmissionComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onOpenUrl: (url: string) => void | Promise<void>
    reviewThreads?: ReviewThread[]
    reviewFollowUpUnavailableReason?: string | null
    onCreateReviewThread?: (filePath: string, line: number, side: ReviewThreadSide, body: string) => void
    onReplyToReviewThread?: (threadId: string, body: string) => void
    onSetReviewThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onMarkReviewThreadSeen?: (threadId: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    pendingReplies?: { commentId: number; body: string }[]
    onAddReplyToReview?: (commentId: number, body: string) => void
    onRemovePendingReply?: (commentId: number) => void
    onAskAgentStep?: (stepId: string, body: string) => void
    onSubmitReview: (request: {
      repoOwner: string
      repoName: string
      prNumber: number
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
      body: string
      comments: ReviewSubmissionComment[]
      commitId: string
    }, submittedReviewThreadIds?: string[]) => Promise<void>
    // Requests the walkthrough jump to the step with this id (set by the questions panel).
    focusStepId?: string | null
  }

  let props: Props = $props()
  let stepDetailsExpanded = $state(loadWalkthroughStepDetailsExpanded())
  let lifecycle = $derived(props.workspace)
  let ticketCoverage = $derived(props.workspace.ticketCoverage)

  let pendingReplies = $derived(props.pendingReplies ?? [])
  let stepEntries = $derived(lifecycle.stepEntries)
  let totalSteps = $derived(stepEntries.length)
  let activeStepIndex = $derived(lifecycle.activeStepIndex)
  let activeEntry = $derived(stepEntries[activeStepIndex] ?? null)
  let isFinalStep = $derived(activeEntry?.kind === 'submit')
  let isTicketStep = $derived(activeEntry?.kind === 'ticket')
  let activeStep = $derived<PrWalkthroughStep | null>(
    activeEntry?.kind === 'concept' ? activeEntry.step : null,
  )
  let stepFiles = $derived<PrFileDiff[]>(
    isFinalStep
      ? props.files
      : activeStep
        ? buildSyntheticStepFiles(props.files, activeStep)
        : [],
  )
  let stepTitle = $derived(
    isTicketStep
      ? 'Ticket coverage'
      : isFinalStep
        ? 'Review & submit'
        : activeStep?.title ?? '',
  )
  let stepSummary = $derived(
    isTicketStep
      ? 'Check the changes against the ticket before you read them.'
      : isFinalStep
        ? 'Review every change together, then submit your review.'
        : activeStep?.summary ?? '',
  )
  let stale = $derived(isWalkthroughStale(lifecycle.walkthrough, props.pr))
  // A thread anchored outside this step's slice belongs to another step, not to
  // this step's orphan report.
  let stepFilenames = $derived(new Set(stepFiles.map(file => file.filename)))
  let stepReviewThreads = $derived((props.reviewThreads ?? []).filter(thread =>
    thread.anchor.kind === 'line' && stepFilenames.has(thread.anchor.filePath)))

  // When the questions panel asks to jump to a step-anchored thread, select that
  // step. Applied once per distinct requested id, so manual Prev/Next navigation
  // is never yanked back; a remount (leaving and re-entering the tab) re-applies
  // it because this guard resets with the component.
  let lastFocusedStepId: string | null = null
  $effect(() => {
    const id = props.focusStepId
    const steps = lifecycle.steps
    if (!id || !steps || id === lastFocusedStepId) return
    const conceptIndex = steps.findIndex(s => s.id === id)
    if (conceptIndex === -1) return
    lastFocusedStepId = id
    lifecycle.activeStepIndex = conceptIndex + (lifecycle.ready ? 1 : 0)
  })

  function toggleStepDetails(): void {
    stepDetailsExpanded = !stepDetailsExpanded
    saveWalkthroughStepDetailsExpanded(stepDetailsExpanded)
  }

</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  {#if lifecycle.view === 'loading'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading walkthrough…</span>
    </div>
  {:else if lifecycle.view === 'loadError'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{lifecycle.loadError}</span>
      <Button variant="ghost" size="sm" onclick={lifecycle.loadCached}>Retry</Button>
    </div>
  {:else if lifecycle.view === 'absent'}
    <div class="flex flex-col items-center justify-center flex-1 gap-4 text-center p-8 max-w-xl mx-auto">
      <h3 class="text-lg font-semibold text-base-content m-0">Walk me through this PR</h3>
      <p class="text-sm text-base-content/60 m-0">
        Have an AI scan the {props.files.length} changed file{props.files.length === 1 ? '' : 's'} ({props.pr.additions + props.pr.deletions} lines) and break the change into ordered, concept-sized steps, as if the author had landed several small commits.
      </p>
      <Button size="sm" onclick={lifecycle.generate} disabled={lifecycle.isStarting || props.files.length === 0}>
        {lifecycle.isStarting ? 'Starting…' : 'Generate walkthrough'}
      </Button>
    </div>
  {:else if lifecycle.view === 'generating'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>The agent is reading the diff and assembling steps…</span>
      <div class="flex gap-2">
        <Button variant="ghost" size="xs" onclick={lifecycle.loadCached}>Refresh</Button>
        <Button variant="danger" size="xs" onclick={lifecycle.stop}>Stop</Button>
      </div>
    </div>
  {:else if lifecycle.view === 'failed'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{lifecycle.walkthrough?.error?.message ?? 'The walkthrough failed.'}</span>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Try again</Button>
    </div>
  {:else if lifecycle.view === 'no-submissions'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/70 text-sm text-center p-5">
      <p class="m-0">The agent finished without submitting a walkthrough.</p>
      <p class="m-0">Try again and watch the Agent tab for rejected step submissions.</p>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Generate again</Button>
    </div>
  {:else if lifecycle.view === 'aborted'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/70 text-sm text-center p-5">
      <p class="m-0">Walkthrough generation was stopped.</p>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Generate again</Button>
    </div>
  {:else if lifecycle.view === 'unaligned'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm text-center p-5">
      <p class="m-0">The walkthrough was generated but couldn't be aligned with the current diff.</p>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Regenerate</Button>
    </div>
  {:else}
    {#if lifecycle.view === 'provisional'}
      <div class="flex items-center justify-between gap-3 px-4 py-2 bg-info/10 border-b border-info/30 text-xs" role="status" aria-live="polite" aria-atomic="true">
        <span>
          {#if lifecycle.walkthrough?.state === 'generating'}
            {lifecycle.steps?.length ?? 0} accepted step{lifecycle.steps?.length === 1 ? '' : 's'} so far. These steps remain provisional until the agent finishes.
          {:else}
            {lifecycle.walkthrough?.error?.message ?? `Generation ended ${lifecycle.walkthrough?.state}.`} Accepted steps remain provisional.
          {/if}
        </span>
        {#if lifecycle.walkthrough?.state === 'generating'}
          <Button variant="danger" size="xs" onclick={lifecycle.stop}>Stop</Button>
        {:else}
          <Button variant="ghost" size="xs" onclick={lifecycle.regenerate}>Generate again</Button>
        {/if}
      </div>
    {/if}
    {#if stale}
      <div class="flex items-center justify-between gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-xs">
        <span class="text-warning-content/80">
          A new commit landed since this walkthrough was generated. Showing the cached version.
        </span>
        <Button variant="secondary" size="xs" onclick={lifecycle.regenerate}>Regenerate</Button>
      </div>
    {/if}

    <WalkthroughStepNavigation entries={stepEntries} bind:activeStepIndex={lifecycle.activeStepIndex} />

    <div class="flex items-start gap-2 px-4 {stepDetailsExpanded ? 'py-2.5' : 'py-1'} border-b border-base-300 shrink-0">
      <div class="flex flex-col gap-1.5 min-w-0 flex-1">
        <div class="flex items-baseline gap-2 min-w-0">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-primary tabular-nums shrink-0">Step {activeStepIndex + 1}</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-base-content/40 shrink-0">of {totalSteps}</span>
          <h3 class="text-sm font-semibold text-base-content m-0 leading-snug min-w-0 {stepDetailsExpanded ? '' : 'truncate'}">{stepTitle}</h3>
        </div>

        <div class="flex flex-col gap-2 max-h-[28vh] overflow-y-auto pr-1 {stepDetailsExpanded ? '' : 'hidden'}">
          {#if stepDetailsExpanded && stepSummary}
            <p class="text-sm leading-relaxed text-base-content/80 m-0">{stepSummary}</p>
          {/if}
          {#if lifecycle.ready}
            <WalkthroughAiQuestions
              {activeStep}
              visible={stepDetailsExpanded}
              reviewThreads={props.reviewThreads ?? []}
              onOpenUrl={props.onOpenUrl}
              unavailableReason={props.reviewFollowUpUnavailableReason}
              onAskAgentStep={props.onAskAgentStep}
              onReplyToThread={props.onReplyToReviewThread}
              onMarkThreadSeen={props.onMarkReviewThreadSeen}
            />
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        {#if lifecycle.ready && !stale}
          <IconButton
            variant="ghost"
            size="xs"
            class="text-base-content/40"
            onclick={lifecycle.regenerate}
            title="Regenerate walkthrough"
            label="Regenerate walkthrough"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </IconButton>
        {/if}
        <IconButton
          variant="ghost"
          size="xs"
          class="text-base-content/50"
          onclick={toggleStepDetails}
          title={stepDetailsExpanded ? 'Collapse step details' : 'Expand step details'}
          label={stepDetailsExpanded ? 'Collapse step details' : 'Expand step details'}
          aria-expanded={stepDetailsExpanded}
        >
          {#if stepDetailsExpanded}
            <ChevronUp size={14} aria-hidden="true" />
          {:else}
            <ChevronDown size={14} aria-hidden="true" />
          {/if}
        </IconButton>
      </div>
    </div>

    {#if isTicketStep}
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <TicketCoveragePanel
          snapshot={ticketCoverage.snapshot}
          coverage={ticketCoverage.coverage}
          jiraConfigured={ticketCoverage.jiraConfigured}
          includedFindingIds={ticketCoverage.includedFindingIds}
          onOpenUrl={props.onOpenUrl}
          onSetIssueKey={lifecycle.setIssueKey}
          onRegenerate={lifecycle.regenerate}
          onToggleFinding={ticketCoverage.toggleFinding}
        />
      </div>
    {:else}
      <WalkthroughDiffPresentation
        pr={props.pr}
        files={stepFiles}
        {isFinalStep}
        fetchFileContents={props.fetchFileContents}
        resolveRepositoryImage={props.resolveRepositoryImage}
        existingComments={props.existingComments}
        pendingComments={props.pendingComments}
        pendingCommentsToReview={props.pendingCommentsToReview}
        onPendingCommentsChange={props.onPendingCommentsChange}
        onOpenUrl={props.onOpenUrl}
        reviewThreads={stepReviewThreads}
        onCreateReviewThread={props.onCreateReviewThread}
        onReplyToReviewThread={props.onReplyToReviewThread}
        onSetReviewThreadStatus={props.onSetReviewThreadStatus}
        onMarkReviewThreadSeen={props.onMarkReviewThreadSeen}
        onCommentNow={props.onCommentNow}
        onReplyToExistingComment={props.onReplyToExistingComment}
        {pendingReplies}
        onAddReplyToReview={props.onAddReplyToReview}
        onRemovePendingReply={props.onRemovePendingReply}
        includedCoverageFindings={ticketCoverage.includedFindings}
        onRemoveIncludedFinding={ticketCoverage.removeIncludedFinding}
        onIncludedFindingsSubmitted={ticketCoverage.clearIncludedFindings}
        onSubmitReview={props.onSubmitReview}
      />
    {/if}
  {/if}
</div>
