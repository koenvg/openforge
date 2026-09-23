<script lang="ts">
  import type { WalkthroughReview } from './reviewWorkspace.svelte'
  import type { ReviewThread, ReviewThreadSide, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import type { PrFileDiff, PrOverviewComment, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import { resolvedAgentThreadSubmissions } from './reviewThreadSubmission'
  import { getReviewFileIdentity } from '@openforge-app/pr-review-ui/reviewFileIdentity'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Alert from '@openforge-app/plugin-sdk/ui/Alert.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import LoadingIndicator from '@openforge-app/plugin-sdk/ui/LoadingIndicator.svelte'
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import WalkthroughTab from './WalkthroughTab.svelte'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
  import type { ComponentProps } from 'svelte'
  import AgentTab from './AgentTab.svelte'

  type PrDetailTab = 'overview' | 'files' | 'agent' | 'walkthrough'

  type AgentSessionProps = ComponentProps<typeof AgentTab>

  interface Props {
    walkthrough: WalkthroughReview
    pr: ReviewPullRequest
    activeTab: PrDetailTab
    files: PrFileDiff[]
    isLoading: boolean
    error: string | null
    reviewUpdateAvailable?: boolean
    isRefreshingReview?: boolean
    reviewRefreshError?: string | null
    pendingCommentsToReview?: ReviewSubmissionComment[]
    reviewComments: ReviewComment[]
    pendingManualComments: ReviewSubmissionComment[]
    overviewComments: PrOverviewComment[]
    fileTreeVisible: boolean
    reviewedFileShas: Map<string, string>
    includeNonApplicationFiles: boolean
    onToggleNonApplicationFiles: (include: boolean) => void
    onBackToList: () => void
    onRefreshReview?: () => Promise<void>
    onRemove: () => void
    onOpenPrOnGitHub: () => void
    onActiveTabChange: (tab: PrDetailTab) => void
    onOverviewCommentsChange: (comments: PrOverviewComment[]) => void
    loadOverviewComments: (pr: ReviewPullRequest) => Promise<PrOverviewComment[]>
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    resolveRepositoryImage: (repositoryPath: string) => Promise<string | null>
    resolveRemoteMedia: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onToggleFileTree: () => void
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onToggleFileReviewed: (file: PrFileDiff, reviewed: boolean) => void
    agentSession: AgentSessionProps
    onActivateAgent: () => Promise<unknown>
    agentIsRunning: boolean
    agentHasUnreadOutput: boolean
    canGenerateWalkthrough: boolean
    isGeneratingWalkthrough: boolean
    onGenerateWalkthrough: () => Promise<unknown>
    // The Walkthrough tab is only offered once a walkthrough for the current head
    // sha has finished generating (owned by PrReviewView). Optional so the section
    // renders (tab hidden) before the parent wires status in.
    walkthroughReady?: boolean
    // Stored agent comments and question threads as review threads (owned by PrReviewView).
    reviewThreads?: ReviewThread[]
    reviewFollowUpUnavailableReason?: string | null
    onCreateReviewThread?: (filePath: string, line: number, side: ReviewThreadSide, body: string) => void
    onReplyToReviewThread?: (threadId: string, body: string) => void
    onSetReviewThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onMarkReviewThreadSeen?: (threadId: string) => void
    onCommentNow?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void
    onReplyToExistingComment?: (commentId: number, body: string) => void
    pendingReplies?: { commentId: number; body: string }[]
    replyPostingError?: string | null
    isPostingReplies?: boolean
    onRetryReplies?: () => Promise<void>
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
    onOpenUrl: (url: string) => void
  }

  let {
    walkthrough,
    pr,
    activeTab,
    files,
    isLoading,
    error,
    reviewUpdateAvailable = false,
    isRefreshingReview = false,
    reviewRefreshError = null,
    pendingCommentsToReview = [],
    reviewComments,
    pendingManualComments,
    overviewComments,
    fileTreeVisible,
    reviewedFileShas,
    includeNonApplicationFiles,
    onToggleNonApplicationFiles,
    onBackToList,
    onRefreshReview,
    onOpenPrOnGitHub,
    onActiveTabChange,
    onOverviewCommentsChange,
    loadOverviewComments,
    fetchFileContents,
    resolveRepositoryImage,
    resolveRemoteMedia,
    onToggleFileTree,
    onPendingCommentsChange,
    onToggleFileReviewed,
    agentSession,
    onActivateAgent,
    agentIsRunning,
    agentHasUnreadOutput,
    canGenerateWalkthrough,
    isGeneratingWalkthrough,
    onGenerateWalkthrough,
    onRemove,
    walkthroughReady = false,
    reviewThreads = [],
    reviewFollowUpUnavailableReason = null,
    onCreateReviewThread,
    onReplyToReviewThread,
    onSetReviewThreadStatus,
    onMarkReviewThreadSeen,
    onCommentNow,
    onReplyToExistingComment,
    pendingReplies = [],
    replyPostingError = null,
    isPostingReplies = false,
    onRetryReplies,
    onAddReplyToReview,
    onRemovePendingReply,
    onAskAgentStep,
    onSubmitReview,
    onOpenUrl,
  }: Props = $props()

  let resolvedAgentSubmissions = $derived(resolvedAgentThreadSubmissions(files, reviewThreads))

  function submitReview(request: Parameters<Props['onSubmitReview']>[0]): Promise<void> {
    return onSubmitReview(request, resolvedAgentSubmissions.map(submission => submission.threadId))
  }

  let diffViewer = $state<DiffViewer>()
  let prFileTree = $state<FileTree>()

  // If the Walkthrough tab is active but its walkthrough is no longer ready (e.g.
  // after switching to a PR that hasn't been generated yet), fall back to Overview
  // so we never strand the reviewer on a hidden/blank tab.
  $effect(() => {
    if (activeTab === 'walkthrough' && !walkthroughReady) {
      onActiveTabChange('overview')
    }
  })

  $effect(() => {
    if (activeTab === 'agent') void onActivateAgent().catch(() => undefined)
  })

  // The "Files changed" tab filters non-application files out of the tree and diff, but the
  // tab badge and the Walkthrough tab keep the full changed-file list.
  let visibleFiles = $derived(filterApplicationFiles(files, includeNonApplicationFiles))
  let nonApplicationFileCount = $derived(countNonApplicationFiles(files))
  let detailTabs = $derived([
    { value: 'overview', label: 'Overview' },
    { value: 'files', label: `Files changed ${files.length}` },
    { value: 'agent', label: 'Agent' },
    ...(walkthroughReady ? [{ value: 'walkthrough', label: 'Walkthrough' }] : []),
  ])
  let agentTabAriaLabel = $derived([
    'Agent',
    ...(agentIsRunning ? ['running'] : []),
    ...(agentHasUnreadOutput ? ['unread output'] : []),
  ].join(', '))

  function changeActiveTab(value: string): void {
    if (value === 'overview' || value === 'files' || value === 'agent' || value === 'walkthrough') {
      onActiveTabChange(value)
    }
  }

  function handleFileSelect(filename: string) {
    diffViewer?.scrollToFile(filename)
  }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
  {#if replyPostingError || isPostingReplies}
    <div class="flex items-center gap-3 border-b border-of-border px-4 py-2 text-sm text-of-danger" role="alert">
      <span>{isPostingReplies ? 'Posting queued replies…' : replyPostingError}</span>
      {#if onRetryReplies && pendingReplies.length > 0}
        <Button size="xs" disabled={isPostingReplies} onclick={onRetryReplies}>Retry replies</Button>
      {/if}
    </div>
  {/if}
  <div class="flex flex-col gap-1.5 border-b border-of-border bg-of-surface-subtle px-4 py-2.5 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <Button variant="ghost" size="xs" class="shrink-0 text-of-text/50" onclick={onBackToList}>← Back</Button>
      <Badge variant="info" class="shrink-0">{pr.repo_owner}/{pr.repo_name}</Badge>
      <h2 class="text-sm font-semibold text-of-text m-0 truncate flex-1">{pr.title}</h2>
      {#if activeTab === 'agent'}
        <Button
          size="xs"
          disabled={!canGenerateWalkthrough || isGeneratingWalkthrough}
          onclick={() => { void onGenerateWalkthrough().catch(() => undefined) }}
        >{isGeneratingWalkthrough ? 'Generating…' : 'Generate walkthrough'}</Button>
      {/if}
      <Button
        variant="ghost"
        size="xs"
        class="shrink-0 text-of-accent"
        role="link"
        onclick={onOpenPrOnGitHub}
      >GitHub ↗</Button>
      <Button
        variant="ghost"
        size="xs"
        class="shrink-0 text-of-text/50"
        title="Remove this pull request from your review list"
        onclick={onRemove}
      >Remove from list</Button>
    </div>
    <div class="flex items-center gap-2 text-xs text-of-text/50">
      <span class="font-semibold text-of-text">#{pr.number}</span>
      <span class="text-of-border">•</span>
      <span class="font-medium">{pr.user_login}</span>
      <span class="text-of-border">•</span>
      <span>{timeAgoFromSeconds(pr.created_at)}</span>
    </div>
    {#if reviewFollowUpUnavailableReason}
      <p class="m-0 text-xs text-of-text/60" role="status">
        AI follow-ups are unavailable. {reviewFollowUpUnavailableReason}
      </p>
    {/if}
  </div>

  {#if reviewUpdateAvailable && onRefreshReview}
    <div class="shrink-0 border-b border-of-border px-4 py-2.5">
      <Alert variant="warning" role="status" aria-live="polite">
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <div class="font-medium">New commits are available for this pull request.</div>
            <div class="text-xs opacity-80">Refresh before submitting so your review uses the latest changes.</div>
            {#if reviewRefreshError}
              <div class="mt-1 text-xs" role="alert">Refresh failed: {reviewRefreshError}</div>
            {/if}
          </div>
          <Button
            variant="outline"
            size="xs"
            disabled={isRefreshingReview}
            onclick={() => { void onRefreshReview() }}
          >{isRefreshingReview ? 'Refreshing…' : 'Refresh latest changes'}</Button>
        </div>
      </Alert>
    </div>
  {:else if pendingCommentsToReview.length > 0}
    <div class="shrink-0 border-b border-of-border px-4 py-2.5">
      <Alert variant="info" role="status" aria-live="polite">
        Latest changes loaded. Recheck your pending comments before submitting.
      </Alert>
    </div>
  {/if}

  {#snippet agentActivitySignals()}
    <span class="agent-activity-signals" aria-hidden="true">
      <span
        class:visible={agentIsRunning}
        class="agent-running-signal"
        data-agent-running={agentIsRunning ? '' : undefined}
      ></span>
      <span
        class:visible={agentHasUnreadOutput}
        class="agent-unread-signal"
        data-agent-unread={agentHasUnreadOutput ? '' : undefined}
      ></span>
    </span>
  {/snippet}

  <Tabs
    label="Pull request detail sections"
    tabs={detailTabs.map(tab => tab.value === 'agent'
      ? { ...tab, ariaLabel: agentTabAriaLabel, trailing: agentActivitySignals }
      : tab)}
    value={activeTab}
    onValueChange={changeActiveTab}
    fill
  >
    {#snippet children(tab)}
      {#if tab === activeTab}
      {#if tab === 'overview'}
        <PrOverviewTab
          {pr}
          comments={overviewComments}
          onCommentsChange={onOverviewCommentsChange}
          loadComments={loadOverviewComments}
          {resolveRemoteMedia}
          {onOpenUrl}
        />
      {:else if tab === 'agent'}
        <AgentTab {...agentSession} />
      {:else if tab === 'walkthrough'}
        <WalkthroughTab
          workspace={walkthrough}
          {pr}
          {files}
          {fetchFileContents}
          {resolveRepositoryImage}
          existingComments={reviewComments}
          pendingComments={pendingManualComments}
          {pendingCommentsToReview}
          onPendingCommentsChange={onPendingCommentsChange}
          {onOpenUrl}
          reviewThreads={reviewThreads}
          {reviewFollowUpUnavailableReason}
          onCreateReviewThread={onCreateReviewThread}
          onReplyToReviewThread={onReplyToReviewThread}
          onSetReviewThreadStatus={onSetReviewThreadStatus}
          onMarkReviewThreadSeen={onMarkReviewThreadSeen}
          onCommentNow={onCommentNow}
          onReplyToExistingComment={onReplyToExistingComment}
          pendingReplies={pendingReplies}
          onAddReplyToReview={onAddReplyToReview}
          onRemovePendingReply={onRemovePendingReply}
          onAskAgentStep={onAskAgentStep}
          onSubmitReview={submitReview}
        />
      {:else}
        <div class="flex h-full min-h-0 overflow-hidden">
          {#if isLoading}
            <div class="flex flex-col items-center justify-center flex-1 gap-3 text-of-text/50 text-sm" role="status" aria-live="polite" aria-atomic="true">
              <LoadingIndicator size="md" decorative class="text-of-accent" />
              <span>Loading diffs...</span>
            </div>
          {:else if error}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-of-danger text-sm text-center p-5" role="alert" aria-live="assertive">
              <span class="text-5xl" aria-hidden="true">⚠</span>
              <span>{error}</span>
            </div>
          {:else}
            {#if fileTreeVisible}
              <ResizablePanel storageKey="pr-review-file-tree" defaultWidth={260} minWidth={160} maxWidth={500} side="left">
                <FileTree
                  bind:this={prFileTree}
                  files={visibleFiles}
                  onSelectFile={handleFileSelect}
                  {reviewedFileShas}
                  getFileReviewIdentity={getReviewFileIdentity}
                  onToggleFileReviewed={onToggleFileReviewed}
                  onRequestFocusDiff={() => diffViewer?.focusDiff()}
                  {includeNonApplicationFiles}
                  {nonApplicationFileCount}
                  {onToggleNonApplicationFiles}
                />
              </ResizablePanel>
            {/if}
            <DiffViewer
              bind:this={diffViewer}
              files={visibleFiles}
              existingComments={reviewComments}
              repoOwner={pr.repo_owner}
              repoName={pr.repo_name}
              headSha={pr.head_sha}
              {fileTreeVisible}
              onToggleFileTree={onToggleFileTree}
              {fetchFileContents}
              {resolveRepositoryImage}
              pendingComments={pendingManualComments}
              onPendingCommentsChange={onPendingCommentsChange}
              {onOpenUrl}
              threads={reviewThreads}
              onCreateThread={onCreateReviewThread}
              onReplyToThread={onReplyToReviewThread}
              onSetThreadStatus={onSetReviewThreadStatus}
              onMarkThreadSeen={onMarkReviewThreadSeen}
              onCommentNow={onCommentNow}
              onReplyToExistingComment={onReplyToExistingComment}
              pendingReplies={pendingReplies}
              onAddReplyToReview={onAddReplyToReview}
              onRemovePendingReply={onRemovePendingReply}
              {reviewedFileShas}
              onToggleFileReviewed={onToggleFileReviewed}
              getFileReviewIdentity={getReviewFileIdentity}
              onRequestFocusFileTree={() => prFileTree?.focusTree()}
            >
              {#snippet footer()}
                <ReviewSubmitPanel
                  repoOwner={pr.repo_owner}
                  repoName={pr.repo_name}
                  prNumber={pr.number}
                  commitId={pr.head_sha}
                  pendingComments={pendingManualComments}
                  {pendingCommentsToReview}
                  resolvedAgentComments={resolvedAgentSubmissions.map(submission => submission.comment)}
                  pendingReplyCount={pendingReplies.length}
                  onPendingCommentsChange={onPendingCommentsChange}
                  onSubmitReview={submitReview}
                />
              {/snippet}
            </DiffViewer>
          {/if}
        </div>
      {/if}
      {/if}
    {/snippet}
  </Tabs>
</div>

<style>
  .agent-activity-signals {
    display: inline-grid;
    width: calc(var(--of-space2) * 2 + var(--of-space1));
    grid-template-columns: repeat(2, var(--of-space2));
    align-items: center;
    gap: var(--of-space1);
  }

  .agent-running-signal,
  .agent-unread-signal {
    display: block;
    visibility: hidden;
  }

  .agent-running-signal.visible,
  .agent-unread-signal.visible {
    visibility: visible;
  }

  .agent-running-signal {
    width: var(--of-space2);
    height: var(--of-space2);
    border: var(--of-border-width) solid var(--of-accent);
    border-right-color: transparent;
    border-radius: var(--of-radius-round);
    animation: agent-running-spin 0.8s linear infinite;
  }

  .agent-unread-signal {
    width: calc(var(--of-space2) * 0.75);
    height: calc(var(--of-space2) * 0.75);
    margin-inline: auto;
    border-radius: var(--of-radius-round);
    background: var(--of-info);
  }

  @keyframes agent-running-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-running-signal {
      animation: none;
    }
  }
</style>
