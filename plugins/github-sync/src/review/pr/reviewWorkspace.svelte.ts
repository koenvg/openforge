import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewThreadSide, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
import type { PrOverviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import * as stores from '../../lib/stores'
import { createGithubSyncPrReviewClient } from './githubSyncClient'
import { usePrReviewListState } from './review-workspace/usePrReviewListState.svelte'
import { useReviewedFilesState } from './review-workspace/useReviewedFilesState.svelte'
import { useSelectedPrReview } from './review-workspace/useSelectedPrReview.svelte'
import { useWalkthroughPolling } from './review-workspace/useWalkthroughPolling.svelte'
import { createWalkthroughReview } from './review-workspace/walkthroughReview.svelte'
import { createPrReviewAgentSessionController } from './review-workspace/usePrReviewAgentSession.svelte'
import { createReviewThreadFollowUpController } from './review-workspace/useReviewThreadFollowUps.svelte'
export type { WalkthroughReview } from './review-workspace/walkthroughReview.svelte'

export interface ReviewWorkspaceContext {
  projectId: string | null
  projectName: string
}

/**
 * Create once during Svelte initialization. Models are reactive and include the
 * actions that operate on them; callers never coordinate stores or child owners.
 * The SDK is the I/O seam, backed by the host in production and its registry fake
 * in tests. Svelte destruction releases subscriptions and polling.
 */
export function createReviewWorkspace(api: FrontendOpenForgeAPI, getContext: () => ReviewWorkspaceContext) {
  const githubSync = createGithubSyncPrReviewClient(api)
  const selectedPr = fromStore(stores.selectedReviewPr)
  const files = fromStore(stores.prFileDiffs)
  const comments = fromStore(stores.reviewComments)
  const pendingComments = fromStore(stores.pendingManualComments)
  const overviewComments = fromStore(stores.prOverviewComments)
  const replies = fromStore(stores.pendingReplies)
  const reviewPrs = fromStore(stores.reviewPrs)
  const authoredPrs = fromStore(stores.authoredPrs)
  const walkthroughs = useWalkthroughPolling(api, githubSync)
  const agentSession = createPrReviewAgentSessionController(api)
  const followUps = createReviewThreadFollowUpController(api, agentSession)
  const selection = useSelectedPrReview(api, githubSync, followUps, walkthroughs, agentSession)
  const walkthrough = createWalkthroughReview(
    walkthroughs, githubSync, () => selectedPr.current, () => files.current,
    () => selection.activeTab === 'walkthrough',
  )
  const reviewedFiles = useReviewedFilesState(api, () => getContext().projectId)
  const list = usePrReviewListState({
    api, githubSync,
    getScope: () => api.navigation.get().currentView?.endsWith('pr_review_global') ? 'global' : 'repo',
    getProjectName: () => getContext().projectName,
    getProjectId: () => getContext().projectId,
    walkthroughs,
    onSelectPr: selection.select,
    onBackToList: selection.backToList,
  })

  $effect(() => { stores.activeProjectId.set(getContext().projectId) })
  $effect(() => { void agentSession.observe(selectedPr.current) })
  onDestroy(() => {
    followUps.dispose()
    agentSession.dispose()
  })

  const openUrl = (url: string) => api.system.openUrl(url)
  const openSettings = () => api.navigation.navigate({ viewId: 'global_settings' })
  const setPendingComments = (value: ReviewSubmissionComment[]) => { pendingComments.current = value }
  const setOverviewComments = (value: PrOverviewComment[]) => { overviewComments.current = value }

  let reviewThreads = $derived(selectedPr.current ? followUps.threads : [])

  function createReviewThread(filePath: string, line: number, side: ReviewThreadSide, body: string): void {
    void followUps.askLine(filePath, line, side, body).catch(error => {
      console.error('Failed to send the review thread follow-up:', error)
    })
  }

  function replyToReviewThread(threadId: string, body: string): void {
    void followUps.reply(threadId, body).catch(error => {
      console.error('Failed to send the review thread follow-up:', error)
    })
  }

  async function setReviewThreadStatus(threadId: string, status: ReviewThreadStatus): Promise<void> {
    try {
      await followUps.setStatus(threadId, status)
    } catch (error) {
      console.error('Failed to record the reviewer decision:', error)
    }
  }

  function markReviewThreadSeen(threadId: string): void {
    void followUps.markSeen(threadId).catch(error => {
      console.error('Failed to mark the review thread seen:', error)
    })
  }

  async function submitReview(
    request: Parameters<typeof selection.submitReview>[0],
    submittedReviewThreadIds: string[] = [],
  ): Promise<void> {
    await selection.submitReview(request)
    try {
      await followUps.dismissSubmitted(submittedReviewThreadIds)
    } catch (error) {
      console.error('Review submitted, but its Review Threads could not be dismissed:', error)
    }
  }

  let listModel = $derived({
    headerTitle: list.headerTitle,
    headerSubtitle: list.headerSubtitle,
    projectName: getContext().projectName,
    showFilters: list.showFilters,
    projectHasNoRepo: list.projectHasNoRepo,
    excludedRepos: list.excludedRepos,
    showFilterDropdown: list.showFilterDropdown,
    newRepoInput: list.newRepoInput,
    suggestedRepos: list.suggestedRepos,
    isLoading: list.isLoading,
    isLoadingAuthored: list.isLoadingAuthored,
    error: list.error,
    authoredError: list.authoredError,
    githubTokenConfigured: list.githubTokenConfigured,
    reviewRequests: list.reviewRequests,
    filteredAuthoredPrs: list.filteredAuthoredPrs,
    allReviewPrs: reviewPrs.current,
    allAuthoredPrs: authoredPrs.current,
    hiddenReviewRepos: list.hiddenReviewRepos,
    hiddenAuthoredRepos: list.hiddenAuthoredRepos,
    groupedAuthoredPrs: list.groupedAuthoredPrs,
    focusedIndex: list.focusedIndex,
    onToggleFilterDropdown: () => list.setShowFilterDropdown(!list.showFilterDropdown),
    onCloseFilterDropdown: () => list.setShowFilterDropdown(false),
    onNewRepoInputChange: list.setNewRepoInput,
    onAddExcludedRepo: list.addExcludedRepo,
    onRemoveExcludedRepo: list.removeExcludedRepo,
    onRefreshPrs: list.refreshPrs,
    onRefreshAuthoredPrs: list.refreshAuthoredPrs,
    onOpenGithubSettings: openSettings,
    onOpenRepositoryFilters: () => list.setShowFilterDropdown(true),
    onSelectPr: selection.select,
    onMarkUnread: selection.markUnread,
    onRemove: selection.removeReviewPr,
    onOpenAuthoredPr: openUrl,
    onStartTaskFromAuthoredPr: getContext().projectId ? list.startTaskFromAuthoredPr : undefined,
    pluralize: list.pluralize,
  })

  let detailModel = $derived(selectedPr.current ? {
    walkthrough,
    pr: selectedPr.current,
    activeTab: selection.activeTab,
    files: files.current,
    isLoading: selection.isLoading,
    error: selection.error,
    reviewComments: comments.current,
    pendingManualComments: pendingComments.current,
    overviewComments: overviewComments.current,
    fileTreeVisible: selection.fileTreeVisible,
    reviewedFileShas: reviewedFiles.reviewedFileShas,
    includeNonApplicationFiles: selection.includeNonApplicationFiles,
    onToggleNonApplicationFiles: selection.setIncludeNonApplicationFiles,
    onBackToList: selection.backToList,
    onRemove: selection.removeFromDetail,
    onOpenPrOnGitHub: selection.openOnGitHub,
    onActiveTabChange: selection.setActiveTab,
    onOverviewCommentsChange: setOverviewComments,
    loadOverviewComments: selection.loadOverviewComments,
    fetchFileContents: selection.fetchFileContents,
    resolveRepositoryImage: selection.resolveRepositoryImage,
    resolveRemoteMedia: selection.resolveRemoteMedia,
    onToggleFileTree: selection.toggleFileTree,
    onPendingCommentsChange: setPendingComments,
    onToggleFileReviewed: reviewedFiles.toggle,
    walkthroughReady: walkthrough.available,
    onActivateAgent: agentSession.activate,
    canGenerateWalkthrough: agentSession.projectId !== null
      && agentSession.status?.acceptsInput === true
      && !(agentSession.status.status === 'running' && agentSession.status.turnId !== null)
      && !agentSession.actionPending
      && walkthrough.walkthrough?.state !== 'generating',
    isGeneratingWalkthrough: walkthrough.isStarting || walkthrough.walkthrough?.state === 'generating',
    onGenerateWalkthrough: walkthrough.generate,
    agentSession: {
      scope: agentSession.scope,
      projectResolved: agentSession.projectResolved,
      projectId: agentSession.projectId,
      status: agentSession.status,
      isLoading: agentSession.isLoading,
      error: agentSession.error,
      availabilityError: agentSession.availabilityError,
      mountTerminal: api.agentSessions.mountTerminal,
    },
    reviewThreads,
    reviewFollowUpUnavailableReason: followUps.unavailableReason,
    onCreateReviewThread: followUps.unavailableReason === null ? createReviewThread : undefined,
    onReplyToReviewThread: followUps.unavailableReason === null ? replyToReviewThread : undefined,
    onSetReviewThreadStatus: setReviewThreadStatus,
    onMarkReviewThreadSeen: markReviewThreadSeen,
    onCommentNow: selection.commentNow,
    onReplyToExistingComment: selection.replyToExistingComment,
    pendingReplies: replies.current,
    replyPostingError: selection.replyPostingError,
    isPostingReplies: selection.isPostingReplies,
    onRetryReplies: selection.retryReplies,
    onAddReplyToReview: selection.addReplyToReview,
    onRemovePendingReply: selection.removePendingReply,
    onAskAgentStep: followUps.unavailableReason === null
      ? (stepId: string, body: string) => {
          void followUps.askStep(stepId, body).catch(error => {
            console.error('Failed to send the walkthrough step follow-up:', error)
          })
        }
      : undefined,
    onSubmitReview: submitReview,
    onOpenUrl: openUrl,
  } : null)

  let postReviewModel = $derived(selection.postReviewPr ? {
    pr: selection.postReviewPr,
    onKeep: selection.keepAfterReview,
    onRemove: selection.removeAfterReview,
  } : null)

  return {
    get list() { return listModel },
    get detail() { return detailModel },
    get postReview() { return postReviewModel },
    handleKeydown(event: KeyboardEvent) {
      if (list.handleFilterKeydown(event)) return
      if (!selectedPr.current) {
        list.handleKeydown(event)
        return
      }
      if (walkthrough.handleKeydown(event)) return
      selection.handleKeydown(event)
    },
  }
}

export type ReviewWorkspace = ReturnType<typeof createReviewWorkspace>
