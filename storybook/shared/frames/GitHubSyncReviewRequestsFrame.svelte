<script lang="ts">
  import PrReviewListSection from '../../../plugins/github-sync/src/review/pr/PrReviewListSection.svelte'
  import {
    activeReviewRequest,
    closedReviewRequest,
    mergedReviewRequest,
    viewedReviewRequest,
  } from '../fixtures/githubSyncReviewFixtures'

  const activeRequests = [activeReviewRequest, viewedReviewRequest]
  const finishedRequests = [mergedReviewRequest, closedReviewRequest]
  const allReviewRequests = [...activeRequests, ...finishedRequests]
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
  githubTokenConfigured={true}
  reviewRequests={{
    activeCount: activeRequests.length,
    filtered: allReviewRequests,
    finishedCount: finishedRequests.length,
    groupedActive: new Map([[repository, activeRequests]]),
    groupedFinished: new Map([[repository, finishedRequests]]),
    keyboardNavigable: activeRequests,
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
  onRemove={noOp}
  onOpenAuthoredPr={noOp}
  pluralize={(count, singular, plural = `${singular}s`) => count === 1 ? singular : plural}
  walkthroughByPr={new Map()}
  canGenerateWalkthrough={() => true}
  onGenerateWalkthrough={noOp}
  onStopWalkthrough={noOp}
/>
