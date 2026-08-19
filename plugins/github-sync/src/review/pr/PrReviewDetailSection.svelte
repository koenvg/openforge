<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { AgentReviewComment, AiThread, PrFileDiff, PrOverviewComment, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import { getReviewFileIdentity } from '@openforge-app/pr-review-ui/reviewFileIdentity'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import type { GithubSyncPrReviewClient } from './githubSyncClient'
  import WalkthroughTab from './WalkthroughTab.svelte'
  import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
  import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'

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
    onReplyToThread?: (threadId: string, body: string) => void
    onAskAgentStep?: (stepId: string, body: string) => void
    onSendQuestionsToAgent?: () => void
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
    onToggleFileTree,
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onToggleFileReviewed,
    walkthroughReady = false,
    aiThreads = [],
    aiThreadsPendingCount = 0,
    onAskAgent,
    onReplyToThread,
    onAskAgentStep,
    onSendQuestionsToAgent,
    onSubmitReview,
    onOpenUrl,
  }: Props = $props()

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

  function handleFileSelect(filename: string) {
    diffViewer?.scrollToFile(filename)
  }
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <div class="flex flex-col gap-1.5 px-4 py-2.5 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
    <div class="flex items-center gap-2 min-w-0">
      <button class="btn btn-ghost btn-xs text-base-content/50 shrink-0" onclick={onBackToList}>← Back</button>
      <span class="badge badge-primary badge-sm shrink-0">{pr.repo_owner}/{pr.repo_name}</span>
      <h2 class="text-sm font-semibold text-base-content m-0 truncate flex-1">{pr.title}</h2>
      <span
        class="text-xs text-primary font-medium cursor-pointer hover:opacity-80 hover:underline shrink-0"
        role="link"
        tabindex="0"
        onclick={onOpenPrOnGitHub}
        onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && onOpenPrOnGitHub()}
      >GitHub ↗</span>
    </div>
    <div class="flex items-center">
      <div class="flex gap-1" role="tablist" aria-label="Pull request detail sections">
        <button
          role="tab"
          aria-selected={activeTab === 'overview'}
          class="btn btn-ghost btn-xs {activeTab === 'overview' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
          onclick={() => onActiveTabChange('overview')}
        >Overview</button>
        <button
          role="tab"
          aria-selected={activeTab === 'files'}
          class="btn btn-ghost btn-xs {activeTab === 'files' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
          onclick={() => onActiveTabChange('files')}
        >Files changed <span class="badge badge-xs ml-1">{files.length}</span></button>
        {#if walkthroughReady}
          <button
            class="btn btn-ghost btn-xs {activeTab === 'walkthrough' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
            onclick={() => onActiveTabChange('walkthrough')}
            title="AI walkthrough"
          >
            Walkthrough
          </button>
        {/if}
      </div>
      <span class="flex-1"></span>
      {#if aiThreadsPendingCount > 0}
        <button
          type="button"
          class="btn btn-xs btn-primary mr-2"
          onclick={() => onSendQuestionsToAgent?.()}
          title="Send your unanswered questions to the AI author (stays local, never posted to GitHub)"
        >
          Send {aiThreadsPendingCount} question{aiThreadsPendingCount === 1 ? '' : 's'} to AI
        </button>
      {/if}
      <div class="flex items-center gap-2 text-xs text-base-content/50">
        <span class="font-semibold text-base-content">#{pr.number}</span>
        <span class="text-base-300">•</span>
        <span class="font-medium">{pr.user_login}</span>
        <span class="text-base-300">•</span>
        <span>{timeAgoFromSeconds(pr.created_at)}</span>
      </div>
    </div>
  </div>

  {#if activeTab === 'overview'}
    <PrOverviewTab
      {pr}
      comments={overviewComments}
      onCommentsChange={onOverviewCommentsChange}
      loadComments={loadOverviewComments}
      {onOpenUrl}
    />
  {:else if activeTab === 'walkthrough'}
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
      onReplyToThread={onReplyToThread}
      onAskAgentStep={onAskAgentStep}
      onSubmitReview={onSubmitReview}
    />
  {:else}
    <div class="flex flex-1 min-h-0 overflow-hidden">
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
          onReplyToThread={onReplyToThread}
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
              onPendingCommentsChange={onPendingCommentsChange}
              onSubmitReview={onSubmitReview}
            />
          {/snippet}
        </DiffViewer>
      {/if}
    </div>
  {/if}
</div>
