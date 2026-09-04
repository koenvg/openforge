<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type {
    AgentReviewComment,
    AiThread,
    PrFileDiff,
    PrWalkthroughStep,
    ReviewComment,
    ReviewPullRequest,
    ReviewSubmissionComment,
  } from '@openforge-app/plugin-sdk/domain'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { ChevronDown, ChevronUp, RefreshCw } from '@lucide/svelte'
  import { parseAndValidateWalkthroughSteps } from '../../lib/walkthroughParse'
  import {
    buildSyntheticStepFiles,
    buildWalkthroughStepList,
    clampStepIndex,
    isWalkthroughStale,
  } from '../../lib/walkthroughViewState'
  import {
    loadWalkthroughStepDetailsExpanded,
    saveWalkthroughStepDetailsExpanded,
  } from '../../lib/walkthroughPreferences'
  import TicketCoveragePanel from './TicketCoveragePanel.svelte'
  import WalkthroughAiQuestions from './WalkthroughAiQuestions.svelte'
  import WalkthroughDiffPresentation from './WalkthroughDiffPresentation.svelte'
  import WalkthroughStepNavigation from './WalkthroughStepNavigation.svelte'
  import type { GithubSyncPrReviewClient } from './githubSyncClient'
  import { useWalkthroughLifecycle } from './useWalkthroughLifecycle.svelte'
  import { useWalkthroughTicketCoverage } from './useWalkthroughTicketCoverage.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    githubSync: GithubSyncPrReviewClient
    pr: ReviewPullRequest
    files: PrFileDiff[]
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    resolveRepositoryImage: (repositoryPath: string) => Promise<string | null>
    projectId: string | null
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    agentComments: AgentReviewComment[]
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus: (commentId: number, status: 'approved' | 'dismissed' | 'pending') => Promise<void> | void
    onOpenUrl: (url: string) => void | Promise<void>
    aiThreads?: AiThread[]
    onAskAgent?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAboutComment?: (args: { commentId: number; filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => void
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
    }) => Promise<void>
  }

  let props: Props = $props()
  let activeStepIndex = $state(0)
  let stepDetailsExpanded = $state(loadWalkthroughStepDetailsExpanded())
  let loadTicket = (): Promise<void> => Promise.resolve()

  function resetNavigation(): void {
    activeStepIndex = 0
  }

  const lifecycle = useWalkthroughLifecycle({
    getApi: () => props.api,
    getGithubSync: () => props.githubSync,
    getPullRequest: () => props.pr,
    getProjectId: () => props.projectId,
    onReload: () => loadTicket(),
    onResetNavigation: resetNavigation,
  })

  const ticketCoverage = useWalkthroughTicketCoverage({
    getGithubSync: () => props.githubSync,
    getPullRequest: () => props.pr,
    getWalkthrough: () => lifecycle.walkthrough,
    getFiles: () => props.files,
  })
  loadTicket = ticketCoverage.load

  let aiThreads = $derived(props.aiThreads ?? [])
  let pendingReplies = $derived(props.pendingReplies ?? [])
  let parsedSteps = $derived<PrWalkthroughStep[] | null>(
    lifecycle.walkthrough?.status === 'ready'
      ? parseAndValidateWalkthroughSteps(lifecycle.walkthrough.steps_json, props.files)
      : null,
  )
  let stepEntries = $derived(parsedSteps ? buildWalkthroughStepList(parsedSteps) : [])
  let totalSteps = $derived(stepEntries.length)
  let clampedStepIndex = $derived(
    parsedSteps ? clampStepIndex(activeStepIndex, totalSteps) : 0,
  )
  let activeEntry = $derived(stepEntries[clampedStepIndex] ?? null)
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

  function toggleStepDetails(): void {
    stepDetailsExpanded = !stepDetailsExpanded
    saveWalkthroughStepDetailsExpanded(stepDetailsExpanded)
  }

  async function handleSetIssueKey(issueKey: string): Promise<void> {
    if (!(await ticketCoverage.setIssueKey(issueKey))) {
      lifecycle.reportError('Failed to set the Jira ticket.')
      return
    }
    await lifecycle.regenerate()
  }
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  {#if (lifecycle.isLoading || lifecycle.isStarting) && !lifecycle.walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading walkthrough…</span>
    </div>
  {:else if lifecycle.loadError}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{lifecycle.loadError}</span>
      <Button variant="ghost" size="sm" onclick={lifecycle.loadCached}>Retry</Button>
    </div>
  {:else if !lifecycle.walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-4 text-center p-8 max-w-xl mx-auto">
      <h3 class="text-lg font-semibold text-base-content m-0">Walk me through this PR</h3>
      <p class="text-sm text-base-content/60 m-0">
        Have an AI scan the {props.files.length} changed file{props.files.length === 1 ? '' : 's'} ({props.pr.additions + props.pr.deletions} lines) and break the change into ordered, concept-sized steps — as if the author had landed several small commits.
      </p>
      <Button size="sm" onclick={lifecycle.generate} disabled={lifecycle.isStarting || props.files.length === 0}>
        {lifecycle.isStarting ? 'Starting…' : 'Generate walkthrough'}
      </Button>
    </div>
  {:else if lifecycle.walkthrough.status === 'generating'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>The agent is reading the diff and assembling steps…</span>
      <div class="flex gap-2">
        <Button variant="ghost" size="xs" onclick={lifecycle.loadCached}>Refresh</Button>
        <Button variant="danger" size="xs" onclick={lifecycle.stop}>Stop</Button>
      </div>
    </div>
  {:else if lifecycle.walkthrough.status === 'error'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{lifecycle.walkthrough.error_message ?? 'The walkthrough failed.'}</span>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Try again</Button>
    </div>
  {:else if !parsedSteps || parsedSteps.length === 0}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm text-center p-5">
      <p class="m-0">The walkthrough was generated but couldn't be aligned with the current diff.</p>
      <Button variant="ghost" size="sm" onclick={lifecycle.regenerate}>Regenerate</Button>
    </div>
  {:else}
    {#if stale}
      <div class="flex items-center justify-between gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-xs">
        <span class="text-warning-content/80">
          A new commit landed since this walkthrough was generated. Showing the cached version.
        </span>
        <Button variant="secondary" size="xs" onclick={lifecycle.regenerate}>Regenerate</Button>
      </div>
    {/if}

    <WalkthroughStepNavigation entries={stepEntries} bind:activeStepIndex />

    <div class="flex items-start gap-2 px-4 {stepDetailsExpanded ? 'py-2.5' : 'py-1'} border-b border-base-300 shrink-0">
      <div class="flex flex-col gap-1.5 min-w-0 flex-1">
        <div class="flex items-baseline gap-2 min-w-0">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-primary tabular-nums shrink-0">Step {clampedStepIndex + 1}</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-base-content/40 shrink-0">of {totalSteps}</span>
          <h3 class="text-sm font-semibold text-base-content m-0 leading-snug min-w-0 {stepDetailsExpanded ? '' : 'truncate'}">{stepTitle}</h3>
        </div>

        <div class="flex flex-col gap-2 max-h-[28vh] overflow-y-auto pr-1 {stepDetailsExpanded ? '' : 'hidden'}">
          {#if stepDetailsExpanded && stepSummary}
            <p class="text-sm leading-relaxed text-base-content/80 m-0">{stepSummary}</p>
          {/if}
          <WalkthroughAiQuestions
            {activeStep}
            visible={stepDetailsExpanded}
            {aiThreads}
            onOpenUrl={props.onOpenUrl}
            onAskAgentStep={props.onAskAgentStep}
            onReplyToThread={props.onReplyToThread}
          />
        </div>
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        {#if !stale}
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
          onSetIssueKey={(issueKey) => { void handleSetIssueKey(issueKey) }}
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
        onPendingCommentsChange={props.onPendingCommentsChange}
        agentComments={props.agentComments}
        onAgentCommentsChange={props.onAgentCommentsChange}
        onUpdateAgentCommentStatus={props.onUpdateAgentCommentStatus}
        onOpenUrl={props.onOpenUrl}
        {aiThreads}
        onAskAgent={props.onAskAgent}
        onCommentNow={props.onCommentNow}
        onReplyToThread={props.onReplyToThread}
        onAskAboutComment={props.onAskAboutComment}
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
