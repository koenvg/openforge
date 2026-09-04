<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { AgentReviewComment, AiThread, PrFileDiff, PrOverviewComment, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import { approvedInlineAgentComments, agentCommentToSubmission } from '@openforge-app/pr-review-ui/diffComments'
  import { getReviewFileIdentity } from '@openforge-app/pr-review-ui/reviewFileIdentity'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import type { GithubSyncPrReviewClient } from './githubSyncClient'
  import WalkthroughTab from './WalkthroughTab.svelte'
  import QuestionsPanel from './QuestionsPanel.svelte'
  import { buildQuestionsIndex, type QuestionItem } from '../../lib/questionsIndex'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
  import { tick } from 'svelte'
  import { ListChecks } from '@lucide/svelte'

  type PrDetailTab = 'overview' | 'files' | 'walkthrough'

  interface Props {
    api: FrontendOpenForgeAPI
    githubSync: GithubSyncPrReviewClient
    pr: ReviewPullRequest
    activeProjectId: string | null
    activeTab: PrDetailTab
    files: PrFileDiff[]
    isLoading: boolean
    error: string | null
    reviewComments: ReviewComment[]
    pendingManualComments: ReviewSubmissionComment[]
    overviewComments: PrOverviewComment[]
    agentReviewComments: AgentReviewComment[]
    fileTreeVisible: boolean
    reviewedFileShas: Map<string, string>
    includeNonApplicationFiles: boolean
    onToggleNonApplicationFiles: (include: boolean) => void
    onBackToList: () => void
    onOpenPrOnGitHub: () => void
    onActiveTabChange: (tab: PrDetailTab) => void
    onOverviewCommentsChange: (comments: PrOverviewComment[]) => void
    loadOverviewComments: (pr: ReviewPullRequest) => Promise<PrOverviewComment[]>
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    resolveRepositoryImage: (repositoryPath: string) => Promise<string | null>
    resolveRemoteMedia: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onToggleFileTree: () => void
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus: (commentId: number, status: string) => Promise<void>
    onToggleFileReviewed: (file: PrFileDiff, reviewed: boolean) => void
    // The Walkthrough tab is only offered once a walkthrough for the current head
    // sha has finished generating (owned by PrReviewView). Optional so the section
    // renders (tab hidden) before the parent wires status in.
    walkthroughReady?: boolean
    // Local "Ask the AI author" Q&A threads + handlers (owned by PrReviewView).
    aiThreads?: AiThread[]
    aiThreadsPendingCount?: number
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
    onSendQuestionsToAgent?: () => void
    // Marks an answered thread as read (owned by PrReviewView, persists seen_at).
    onMarkThreadSeen?: (threadId: string) => void
    // Rail-matching labels for step-anchored questions ("Step 2 · <title>").
    stepLabelById?: Map<string, { number: number; title: string }>
    onSubmitReview: (request: {
      repoOwner: string
      repoName: string
      prNumber: number
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
      body: string
      comments: ReviewSubmissionComment[]
      commitId: string
    }) => Promise<void>
    onOpenUrl: (url: string) => void
  }

  let {
    api,
    githubSync,
    pr,
    activeProjectId,
    activeTab,
    files,
    isLoading,
    error,
    reviewComments,
    pendingManualComments,
    overviewComments,
    agentReviewComments,
    fileTreeVisible,
    reviewedFileShas,
    includeNonApplicationFiles,
    onToggleNonApplicationFiles,
    onBackToList,
    onOpenPrOnGitHub,
    onActiveTabChange,
    onOverviewCommentsChange,
    loadOverviewComments,
    fetchFileContents,
    resolveRepositoryImage,
    resolveRemoteMedia,
    onToggleFileTree,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onToggleFileReviewed,
    walkthroughReady = false,
    aiThreads = [],
    aiThreadsPendingCount = 0,
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
    onSendQuestionsToAgent,
    onMarkThreadSeen,
    stepLabelById,
    onSubmitReview,
    onOpenUrl,
  }: Props = $props()

  // The questions panel: one collected view of every place still wanting the
  // reviewer's attention (their questions + undecided AI suggestions), each row
  // deep-linking to its anchor. Data comes straight from the props already here.
  let questionsPanelOpen = $state(false)
  let focusStepId = $state<string | null>(null)
  let questionsIndex = $derived(buildQuestionsIndex(aiThreads, agentReviewComments))

  async function handleSelectQuestion(item: QuestionItem) {
    questionsPanelOpen = false
    // Auto-mark-on-open: jumping to an answer counts as reading it.
    if (item.source.kind === 'thread' && item.group === 'answers_to_read') {
      onMarkThreadSeen?.(item.source.thread.id)
    }
    if (item.target.kind === 'step') {
      onActiveTabChange('walkthrough')
      focusStepId = item.target.stepId
      return
    }
    const { filename, line } = item.target
    onActiveTabChange('files')
    // Wait for the tab switch so the DiffViewer instance is bound; scrollToComment
    // then polls for the row itself, so a still-mounting diff resolves on its own.
    await tick()
    if (line != null) void diffViewer?.scrollToComment(filename, line)
    else diffViewer?.scrollToFile(filename)
  }

  // Approved AI review comments are submitted with the review directly (approving
  // no longer copies them into the manual pending list), so map them to
  // submission shape for ReviewSubmitPanel.
  let approvedAgentSubmissionComments = $derived(
    approvedInlineAgentComments(agentReviewComments).map(agentCommentToSubmission),
  )

  // After a successful submit the approved AI comments now exist as real GitHub
  // review comments, so mark them handled: 'dismissed' hides them from the AI list
  // and keeps them out of the approved set, preventing a duplicate on refresh or a
  // re-submit. Only runs on submit success (ReviewSubmitPanel guards it).
  function handleApprovedAgentCommentsSubmitted() {
    const submitted = approvedInlineAgentComments(agentReviewComments)
    if (submitted.length === 0) return
    const submittedIds = new Set(submitted.map(comment => comment.id))
    for (const comment of submitted) void onUpdateAgentCommentStatus(comment.id, 'dismissed')
    onAgentCommentsChange(
      agentReviewComments.map(comment =>
        submittedIds.has(comment.id) ? { ...comment, status: 'dismissed' } : comment,
      ),
    )
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

  // The "Files changed" tab filters non-application files out of the tree and diff, but the
  // tab badge and the Walkthrough tab keep the full changed-file list.
  let visibleFiles = $derived(filterApplicationFiles(files, includeNonApplicationFiles))
  let nonApplicationFileCount = $derived(countNonApplicationFiles(files))
  let detailTabs = $derived([
    { value: 'overview', label: 'Overview' },
    { value: 'files', label: `Files changed ${files.length}` },
    ...(walkthroughReady ? [{ value: 'walkthrough', label: 'Walkthrough' }] : []),
  ])

  function changeActiveTab(value: string): void {
    if (value === 'overview' || value === 'files' || value === 'walkthrough') {
      onActiveTabChange(value)
    }
  }

  function handleFileSelect(filename: string) {
    diffViewer?.scrollToFile(filename)
  }
</script>

<div class="relative flex h-full min-h-0 flex-col overflow-hidden">
  <div class="flex flex-col gap-1.5 border-b border-base-300 bg-base-200 px-4 py-2.5 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <Button variant="ghost" size="xs" class="shrink-0 text-base-content/50" onclick={onBackToList}>← Back</Button>
      <Badge variant="info" class="shrink-0">{pr.repo_owner}/{pr.repo_name}</Badge>
      <h2 class="text-sm font-semibold text-base-content m-0 truncate flex-1">{pr.title}</h2>
      {#if questionsIndex.totalCount > 0}
        <Button
          variant="ghost"
          size="xs"
          class="shrink-0 gap-1"
          onclick={() => { questionsPanelOpen = true }}
          title="Find all your questions and undecided AI suggestions in one place"
        >
          <ListChecks class="w-3.5 h-3.5" aria-hidden="true" />
          Questions
          {#if questionsIndex.actionableCount > 0}
            <Badge variant="info" class="ml-1">{questionsIndex.actionableCount}</Badge>
          {/if}
        </Button>
      {/if}
      {#if aiThreadsPendingCount > 0}
        <Button
          size="xs"
          class="mr-2"
          onclick={() => onSendQuestionsToAgent?.()}
          title="Send your unanswered questions to the AI author (stays local, never posted to GitHub)"
        >
          Send {aiThreadsPendingCount} question{aiThreadsPendingCount === 1 ? '' : 's'} to AI
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="xs"
        class="shrink-0 text-primary"
        role="link"
        onclick={onOpenPrOnGitHub}
      >GitHub ↗</Button>
    </div>
    <div class="flex items-center gap-2 text-xs text-base-content/50">
      <span class="font-semibold text-base-content">#{pr.number}</span>
      <span class="text-base-300">•</span>
      <span class="font-medium">{pr.user_login}</span>
      <span class="text-base-300">•</span>
      <span>{timeAgoFromSeconds(pr.created_at)}</span>
    </div>
  </div>

  <Tabs
    label="Pull request detail sections"
    tabs={detailTabs}
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
      {:else if tab === 'walkthrough'}
        <WalkthroughTab
          {api}
          {githubSync}
          {pr}
          {files}
          {fetchFileContents}
          {resolveRepositoryImage}
          projectId={activeProjectId}
          existingComments={reviewComments}
          agentComments={agentReviewComments}
          pendingComments={pendingManualComments}
          onPendingCommentsChange={onPendingCommentsChange}
          onAgentCommentsChange={onAgentCommentsChange}
          onUpdateAgentCommentStatus={onUpdateAgentCommentStatus}
          {onOpenUrl}
          aiThreads={aiThreads}
          onAskAgent={onAskAgent}
          onCommentNow={onCommentNow}
          onReplyToThread={onReplyToThread}
          onAskAboutComment={onAskAboutComment}
          onReplyToExistingComment={onReplyToExistingComment}
          pendingReplies={pendingReplies}
          onAddReplyToReview={onAddReplyToReview}
          onRemovePendingReply={onRemovePendingReply}
          onAskAgentStep={onAskAgentStep}
          onEditThread={onEditThread}
          onDeleteThread={onDeleteThread}
          onSubmitReview={onSubmitReview}
          {focusStepId}
        />
      {:else}
        <div class="flex h-full min-h-0 overflow-hidden">
          {#if isLoading}
            <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm" role="status" aria-live="polite" aria-atomic="true">
              <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
              <span>Loading diffs...</span>
            </div>
          {:else if error}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5" role="alert" aria-live="assertive">
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
              agentComments={agentReviewComments}
              pendingComments={pendingManualComments}
              onPendingCommentsChange={onPendingCommentsChange}
              onAgentCommentsChange={onAgentCommentsChange}
              onUpdateAgentCommentStatus={onUpdateAgentCommentStatus}
              {onOpenUrl}
              aiThreads={aiThreads}
              onAskAgent={onAskAgent}
              onCommentNow={onCommentNow}
              onReplyToThread={onReplyToThread}
              onAskAboutComment={onAskAboutComment}
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
                  approvedAgentComments={approvedAgentSubmissionComments}
                  pendingReplyCount={pendingReplies.length}
                  onPendingCommentsChange={onPendingCommentsChange}
                  onApprovedAgentCommentsSubmitted={handleApprovedAgentCommentsSubmitted}
                  onSubmitReview={onSubmitReview}
                />
              {/snippet}
            </DiffViewer>
          {/if}
        </div>
      {/if}
      {/if}
    {/snippet}
  </Tabs>

  {#if questionsPanelOpen}
    <QuestionsPanel
      index={questionsIndex}
      {stepLabelById}
      onSelect={handleSelectQuestion}
      onClose={() => { questionsPanelOpen = false }}
    />
  {/if}
</div>
