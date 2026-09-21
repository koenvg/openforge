<script lang="ts">
  import PrReviewListSection from '../../../plugins/github-sync/src/review/pr/PrReviewListSection.svelte'
  import {
    activeReviewRequest,
    closedReviewRequest,
    mergedReviewRequest,
    reviewedReviewRequest,
    updatedSinceReviewRequest,
  } from '../fixtures/githubSyncReviewFixtures'

  const needsReviewRequests = [activeReviewRequest, updatedSinceReviewRequest]
  const reviewedRequests = [reviewedReviewRequest]
  const finishedRequests = [mergedReviewRequest, closedReviewRequest]
  const allReviewRequests = [...needsReviewRequests, ...reviewedRequests, ...finishedRequests]
  const repository = 'openforge/openforge'
  const noOp = () => {}
</script>

<PrReviewListSection
  headerTitle="Pull Requests"
  headerSubtitle="Review requests and pull requests you authored"
  projectName="OpenForge"
  showFilters={false}
  projectHasNoRepo={false}
  excludedRepos={new Set()}
  showFilterDropdown={false}
  newRepoInput=""
  suggestedRepos={[]}
  isLoading={false}
  isLoadingAuthored={false}
  error={null}
  authoredError={null}
  reviewStatusError={null}
  githubTokenConfigured={true}
  reviewRequests={{
    needsReviewCount: needsReviewRequests.length,
    reviewedCount: reviewedRequests.length,
    filtered: allReviewRequests,
    finishedCount: finishedRequests.length,
    groupedNeedsReview: new Map([[repository, needsReviewRequests]]),
    groupedReviewed: new Map([[repository, reviewedRequests]]),
    groupedFinished: new Map([[repository, finishedRequests]]),
    keyboardNavigable: needsReviewRequests,
  }}
  filteredAuthoredPrs={[]}
  allReviewPrs={allReviewRequests}
  allAuthoredPrs={[]}
  hiddenReviewRepos={[]}
  hiddenAuthoredRepos={[]}
  groupedAuthoredPrs={new Map()}
  focusedIndex={-1}
  onToggleFilterDropdown={noOp}
  onCloseFilterDropdown={noOp}
  onNewRepoInputChange={noOp}
  onAddExcludedRepo={noOp}
  onRemoveExcludedRepo={noOp}
  onRefreshPrs={noOp}
  onRefreshAuthoredPrs={noOp}
  onOpenGithubSettings={noOp}
  onOpenRepositoryFilters={noOp}
  onSelectPr={noOp}
  onMarkUnread={noOp}
  onMarkReviewed={noOp}
  onMarkNeedsReview={noOp}
  onRemove={noOp}
  onOpenAuthoredPr={noOp}
  pluralize={(count, singular, plural = `${singular}s`) => count === 1 ? singular : plural}
/>
