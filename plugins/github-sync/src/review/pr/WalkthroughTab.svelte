<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type {
    AgentReviewComment,
    AiThread,
    PrFileDiff,
    PrWalkthrough,
    PrWalkthroughStep,
    ReviewComment,
    ReviewPullRequest,
    ReviewSubmissionComment,
  } from '@openforge-app/plugin-sdk/domain'
  import { parseAndValidateWalkthroughSteps } from '../../lib/walkthroughParse'
  import {
    buildSyntheticStepFiles,
    buildWalkthroughStepList,
    clampStepIndex,
    isWalkthroughStale,
    toggleCoverageFinding,
  } from '../../lib/walkthroughViewState'
  import { parseAndValidateTicketCoverage } from '../../lib/ticketCoverageParse'
  import type { CoverageFinding, TicketSnapshot } from '../../lib/ticketCoverage'
  import TicketCoveragePanel from './TicketCoveragePanel.svelte'
  import { isInputFocused } from '../../lib/domUtils'
  import { resolveWalkthroughGuidance } from '../../lib/walkthroughGuidance'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import { approvedInlineAgentComments, agentCommentToSubmission } from '@openforge-app/pr-review-ui/diffComments'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw } from '@lucide/svelte'
  import {
    loadWalkthroughStepDetailsExpanded,
    saveWalkthroughStepDetailsExpanded,
  } from '../../lib/walkthroughPreferences'
  import type { GithubSyncPrReviewClient } from './githubSyncClient'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'

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
    onEditThread?: (threadId: string, body: string) => void
    onDeleteThread?: (threadId: string) => void
    onSubmitReview: (request: {
      repoOwner: string
      repoName: string
      prNumber: number
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
      body: string
      comments: ReviewSubmissionComment[]
      commitId: string
    }) => Promise<void>
    // Requests the walkthrough jump to the step with this id (set by the questions panel).
    focusStepId?: string | null
  }

  let {
    api,
    githubSync,
    pr,
    files,
    fetchFileContents,
    resolveRepositoryImage,
    projectId,
    existingComments,
    pendingComments,
    onPendingCommentsChange,
    agentComments,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onOpenUrl,
    aiThreads = [],
    onAskAgent,
    onCommentNow,
    onReplyToThread,
    onAskAboutComment,
    onReplyToExistingComment,
    pendingReplies = [],
    onAddReplyToReview,
    onRemovePendingReply,
    onAskAgentStep,
    onEditThread,
    onDeleteThread,
    onSubmitReview,
    focusStepId = null,
  }: Props = $props()

  // Approved AI review comments submit with the review directly (mirrors the Files
  // tab); map them to submission shape and clear them after a successful submit.
  let approvedAgentSubmissionComments = $derived(
    approvedInlineAgentComments(agentComments).map(agentCommentToSubmission),
  )

  function handleApprovedAgentCommentsSubmitted() {
    const submitted = approvedInlineAgentComments(agentComments)
    if (submitted.length === 0) return
    const submittedIds = new Set(submitted.map(comment => comment.id))
    for (const comment of submitted) void onUpdateAgentCommentStatus(comment.id, 'dismissed')
    onAgentCommentsChange(
      agentComments.map(comment =>
        submittedIds.has(comment.id) ? { ...comment, status: 'dismissed' } : comment,
      ),
    )
  }

  let walkthrough = $state<PrWalkthrough | null>(null)
  let isLoading = $state(false)
  let isStarting = $state(false)
  let loadError = $state<string | null>(null)
  let activeStepIndex = $state(0)
  let activeStepFilename = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let stepDetailsExpanded = $state(loadWalkthroughStepDetailsExpanded())

  function toggleStepDetails() {
    stepDetailsExpanded = !stepDetailsExpanded
    saveWalkthroughStepDetailsExpanded(stepDetailsExpanded)
  }

  /** Rail pill styling: the current step reads as filled, visited steps as muted-solid, upcoming as faint. */
  function stepPillClass(isCurrent: boolean, isVisited: boolean): string {
    if (isCurrent) return 'bg-primary text-primary-content'
    if (isVisited) return 'bg-base-content/20 text-base-content/70 hover:bg-base-content/30'
    return 'bg-base-300/60 text-base-content/50 hover:bg-base-300'
  }

  let parsedSteps = $derived<PrWalkthroughStep[] | null>(
    walkthrough?.status === 'ready'
      ? parseAndValidateWalkthroughSteps(walkthrough.steps_json, files)
      : null,
  )

  let stale = $derived(isWalkthroughStale(walkthrough, pr))

  let isGenerating = $derived(walkthrough?.status === 'generating')

  // Jira ticket + gap analysis. The ticket step exists whenever Jira is
  // configured — an unresolved or failed ticket still needs somewhere to render
  // its key input and retry.
  let ticketSnapshot = $state<TicketSnapshot | null>(null)
  let jiraConfigured = $state(false)

  let ticketCoverage = $derived(
    walkthrough?.status === 'ready'
      ? parseAndValidateTicketCoverage(walkthrough.steps_json, files)
      : null,
  )

  // Ticket-coverage findings the reviewer flagged to fold into the review body.
  // Session-only: not persisted, cleared once they've been submitted.
  let includedCoverageFindings = $state<CoverageFinding[]>([])
  let includedFindingIds = $derived(new Set(includedCoverageFindings.map(f => f.id)))

  function handleToggleFinding(finding: CoverageFinding) {
    includedCoverageFindings = toggleCoverageFinding(includedCoverageFindings, finding)
  }

  function handleRemoveIncludedFinding(id: string) {
    includedCoverageFindings = includedCoverageFindings.filter(f => f.id !== id)
  }

  function handleIncludedFindingsSubmitted() {
    includedCoverageFindings = []
  }

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

  // Step-anchored "Ask the AI author" threads for the current step.
  let activeStepThreads = $derived.by(() => {
    const step = activeStep
    if (!step) return []
    return aiThreads.filter(t => t.anchor.type === 'step' && t.anchor.step_id === step.id)
  })
  let stepQuestionOpen = $state(false)
  let stepQuestionText = $state('')
  let stepReplyDrafts = $state<Record<string, string>>({})
  let editingThreadId = $state<string | null>(null)
  let editText = $state('')

  // An unsent question or reply: the latest message is still the reviewer's and it
  // hasn't been dispatched. These are the only threads that can be edited or deleted.
  function isUnsentThread(thread: AiThread): boolean {
    return thread.status !== 'pending' && thread.messages.at(-1)?.role === 'user'
  }
  // While a step has an unsent draft, "Ask about this step" hides so the reviewer
  // refines that draft instead of stacking a second unsent question.
  let hasUnsentStepDraft = $derived(activeStepThreads.some(isUnsentThread))

  function startEditThread(thread: AiThread) {
    editingThreadId = thread.id
    editText = thread.messages.at(-1)?.body ?? ''
  }
  function saveEditThread() {
    const id = editingThreadId
    const text = editText.trim()
    if (!id || !text) return
    onEditThread?.(id, text)
    editingThreadId = null
    editText = ''
  }
  function cancelEditThread() {
    editingThreadId = null
    editText = ''
  }
  function handleDeleteThread(threadId: string) {
    if (editingThreadId === threadId) cancelEditThread()
    onDeleteThread?.(threadId)
  }

  function submitStepQuestion() {
    const text = stepQuestionText.trim()
    const step = activeStep
    if (!text || !step) return
    onAskAgentStep?.(step.id, text)
    stepQuestionText = ''
    stepQuestionOpen = false
  }

  function submitStepReply(threadId: string) {
    const text = (stepReplyDrafts[threadId] ?? '').trim()
    if (!text) return
    onReplyToThread?.(threadId, text)
    const next = { ...stepReplyDrafts }
    delete next[threadId]
    stepReplyDrafts = next
  }

  // The final step shows every file; a per-concept step shows only its hunks.
  // The ticket step renders its own panel instead of the diff, so it needs none.
  let stepFiles = $derived<PrFileDiff[]>(
    isFinalStep ? files : activeStep ? buildSyntheticStepFiles(files, activeStep) : [],
  )

  let stepTitle = $derived(
    isTicketStep ? 'Ticket coverage' : isFinalStep ? 'Review & submit' : activeStep?.title ?? '',
  )
  let stepSummary = $derived(
    isTicketStep
      ? 'Check the changes against the ticket before you read them.'
      : isFinalStep
        ? 'Review every change together, then submit your review.'
        : activeStep?.summary ?? '',
  )

  $effect(() => {
    if (!stepFiles.length) {
      activeStepFilename = null
      return
    }
    if (!activeStepFilename || !stepFiles.some(f => f.filename === activeStepFilename)) {
      activeStepFilename = stepFiles[0].filename
    }
  })

  let lastLoadedKey = ''
  $effect(() => {
    const key = `${pr.id}:${pr.head_sha}`
    if (key === lastLoadedKey) return
    lastLoadedKey = key
    activeStepIndex = 0
    activeStepFilename = null
    void initWalkthrough()
  })

  // When the questions panel asks to jump to a step-anchored thread, select that
  // step. Applied once per distinct requested id, so manual Prev/Next navigation
  // is never yanked back; a remount (leaving and re-entering the tab) re-applies
  // it because this guard resets with the component.
  let lastFocusedStepId: string | null = null
  $effect(() => {
    const id = focusStepId
    const steps = parsedSteps
    if (!id || !steps || id === lastFocusedStepId) return
    const conceptIndex = steps.findIndex(s => s.id === id)
    if (conceptIndex === -1) return
    lastFocusedStepId = id
    // Step entries are [ticket, ...concepts, submit]; the ticket occupies index 0.
    activeStepIndex = clampStepIndex(conceptIndex + 1, totalSteps)
  })

  // Generation is now triggered explicitly from the PR card (see PrReviewView /
  // PrReviewListSection), so the tab only loads whatever has already been
  // generated for this (pr, head_sha) — it never auto-kicks generation on open.
  async function initWalkthrough() {
    await loadCachedWalkthrough()
  }

  // While generation is in flight, poll the cache until the backend flips the
  // row to ready/error. Keyed on the derived boolean so the interval is created
  // once when generation starts and torn down when it finishes (or the tab is
  // destroyed) — not recreated on every poll.
  $effect(() => {
    if (!isGenerating) return
    const interval = setInterval(() => {
      void loadCachedWalkthrough()
    }, 2500)
    return () => clearInterval(interval)
  })

  async function loadCachedWalkthrough() {
    isLoading = true
    loadError = null
    try {
      walkthrough = await githubSync.getPrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to load cached walkthrough:', e)
      loadError = 'Failed to load walkthrough.'
    } finally {
      isLoading = false
    }
    await loadTicket()
    return walkthrough
  }

  /**
   * The ticket snapshot is written by the backend during generation, so it is
   * reloaded alongside the walkthrough. A failure here is not surfaced: the
   * walkthrough itself is still worth reading.
   */
  async function loadTicket() {
    try {
      const result = await githubSync.getPrTicket({ reviewPrId: pr.id, headSha: pr.head_sha })
      ticketSnapshot = result?.snapshot ?? null
      jiraConfigured = result?.jiraConfigured ?? false
    } catch (e) {
      console.error('[WalkthroughTab] Failed to load the Jira ticket:', e)
      ticketSnapshot = null
      jiraConfigured = false
    }
  }

  /** Set the ticket for this PR, then regenerate so the analysis uses it. */
  async function handleSetIssueKey(issueKey: string) {
    try {
      await githubSync.setPrJiraKey({ reviewPrId: pr.id, issueKey })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to set the Jira ticket key:', e)
      loadError = 'Failed to set the Jira ticket.'
      return
    }
    await handleRegenerate()
  }

  async function handleGenerate() {
    if (isStarting) return
    isStarting = true
    loadError = null
    try {
      // The prompt is compiled server-side (backend fetches the diffs and runs the
      // repo-aware agent). All this side supplies is the two guidance settings,
      // resolved the same way as on the list card so both entry points honour them.
      const { reviewGuidance, walkthroughGuidance } = await resolveWalkthroughGuidance(api, projectId)
      const { walkthrough_session_key } = await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner,
        repoName: pr.repo_name,
        prNumber: pr.number,
        headRef: pr.head_ref,
        baseRef: pr.base_ref,
        prTitle: pr.title,
        prBody: pr.body,
        headSha: pr.head_sha,
        reviewPrId: pr.id,
        projectId,
        reviewGuidance,
        walkthroughGuidance,
      })
      walkthrough = {
        pr_id: pr.id,
        head_sha: pr.head_sha,
        // Keep the key from the start call so Stop works right away, without
        // waiting for the first poll to read it back from storage.
        walkthrough_session_key,
        status: 'generating',
        steps_json: null,
        error_message: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      }
    } catch (e) {
      console.error('[WalkthroughTab] Failed to start agent walkthrough:', e)
      loadError = 'Could not start the AI walkthrough. The agent backend may be unavailable.'
    } finally {
      isStarting = false
    }
  }

  async function handleStop() {
    const sessionKey = walkthrough?.walkthrough_session_key
    if (sessionKey) {
      try {
        await githubSync.abortAgentWalkthrough({ walkthroughSessionKey: sessionKey })
      } catch (e) {
        console.error('[WalkthroughTab] Failed to stop walkthrough:', e)
      }
    }
    // Drop the stopped run so the tab reverts to the idle "Generate" state,
    // ready for a rerun with changed instructions, instead of the error screen
    // the killed run would otherwise persist. The store's session guard keeps
    // that run from rewriting the row once it is deleted.
    try {
      await githubSync.deletePrWalkthrough({
        reviewPrId: pr.id,
        headSha: walkthrough?.head_sha ?? pr.head_sha,
      })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to clear the stopped walkthrough:', e)
    }
    walkthrough = null
    activeStepIndex = 0
    activeStepFilename = null
  }

  async function handleRegenerate() {
    try {
      await githubSync.deletePrWalkthrough({
        reviewPrId: pr.id,
        headSha: walkthrough?.head_sha ?? pr.head_sha,
      })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to delete previous walkthrough:', e)
    }
    walkthrough = null
    activeStepIndex = 0
    activeStepFilename = null
    await handleGenerate()
  }

  function goPrev() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex - 1, totalSteps)
  }

  function goNext() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex + 1, totalSteps)
  }

  function selectStep(index: number) {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(index, totalSteps)
  }

  function handleFileSelect(filename: string) {
    activeStepFilename = filename
    diffViewer?.scrollToFile(filename)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (!parsedSteps || parsedSteps.length === 0) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goPrev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goNext()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  {#if (isLoading || isStarting) && !walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading walkthrough…</span>
    </div>
  {:else if loadError}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{loadError}</span>
      <Button variant="ghost" size="sm" onclick={loadCachedWalkthrough}>Retry</Button>
    </div>
  {:else if !walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-4 text-center p-8 max-w-xl mx-auto">
      <h3 class="text-lg font-semibold text-base-content m-0">Walk me through this PR</h3>
      <p class="text-sm text-base-content/60 m-0">
        Have an AI scan the {files.length} changed file{files.length === 1 ? '' : 's'} ({pr.additions + pr.deletions} lines) and break the change into ordered, concept-sized steps — as if the author had landed several small commits.
      </p>
      <Button size="sm" onclick={handleGenerate} disabled={isStarting || files.length === 0}>
        {isStarting ? 'Starting…' : 'Generate walkthrough'}
      </Button>
    </div>
  {:else if walkthrough.status === 'generating'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>The agent is reading the diff and assembling steps…</span>
      <div class="flex gap-2">
        <Button variant="ghost" size="xs" onclick={loadCachedWalkthrough}>Refresh</Button>
        <Button variant="danger" size="xs" onclick={handleStop}>Stop</Button>
      </div>
    </div>
  {:else if walkthrough.status === 'error'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{walkthrough.error_message ?? 'The walkthrough failed.'}</span>
      <Button variant="ghost" size="sm" onclick={handleRegenerate}>Try again</Button>
    </div>
  {:else if !parsedSteps || parsedSteps.length === 0}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm text-center p-5">
      <p class="m-0">The walkthrough was generated but couldn't be aligned with the current diff.</p>
      <Button variant="ghost" size="sm" onclick={handleRegenerate}>Regenerate</Button>
    </div>
  {:else}
    {#if stale}
      <div class="flex items-center justify-between gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-xs">
        <span class="text-warning-content/80">
          A new commit landed since this walkthrough was generated. Showing the cached version.
        </span>
        <Button variant="secondary" size="xs" onclick={handleRegenerate}>Regenerate</Button>
      </div>
    {/if}

    <!-- Step navigation. Prev/Next are the reviewer's primary control, so they are
         full-size buttons flanking the step rail instead of ghost text in a corner. -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-200/40 shrink-0">
      <Button
        variant="outline"
        size="sm"
        class="gap-1 shrink-0"
        onclick={goPrev}
        disabled={clampedStepIndex <= 0}
        title="Previous step (←)"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Prev
      </Button>

      <div class="flex items-center justify-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {#each stepEntries as entry, i}
          <button
            type="button"
            class="size-6 shrink-0 rounded-full text-[11px] font-semibold tabular-nums transition-colors {stepPillClass(i === clampedStepIndex, i < clampedStepIndex)}"
            onclick={() => selectStep(i)}
            title={entry.kind === 'ticket'
              ? 'Ticket coverage'
              : entry.kind === 'submit'
                ? 'Review & submit'
                : entry.step.title}
            aria-current={i === clampedStepIndex ? 'step' : undefined}
          >{i + 1}</button>
        {/each}
      </div>

      <Button
        size="sm"
        class="gap-1 shrink-0"
        onclick={goNext}
        disabled={clampedStepIndex >= totalSteps - 1}
        title="Next step (→)"
      >
        Next
        <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </div>

    <!-- Step details. Collapsible: the summary and Q&A threads are the only thing
         between the nav rail and the diff, so hiding them hands that height back. -->
    <div class="flex items-start gap-2 px-4 {stepDetailsExpanded ? 'py-2.5' : 'py-1'} border-b border-base-300 shrink-0">
      <div class="flex flex-col gap-1.5 min-w-0 flex-1">
        <div class="flex items-baseline gap-2 min-w-0">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-primary tabular-nums shrink-0">Step {clampedStepIndex + 1}</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-base-content/40 shrink-0">of {totalSteps}</span>
          <h3 class="text-sm font-semibold text-base-content m-0 leading-snug min-w-0 {stepDetailsExpanded ? '' : 'truncate'}">{stepTitle}</h3>
        </div>

        {#if stepDetailsExpanded}
          <div class="flex flex-col gap-2 max-h-[28vh] overflow-y-auto pr-1">
            {#if stepSummary}
              <p class="text-sm leading-relaxed text-base-content/80 m-0">{stepSummary}</p>
            {/if}

            {#if activeStep && onAskAgentStep}
              <div class="flex flex-col gap-2">
                {#each activeStepThreads as thread}
                  <Panel class="border-l-4 border-l-info text-[0.8rem]">
                    <div class="flex items-center gap-2 mb-1">
                      <Badge variant="info">Ask the AI</Badge>
                      {#if thread.status === 'pending'}
                        <span class="loading loading-spinner loading-xs"></span>
                        <span class="text-base-content/50 text-[0.7rem]">thinking…</span>
                      {/if}
                      {#if thread.status === 'error'}
                        <span class="text-error text-[0.7rem]">failed — send again</span>
                      {/if}
                    </div>
                    {#if editingThreadId === thread.id}
                      <Textarea
                        label="Edit your question"
                        rows={2}
                        class="min-h-[44px] w-full resize-y text-[0.8rem]"
                        bind:value={editText}
                        onkeydown={(event: KeyboardEvent) => {
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault()
                            saveEditThread()
                          }
                        }}
                      />
                      <div class="flex justify-end gap-2 mt-1">
                        <Button type="button" variant="ghost" size="xs" onclick={cancelEditThread}>Cancel</Button>
                        <Button type="button" size="xs" onclick={saveEditThread}>Save</Button>
                      </div>
                    {:else}
                      {#each thread.messages as message}
                        <div class="mb-1">
                          <span class="text-base-content/50 text-[0.7rem] mr-1 {message.role === 'user' ? 'font-semibold' : ''}">{message.role === 'ai' ? 'AI author' : 'You'}</span>
                          <span class="[&_p]:m-0 [&_p]:inline"><MarkdownContent content={message.body} {onOpenUrl} /></span>
                        </div>
                      {/each}
                      {#if isUnsentThread(thread)}
                        <div class="flex gap-2 mt-1">
                          <Button type="button" variant="ghost" size="xs" onclick={() => startEditThread(thread)}>Edit</Button>
                          {#if thread.messages.length === 1}
                            <!-- Only a never-sent question can be deleted; a thread with an AI answer keeps its history. -->
                            <Button type="button" variant="ghost" size="xs" class="text-error" onclick={() => handleDeleteThread(thread.id)}>Delete</Button>
                          {/if}
                        </div>
                      {/if}
                      {#if thread.status === 'answered'}
                        <div class="mt-1 flex items-end gap-2">
                          <div class="min-w-0 flex-1">
                            <TextField
                              label="Reply to the AI author"
                              placeholder="Reply…"
                              value={stepReplyDrafts[thread.id] ?? ''}
                              onValueChange={(value) => {
                                stepReplyDrafts = { ...stepReplyDrafts, [thread.id]: value }
                              }}
                              onkeydown={(event: KeyboardEvent) => {
                                if (event.key === 'Enter') { event.preventDefault(); submitStepReply(thread.id) }
                              }}
                            />
                          </div>
                          <Button type="button" size="xs" onclick={() => submitStepReply(thread.id)}>Reply</Button>
                        </div>
                      {/if}
                    {/if}
                  </Panel>
                {/each}

                {#if hasUnsentStepDraft}
                  <!-- An unsent draft already exists on this step; edit it above instead of stacking another. -->
                {:else if stepQuestionOpen}
                  <div>
                    <Textarea
                      label="Ask the AI author about this step"
                      placeholder="Ask the AI author about this step… (Cmd/Ctrl+Enter to send)"
                      rows={2}
                      class="min-h-[44px] w-full resize-y text-[0.8rem]"
                      bind:value={stepQuestionText}
                      onkeydown={(event: KeyboardEvent) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          submitStepQuestion()
                        }
                      }}
                    />
                    <div class="flex justify-end gap-2 mt-1">
                      <Button type="button" variant="ghost" size="xs" onclick={() => { stepQuestionOpen = false; stepQuestionText = '' }}>Cancel</Button>
                      <Button type="button" size="xs" onclick={submitStepQuestion}>Ask</Button>
                    </div>
                  </div>
                {:else}
                  <Button type="button" variant="ghost" size="xs" class="self-start text-info" onclick={() => { stepQuestionOpen = true }}>+ Ask about this step</Button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        {#if !stale}
          <IconButton
            variant="ghost"
            size="xs"
            class="text-base-content/40"
            onclick={handleRegenerate}
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
          snapshot={ticketSnapshot}
          coverage={ticketCoverage}
          {jiraConfigured}
          {includedFindingIds}
          {onOpenUrl}
          onSetIssueKey={(issueKey) => { void handleSetIssueKey(issueKey) }}
          onRegenerate={handleRegenerate}
          onToggleFinding={handleToggleFinding}
        />
      </div>
    {:else}
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <ResizablePanel storageKey="walkthrough-file-tree" defaultWidth={220} minWidth={140} maxWidth={460} side="left">
        <FileTree files={stepFiles} onSelectFile={handleFileSelect} />
      </ResizablePanel>
      <div class="flex-1 min-w-0 overflow-hidden">
        <DiffViewer
          bind:this={diffViewer}
          files={stepFiles}
          existingComments={existingComments}
          repoOwner={pr.repo_owner}
          repoName={pr.repo_name}
          headSha={pr.head_sha}
          fileTreeVisible={false}
          {fetchFileContents}
          {resolveRepositoryImage}
          agentComments={agentComments}
          pendingComments={pendingComments}
          onPendingCommentsChange={onPendingCommentsChange}
          onAgentCommentsChange={onAgentCommentsChange}
          onUpdateAgentCommentStatus={onUpdateAgentCommentStatus}
          onOpenUrl={onOpenUrl}
          aiThreads={aiThreads}
          onAskAgent={onAskAgent}
          onCommentNow={onCommentNow}
          onReplyToThread={onReplyToThread}
          onAskAboutComment={onAskAboutComment}
          onReplyToExistingComment={onReplyToExistingComment}
          pendingReplies={pendingReplies}
          onAddReplyToReview={onAddReplyToReview}
          onRemovePendingReply={onRemovePendingReply}
        >
          {#snippet footer()}
            {#if isFinalStep}
              <ReviewSubmitPanel
                repoOwner={pr.repo_owner}
                repoName={pr.repo_name}
                prNumber={pr.number}
                commitId={pr.head_sha}
                pendingComments={pendingComments}
                approvedAgentComments={approvedAgentSubmissionComments}
                pendingReplyCount={pendingReplies.length}
                includedFindings={includedCoverageFindings}
                onPendingCommentsChange={onPendingCommentsChange}
                onApprovedAgentCommentsSubmitted={handleApprovedAgentCommentsSubmitted}
                onRemoveIncludedFinding={handleRemoveIncludedFinding}
                onIncludedFindingsSubmitted={handleIncludedFindingsSubmitted}
                onSubmitReview={onSubmitReview}
              />
            {/if}
          {/snippet}
        </DiffViewer>
      </div>
    </div>
    {/if}
  {/if}
</div>
