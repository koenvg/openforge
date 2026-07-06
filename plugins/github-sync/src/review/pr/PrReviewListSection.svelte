<script lang="ts">
  import type { AuthoredPullRequest, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import AuthoredPrCard from '@openforge-app/pr-review-ui/AuthoredPrCard.svelte'
  import ReviewPrCard from '@openforge-app/pr-review-ui/ReviewPrCard.svelte'
  import ProjectPageHeader from '../../project/ProjectPageHeader.svelte'
  import RepositoryFilterSection from './RepositoryFilterSection.svelte'

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
    onOpenAuthoredPr: (url: string) => void
    pluralize: (count: number, singular: string, plural?: string) => string
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
    onOpenAuthoredPr,
    pluralize,
  }: Props = $props()
</script>

<div class="flex flex-col h-full overflow-hidden">
  <ProjectPageHeader
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
  </ProjectPageHeader>

  {#if projectHasNoRepo}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/70 text-center p-8">
      <div class="badge badge-ghost badge-lg">Not linked</div>
      <h3 class="text-xl font-semibold text-base-content m-0">This project isn't linked to a GitHub repository</h3>
      <p class="text-sm m-0 max-w-md">{projectName} has no GitHub remote, so there are no pull requests to show here. Open <span class="font-medium">All Pull Requests</span> to review pull requests across all your repositories.</p>
    </div>
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
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
              <span class="loading loading-spinner loading-md text-primary"></span>
              <span>Loading PRs...</span>
            </div>
          {:else if error}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5" role="alert">
              <div class="badge badge-error badge-lg">Sync issue</div>
              <h3 class="text-xl font-semibold text-base-content m-0">Unable to load review requests</h3>
              <p class="text-sm m-0 max-w-md text-base-content/70">{error}</p>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button class="btn btn-primary btn-sm" onclick={onRefreshPrs}>Retry loading review requests</button>
                <button class="btn btn-ghost btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              </div>
            </div>
          {:else if filteredReviewPrs.length === 0 && allReviewPrs.length > 0 && hiddenReviewRepos.length > 0}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-warning badge-lg">Filtered</div>
              <h3 class="text-xl font-semibold text-base-content m-0">All review requests are hidden by filters</h3>
              <p class="text-sm m-0 max-w-md">
                {allReviewPrs.length} {pluralize(allReviewPrs.length, 'PR')} from {hiddenReviewRepos.join(', ')} {pluralize(hiddenReviewRepos.length, 'is', 'are')} currently unchecked for this project.
              </p>
              <button class="btn btn-primary btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>
            </div>
          {:else if filteredReviewPrs.length === 0 && githubTokenConfigured === false}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-warning badge-lg">Not connected</div>
              <h3 class="text-xl font-semibold text-base-content m-0">Connect GitHub to check review requests</h3>
              <p class="text-sm m-0 max-w-md">No GitHub token is configured, so OpenForge cannot check review requests for {projectName}.</p>
              <button class="btn btn-primary btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
            </div>
          {:else if filteredReviewPrs.length === 0}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-success badge-lg">Checked</div>
              <h3 class="text-xl font-semibold text-base-content m-0">No PRs requesting your review</h3>
              <p class="text-sm m-0 max-w-md">GitHub is connected for {projectName}. Sync again if you expected review requests, or check repository filters for hidden repos.</p>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button class="btn btn-primary btn-sm" onclick={onRefreshPrs}>Sync review requests</button>
                {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>{/if}
              </div>
            </div>
          {:else}
            {#each [...groupedPrs.entries()] as [repo, prs]}
              <div class="mb-6">
                <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                <div class="flex flex-col gap-3">
                  {#each prs as pr}
                    {@const flatIdx = flatPrList.indexOf(pr)}
                    <div data-vim-pr-item class={flatIdx === focusedIndex ? 'vim-focus' : ''}>
                      <ReviewPrCard
                        {pr}
                        selected={false}
                        onClick={() => onSelectPr(pr)}
                      />
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
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
              <span class="loading loading-spinner loading-md text-primary"></span>
              <span>Loading PRs...</span>
            </div>
          {:else if authoredError}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5" role="alert">
              <div class="badge badge-error badge-lg">Sync issue</div>
              <h3 class="text-xl font-semibold text-base-content m-0">Unable to load your pull requests</h3>
              <p class="text-sm m-0 max-w-md text-base-content/70">{authoredError}</p>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button class="btn btn-primary btn-sm" onclick={onRefreshAuthoredPrs}>Retry loading your pull requests</button>
                <button class="btn btn-ghost btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
              </div>
            </div>
          {:else if filteredAuthoredPrs.length === 0 && allAuthoredPrs.length > 0 && hiddenAuthoredRepos.length > 0}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-warning badge-lg">Filtered</div>
              <h3 class="text-xl font-semibold text-base-content m-0">All authored PRs are hidden by filters</h3>
              <p class="text-sm m-0 max-w-md">
                {allAuthoredPrs.length} {pluralize(allAuthoredPrs.length, 'PR')} from {hiddenAuthoredRepos.join(', ')} {pluralize(hiddenAuthoredRepos.length, 'is', 'are')} currently unchecked for this project.
              </p>
              <button class="btn btn-primary btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>
            </div>
          {:else if filteredAuthoredPrs.length === 0 && githubTokenConfigured === false}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-warning badge-lg">Not connected</div>
              <h3 class="text-xl font-semibold text-base-content m-0">Connect GitHub to check your PRs</h3>
              <p class="text-sm m-0 max-w-md">No GitHub token is configured, so OpenForge cannot check pull requests authored by your account.</p>
              <button class="btn btn-primary btn-sm" onclick={onOpenGithubSettings}>Open GitHub settings</button>
            </div>
          {:else if filteredAuthoredPrs.length === 0}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
              <div class="badge badge-success badge-lg">Checked</div>
              <h3 class="text-xl font-semibold text-base-content m-0">No open pull requests</h3>
              <p class="text-sm m-0 max-w-md">GitHub is connected for your account. Sync again if you expected authored PRs, or check repository filters for hidden repos.</p>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button class="btn btn-primary btn-sm" onclick={onRefreshAuthoredPrs}>Sync my pull requests</button>
                {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={onOpenRepositoryFilters}>Review repository filters</button>{/if}
              </div>
            </div>
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
