<script lang="ts">
  import { untrack } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import {
    activeProjectId,
    agentReviewComments,
    authoredPrs,
    pendingManualComments,
    pendingReplies,
    prFileDiffs,
    prOverviewComments,
    reviewComments,
    reviewPrs,
    selectedReviewPr,
  } from '../../lib/stores'
  import PrReviewDetailSection from './PrReviewDetailSection.svelte'
  import PrReviewListSection from './PrReviewListSection.svelte'
  import { createGithubSyncPrReviewClient } from './githubSyncClient'
  import { useAiThreadState } from './useAiThreadState.svelte'
  import { usePrReviewListState } from './usePrReviewListState.svelte'
  import { useReviewedFilesState } from './useReviewedFilesState.svelte'
  import { useSelectedPrReview } from './useSelectedPrReview.svelte'
  import { useWalkthroughPolling } from './useWalkthroughPolling.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  let scope: 'repo' | 'global' = $derived.by(() => {
    const currentView = api.navigation.get().currentView
    return typeof currentView === 'string' && currentView.endsWith('pr_review_global')
      ? 'global'
      : 'repo'
  })

  const initialApi = untrack(() => api)
  const githubSync = untrack(() => createGithubSyncPrReviewClient(api))
  const aiThreadState = useAiThreadState(githubSync)
  const walkthroughState = useWalkthroughPolling(initialApi, githubSync)
  const selectedPrState = useSelectedPrReview(initialApi, githubSync, aiThreadState, walkthroughState)
  const reviewedFilesState = useReviewedFilesState(initialApi, () => projectId)
  const reviewListState = usePrReviewListState({
    api: initialApi,
    githubSync,
    getScope: () => scope,
    getProjectName: () => projectName,
    getProjectId: () => projectId,
    walkthroughs: walkthroughState,
    onSelectPr: (pr) => { void selectedPrState.select(pr) },
    onBackToList: selectedPrState.backToList,
  })

  $effect(() => {
    $activeProjectId = projectId
  })

  function handlePrReviewKeydown(event: KeyboardEvent): void {
    if (reviewListState.handleFilterKeydown(event)) return
    if ($selectedReviewPr) selectedPrState.handleKeydown(event)
    else reviewListState.handleKeydown(event)
  }
</script>

<svelte:window onkeydown={handlePrReviewKeydown} />

