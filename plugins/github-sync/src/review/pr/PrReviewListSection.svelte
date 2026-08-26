<script lang="ts">
  import type { AuthoredPullRequest, PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import AuthoredPrCard from '@openforge-app/pr-review-ui/AuthoredPrCard.svelte'
  import ReviewPrCard from '@openforge-app/pr-review-ui/ReviewPrCard.svelte'
  import RepositoryFilterSection from './RepositoryFilterSection.svelte'
  import PrWalkthroughButton from './PrWalkthroughButton.svelte'
  import { walkthroughButtonState } from '../../lib/walkthroughButtonState'

  interface Props {
    headerTitle: string
    headerSubtitle: string
    projectName: string
    showFilters: boolean
    projectHasNoRepo: boolean
    excludedRepos: Set<string>
    showFilterDropdown: boolean
    newRepoInput: string
    suggestedRepos: string[]
    isLoading: boolean
    isLoadingAuthored: boolean
    error: string | null
    authoredError: string | null
    githubTokenConfigured: boolean | null
    filteredReviewPrs: ReviewPullRequest[]
    filteredAuthoredPrs: AuthoredPullRequest[]
    allReviewPrs: ReviewPullRequest[]
    allAuthoredPrs: AuthoredPullRequest[]
    hiddenReviewRepos: string[]
    hiddenAuthoredRepos: string[]
    groupedPrs: Map<string, ReviewPullRequest[]>
    groupedAuthoredPrs: Map<string, AuthoredPullRequest[]>
    flatPrList: ReviewPullRequest[]
    focusedIndex: number
    onToggleFilterDropdown: () => void
    onCloseFilterDropdown: () => void
    onNewRepoInputChange: (value: string) => void
    onAddExcludedRepo: (repo: string) => void
    onRemoveExcludedRepo: (repo: string) => void
    onRefreshPrs: () => void
    onRefreshAuthoredPrs: () => void
    onOpenGithubSettings: () => void
    onOpenRepositoryFilters: () => void
    onSelectPr: (pr: ReviewPullRequest) => void
    onMarkUnread: (pr: ReviewPullRequest) => void
    onOpenAuthoredPr: (url: string) => void
    pluralize: (count: number, singular: string, plural?: string) => string
    // Per-PR walkthrough status (owned by PrReviewView) and the trigger to start
    // a background walkthrough+AI-review generation from the card. Optional so the
    // list renders (all cards 'idle') before the parent wires generation.
    walkthroughByPr?: Map<number, PrWalkthrough | null>
    onGenerateWalkthrough?: (pr: ReviewPullRequest) => void
  }

  let {
    headerTitle,
    headerSubtitle,
    projectName,
    showFilters,
    projectHasNoRepo,
    excludedRepos,
    showFilterDropdown,
    newRepoInput,
    suggestedRepos,
    isLoading,
    isLoadingAuthored,
    error,
    authoredError,
    githubTokenConfigured,
    filteredReviewPrs,
    filteredAuthoredPrs,
    allReviewPrs,
    allAuthoredPrs,
    hiddenReviewRepos,
    hiddenAuthoredRepos,
    groupedPrs,
    groupedAuthoredPrs,
    flatPrList,
    focusedIndex,
    onToggleFilterDropdown,
    onCloseFilterDropdown,
    onNewRepoInputChange,
    onAddExcludedRepo,
    onRemoveExcludedRepo,
    onRefreshPrs,
    onRefreshAuthoredPrs,
    onOpenGithubSettings,
    onOpenRepositoryFilters,
    onSelectPr,
    onMarkUnread,
    onOpenAuthoredPr,
    pluralize,
    walkthroughByPr = new Map(),
    onGenerateWalkthrough = () => {},
  }: Props = $props()
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PluginPageHeader
    title={headerTitle}
    subtitle={headerSubtitle}
  >
    {#snippet actions()}
      {#if showFilters}
        <RepositoryFilterSection
          {excludedRepos}
          {showFilterDropdown}
          {newRepoInput}
          {suggestedRepos}
          onToggleDropdown={onToggleFilterDropdown}
          onCloseDropdown={onCloseFilterDropdown}
          onNewRepoInputChange={onNewRepoInputChange}
          onAddExcludedRepo={onAddExcludedRepo}
          onRemoveExcludedRepo={onRemoveExcludedRepo}
        />
      {/if}
    {/snippet}
  </PluginPageHeader>

  {#if projectHasNoRepo}
    <PluginViewState
      empty
      emptyTitle="This project isn't linked to a GitHub repository"
      emptyDescription={`${projectName} has no GitHub remote, so there are no pull requests to show here. Open All Pull Requests to review pull requests across all your repositories.`}
    />
  {:else}
    <div class="flex flex-1 overflow-hidden">
      <div class="flex-1 flex flex-col overflow-hidden border-r border-base-300">
        <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold text-base-content m-0">Review Requests</h3>
            <span class="badge badge-primary badge-xs">{filteredReviewPrs.length}</span>
          </div>
          <button class="btn btn-xs btn-ghost text-base-content/50" aria-label="Refresh review requests" onclick={onRefreshPrs} disabled={isLoading}>
            {isLoading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 pb-8">
          {#if isLoading && filteredReviewPrs.length === 0}
            <PluginViewState loading loadingLabel="Loading PRs..." />
          {:else if error}
            <PluginViewState error={error} errorTitle="Unable to load review requests">
              {#snippet errorActions()}
                <button class="btn btn-primary btn-sm" onclick={onRefreshPrs}>Retry loading review requests</button>
                <button class="btn btn-ghost btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredReviewPrs.length === 0 && allReviewPrs.length > 0 && hiddenReviewRepos.length > 0}
            <PluginViewState
              empty
              emptyTitle="All review requests are hidden by filters"
              emptyDescription={`${allReviewPrs.length} ${pluralize(allReviewPrs.length, 'PR')} from ${hiddenReviewRepos.join(', ')} ${pluralize(hiddenReviewRepos.length, 'is', 'are')} currently unchecked for this project.`}
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredReviewPrs.length === 0 && githubTokenConfigured === false}
            <PluginViewState
              empty
              emptyTitle="Connect GitHub to check review requests"
              emptyDescription={`No GitHub token is configured, so OpenForge cannot check review requests for ${projectName}.`}
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredReviewPrs.length === 0}
            <PluginViewState
              empty
              emptyTitle="No PRs requesting your review"
              emptyDescription={`GitHub is connected for ${projectName}. Sync again if you expected review requests, or check repository filters for hidden repos.`}
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onRefreshPrs}>Sync review requests</button>
                {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>{/if}
              {/snippet}
            </PluginViewState>
          {:else}
            {#each [...groupedPrs.entries()] as [repo, prs]}
              <div class="mb-6">
                <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                <div class="flex flex-col gap-3">
                  {#each prs as pr}
                    {@const flatIdx = flatPrList.indexOf(pr)}
                    {@const wtState = walkthroughButtonState(walkthroughByPr.get(pr.id), pr.head_sha)}
                    <div data-vim-pr-item class={flatIdx === focusedIndex ? 'vim-focus' : ''}>
                      <ReviewPrCard
                        {pr}
                        selected={false}
                        onClick={() => onSelectPr(pr)}
                        onMarkUnread={() => onMarkUnread(pr)}
                      >
                        {#snippet footer()}
                          <div class="pt-1">
                            <PrWalkthroughButton state={wtState} onGenerate={() => onGenerateWalkthrough(pr)} />
                          </div>
                        {/snippet}
                      </ReviewPrCard>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold text-base-content m-0">My Pull Requests</h3>
            <span class="badge badge-primary badge-xs">{filteredAuthoredPrs.length}</span>
          </div>
          <button class="btn btn-xs btn-ghost text-base-content/50" aria-label="Refresh authored pull requests" onclick={onRefreshAuthoredPrs} disabled={isLoadingAuthored}>
            {isLoadingAuthored ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 pb-8">
          {#if isLoadingAuthored && filteredAuthoredPrs.length === 0}
            <PluginViewState loading loadingLabel="Loading PRs..." />
          {:else if authoredError}
            <PluginViewState error={authoredError} errorTitle="Unable to load your pull requests">
              {#snippet errorActions()}
                <button class="btn btn-primary btn-sm" onclick={onRefreshAuthoredPrs}>Retry loading your pull requests</button>
                <button class="btn btn-ghost btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredAuthoredPrs.length === 0 && allAuthoredPrs.length > 0 && hiddenAuthoredRepos.length > 0}
            <PluginViewState
              empty
              emptyTitle="All authored PRs are hidden by filters"
              emptyDescription={`${allAuthoredPrs.length} ${pluralize(allAuthoredPrs.length, 'PR')} from ${hiddenAuthoredRepos.join(', ')} ${pluralize(hiddenAuthoredRepos.length, 'is', 'are')} currently unchecked for this project.`}
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredAuthoredPrs.length === 0 && githubTokenConfigured === false}
            <PluginViewState
              empty
              emptyTitle="Connect GitHub to check your PRs"
              emptyDescription="No GitHub token is configured, so OpenForge cannot check pull requests authored by your account."
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              {/snippet}
            </PluginViewState>
          {:else if filteredAuthoredPrs.length === 0}
            <PluginViewState
              empty
              emptyTitle="No open pull requests"
              emptyDescription="GitHub is connected for your account. Sync again if you expected authored PRs, or check repository filters for hidden repos."
            >
              {#snippet emptyActions()}
                <button class="btn btn-primary btn-sm" onclick={onRefreshAuthoredPrs}>Sync my pull requests</button>
                {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>{/if}
              {/snippet}
            </PluginViewState>
          {:else}
            {#each [...groupedAuthoredPrs.entries()] as [repo, prs]}
              <div class="mb-6">
                <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                <div class="flex flex-col gap-3">
                  {#each prs as pr}
                    <AuthoredPrCard
                      {pr}
                      selected={false}
                      onClick={() => onOpenAuthoredPr(pr.html_url)}
                    />
                  {/each}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
