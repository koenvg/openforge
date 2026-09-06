import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { AgentReviewComment, PrOverviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import * as stores from '../../lib/stores'
import { createGithubSyncPrReviewClient } from './githubSyncClient'
import { useAiThreadState } from './review-workspace/useAiThreadState.svelte'
import { usePrReviewListState } from './review-workspace/usePrReviewListState.svelte'
import { useReviewedFilesState } from './review-workspace/useReviewedFilesState.svelte'
import { useSelectedPrReview } from './review-workspace/useSelectedPrReview.svelte'
import { useWalkthroughPolling } from './review-workspace/useWalkthroughPolling.svelte'
import { createWalkthroughReview } from './review-workspace/walkthroughReview.svelte'
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
  const agentComments = fromStore(stores.agentReviewComments)
  const replies = fromStore(stores.pendingReplies)
  const reviewPrs = fromStore(stores.reviewPrs)
  const authoredPrs = fromStore(stores.authoredPrs)
  const ai = useAiThreadState(githubSync)
  const walkthroughs = useWalkthroughPolling(api, githubSync)
  const selection = useSelectedPrReview(api, githubSync, ai, walkthroughs)
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

  const openUrl = (url: string) => api.system.openUrl(url)
  const openSettings = () => api.navigation.navigate({ viewId: 'global_settings' })
  const setPendingComments = (value: ReviewSubmissionComment[]) => { pendingComments.current = value }
  const setAgentComments = (value: AgentReviewComment[]) => { agentComments.current = value }
  const setOverviewComments = (value: PrOverviewComment[]) => { overviewComments.current = value }

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
    filteredReviewPrs: list.filteredReviewPrs,
    filteredAuthoredPrs: list.filteredAuthoredPrs,
    allReviewPrs: reviewPrs.current,
    allAuthoredPrs: authoredPrs.current,
    hiddenReviewRepos: list.hiddenReviewRepos,
    hiddenAuthoredRepos: list.hiddenAuthoredRepos,
    groupedPrs: list.groupedPrs,
    groupedAuthoredPrs: list.groupedAuthoredPrs,
    flatPrList: list.flatPrList,
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
    onOpenAuthoredPr: openUrl,
    onStartTaskFromAuthoredPr: getContext().projectId ? list.startTaskFromAuthoredPr : undefined,
    pluralize: list.pluralize,
    walkthroughByPr: walkthroughs.byPr,
    onGenerateWalkthrough: walkthroughs.generate,
    onStopWalkthrough: walkthroughs.stop,
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
    agentReviewComments: agentComments.current,
    fileTreeVisible: selection.fileTreeVisible,
    reviewedFileShas: reviewedFiles.reviewedFileShas,
    includeNonApplicationFiles: selection.includeNonApplicationFiles,
    onToggleNonApplicationFiles: selection.setIncludeNonApplicationFiles,
    onBackToList: selection.backToList,
    onOpenPrOnGitHub: selection.openOnGitHub,
    onActiveTabChange: selection.setActiveTab,
    onOverviewCommentsChange: setOverviewComments,
    loadOverviewComments: selection.loadOverviewComments,
    fetchFileContents: selection.fetchFileContents,
    resolveRepositoryImage: selection.resolveRepositoryImage,
    resolveRemoteMedia: selection.resolveRemoteMedia,
    onToggleFileTree: selection.toggleFileTree,
    onPendingCommentsChange: setPendingComments,
    onAgentCommentsChange: setAgentComments,
    onUpdateAgentCommentStatus: selection.updateAgentCommentStatus,
    onToggleFileReviewed: reviewedFiles.toggle,
    walkthroughReady: walkthrough.available,
    aiThreads: ai.threads,
    aiThreadsPendingCount: ai.pendingCount,
    onAskAgent: ai.askAgent,
    onCommentNow: selection.commentNow,
    onReplyToThread: ai.replyToThread,
    onAskAboutComment: ai.askAboutComment,
    onReplyToExistingComment: selection.replyToExistingComment,
    pendingReplies: replies.current,
    onAddReplyToReview: selection.addReplyToReview,
    onRemovePendingReply: selection.removePendingReply,
    onAskAgentStep: ai.askAgentStep,
    onSendQuestionsToAgent: ai.sendQuestionsToAgent,
    onSubmitReview: selection.submitReview,
    onOpenUrl: openUrl,
  } : null)

  return {
    get list() { return listModel },
    get detail() { return detailModel },
    handleKeydown(event: KeyboardEvent) {
      if (list.handleFilterKeydown(event)) return
      if (selectedPr.current) selection.handleKeydown(event)
      else list.handleKeydown(event)
    },
  }
}

export type ReviewWorkspace = ReturnType<typeof createReviewWorkspace>