<div class="flex flex-col w-full h-full min-h-0 overflow-hidden">
  {#if $selectedReviewPr}
    <PrReviewDetailSection
      {api}
      {githubSync}
      pr={$selectedReviewPr}
      activeProjectId={$activeProjectId}
      activeTab={selectedPrState.activeTab}
      files={$prFileDiffs}
      isLoading={selectedPrState.isLoading}
      error={selectedPrState.error}
      reviewComments={$reviewComments}
      pendingManualComments={$pendingManualComments}
      overviewComments={$prOverviewComments}
      agentReviewComments={$agentReviewComments}
      fileTreeVisible={selectedPrState.fileTreeVisible}
      reviewedFileShas={reviewedFilesState.reviewedFileShas}
      includeNonApplicationFiles={selectedPrState.includeNonApplicationFiles}
      onToggleNonApplicationFiles={selectedPrState.setIncludeNonApplicationFiles}
      onBackToList={selectedPrState.backToList}
      onOpenPrOnGitHub={selectedPrState.openOnGitHub}
      onActiveTabChange={selectedPrState.setActiveTab}
      onOverviewCommentsChange={(comments) => { $prOverviewComments = comments }}
      loadOverviewComments={selectedPrState.loadOverviewComments}
      fetchFileContents={selectedPrState.fetchFileContents}
      resolveRepositoryImage={selectedPrState.resolveRepositoryImage}
      resolveRemoteMedia={selectedPrState.resolveRemoteMedia}
      onToggleFileTree={selectedPrState.toggleFileTree}
      onPendingCommentsChange={(comments) => { $pendingManualComments = comments }}
      onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
      onUpdateAgentCommentStatus={selectedPrState.updateAgentCommentStatus}
      onToggleFileReviewed={reviewedFilesState.toggle}
      walkthroughReady={walkthroughState.selectedReady}
      aiThreads={aiThreadState.threads}
      aiThreadsPendingCount={aiThreadState.pendingCount}
      onAskAgent={aiThreadState.askAgent}
      onCommentNow={selectedPrState.commentNow}
      onReplyToThread={aiThreadState.replyToThread}
      onAskAboutComment={aiThreadState.askAboutComment}
      onReplyToExistingComment={selectedPrState.replyToExistingComment}
      pendingReplies={$pendingReplies}
      onAddReplyToReview={selectedPrState.addReplyToReview}
      onRemovePendingReply={selectedPrState.removePendingReply}
      onAskAgentStep={aiThreadState.askAgentStep}
      onEditThread={aiThreadState.editThread}
      onDeleteThread={aiThreadState.deleteThread}
      onSendQuestionsToAgent={aiThreadState.sendQuestionsToAgent}
      onMarkThreadSeen={aiThreadState.markThreadSeen}
      stepLabelById={walkthroughState.selectedStepLabels}
      onSubmitReview={selectedPrState.submitReview}
      onOpenUrl={(url) => api.system.openUrl(url)}
    />
  {:else}
    <PrReviewListSection
      headerTitle={reviewListState.headerTitle}
      headerSubtitle={reviewListState.headerSubtitle}
      {projectName}
      showFilters={reviewListState.showFilters}
      projectHasNoRepo={reviewListState.projectHasNoRepo}
      excludedRepos={reviewListState.excludedRepos}
      showFilterDropdown={reviewListState.showFilterDropdown}
      newRepoInput={reviewListState.newRepoInput}
      suggestedRepos={reviewListState.suggestedRepos}
      isLoading={reviewListState.isLoading}
      isLoadingAuthored={reviewListState.isLoadingAuthored}
      error={reviewListState.error}
      authoredError={reviewListState.authoredError}
      githubTokenConfigured={reviewListState.githubTokenConfigured}
      filteredReviewPrs={reviewListState.filteredReviewPrs}
      filteredAuthoredPrs={reviewListState.filteredAuthoredPrs}
      allReviewPrs={$reviewPrs}
      allAuthoredPrs={$authoredPrs}
      hiddenReviewRepos={reviewListState.hiddenReviewRepos}
      hiddenAuthoredRepos={reviewListState.hiddenAuthoredRepos}
      groupedPrs={reviewListState.groupedPrs}
      groupedAuthoredPrs={reviewListState.groupedAuthoredPrs}
      flatPrList={reviewListState.flatPrList}
      focusedIndex={reviewListState.focusedIndex}
      onToggleFilterDropdown={() => reviewListState.setShowFilterDropdown(!reviewListState.showFilterDropdown)}
      onCloseFilterDropdown={() => reviewListState.setShowFilterDropdown(false)}
      onNewRepoInputChange={reviewListState.setNewRepoInput}
      onAddExcludedRepo={(repo) => { void reviewListState.addExcludedRepo(repo) }}
      onRemoveExcludedRepo={(repo) => { void reviewListState.removeExcludedRepo(repo) }}
      onRefreshPrs={() => { void reviewListState.refreshPrs() }}
      onRefreshAuthoredPrs={() => { void reviewListState.refreshAuthoredPrs() }}
      onOpenGithubSettings={() => { void api.navigation.navigate({ viewId: 'global_settings' }) }}
      onOpenRepositoryFilters={() => reviewListState.setShowFilterDropdown(true)}
      onSelectPr={(pr) => { void selectedPrState.select(pr) }}
      onMarkUnread={selectedPrState.markUnread}
      onOpenAuthoredPr={(url) => api.system.openUrl(url)}
      onStartTaskFromAuthoredPr={projectId ? reviewListState.startTaskFromAuthoredPr : undefined}
      pluralize={reviewListState.pluralize}
      walkthroughByPr={walkthroughState.byPr}
      onGenerateWalkthrough={(pr) => { void walkthroughState.generate(pr) }}
      onStopWalkthrough={(pr) => { void walkthroughState.stop(pr) }}
    />
  {/if}
</div>
