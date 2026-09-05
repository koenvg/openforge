import { onDestroy, onMount } from 'svelte'
import { fromStore } from 'svelte/store'
import type { Disposable, FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type {
  AuthoredPullRequest,
  PrWalkthrough,
  ReviewPullRequest,
} from '@openforge-app/plugin-sdk/domain'
import { sortAuthoredPrs, sortDoNotReviewLast } from '@openforge-app/pr-review-ui/prSort'
import {
  authoredPrs,
  reviewPrs,
  selectedReviewPr,
} from '../../../lib/stores'
import { getHTMLElementAt, isInputFocused } from '../../../lib/domUtils'
import { useVimNavigation } from '../../../lib/useVimNavigation.svelte'
import { walkthroughButtonState } from '../../../lib/walkthroughButtonState'
import { walkthroughReadyFirst } from '../../../lib/reviewListSort'
import { composeRequestForAuthoredPr } from '../authoredPrTaskCompose'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'

type ReviewScope = 'repo' | 'global'

type WalkthroughListState = {
  readonly byPr: Map<number, PrWalkthrough | null>
  refreshVisible(prs: ReviewPullRequest[]): Promise<void>
}

type Options = {
  api: FrontendOpenForgeAPI
  githubSync: GithubSyncPrReviewClient
  getScope: () => ReviewScope
  getProjectName: () => string
  getProjectId: () => string | null
  walkthroughs: WalkthroughListState
  onSelectPr: (pr: ReviewPullRequest) => void
  onBackToList: () => void
}

export function usePrReviewListState(options: Options) {
  const authoredPullRequests = fromStore(authoredPrs)
  const pullRequests = fromStore(reviewPrs)
  const selectedPr = fromStore(selectedReviewPr)
  let isLoading = $state(false)
  let isLoadingAuthored = $state(false)
  let error = $state<string | null>(null)
  let authoredError = $state<string | null>(null)
  let githubTokenConfigured = $state<boolean | null>(null)
  let excludedRepos = $state<Set<string>>(new Set())
  let showFilterDropdown = $state(false)
  let newRepoInput = $state('')
  let scopedRepo = $state<string | null>(null)
  let repoResolutionLoaded = $state(false)
  const subscriptions: Disposable[] = []

  let scope = $derived(options.getScope())
  let showFilters = $derived(scope === 'global')
  let headerTitle = $derived(
    scope === 'global'
      ? 'All Pull Requests'
      : `${options.getProjectName()} — Pull Requests`,
  )
  let headerSubtitle = $derived(
    scope === 'global'
      ? 'Review open pull requests across all your repositories'
      : 'Review open pull requests for this project',
  )
  let projectHasNoRepo = $derived(scope === 'repo' && repoResolutionLoaded && !scopedRepo)

  function matchesScope(repoOwner: string, repoName: string): boolean {
    if (scope !== 'repo') return true
    if (!scopedRepo) return false
    return `${repoOwner}/${repoName}` === scopedRepo
  }

  function isRepoExcluded(repoOwner: string, repoName: string): boolean {
    return excludedRepos.has(`${repoOwner}/${repoName}`)
  }

  let filteredReviewPrs = $derived(
    pullRequests.current.filter(pr => (
      matchesScope(pr.repo_owner, pr.repo_name)
      && (!showFilters || !isRepoExcluded(pr.repo_owner, pr.repo_name))
    )),
  )
  let filteredAuthoredPrs = $derived(
    authoredPullRequests.current.filter(pr => (
      matchesScope(pr.repo_owner, pr.repo_name)
      && (!showFilters || !isRepoExcluded(pr.repo_owner, pr.repo_name))
    )),
  )
  let readyReviewPrIds = $derived(new Set(
    filteredReviewPrs
      .filter(pr => walkthroughButtonState(options.walkthroughs.byPr.get(pr.id), pr.head_sha) === 'ready')
      .map(pr => pr.id),
  ))
  let sortedReviewPrs = $derived(
    sortDoNotReviewLast(walkthroughReadyFirst(filteredReviewPrs, readyReviewPrIds)),
  )
  let sortedAuthoredPrs = $derived(filteredAuthoredPrs)
  let groupedPrs = $derived(groupByRepo(sortedReviewPrs))
  let groupedAuthoredPrs = $derived(groupAuthoredByRepo(sortedAuthoredPrs))
  let hiddenReviewRepos = $derived(showFilters ? getHiddenRepos(pullRequests.current) : [])
  let hiddenAuthoredRepos = $derived(showFilters ? getHiddenRepos(authoredPullRequests.current) : [])
  let suggestedRepos = $derived.by(() => {
    const repos = new Set<string>()
    for (const pr of pullRequests.current) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    for (const pr of authoredPullRequests.current) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    return [...repos].filter(repo => !excludedRepos.has(repo)).sort()
  })
  let flatPrList = $derived(sortedReviewPrs)

  const vimList = useVimNavigation({
    getItemCount: () => selectedPr.current ? 0 : flatPrList.length,
    onSelect: (index) => {
      const pr = flatPrList[index]
      if (pr) options.onSelectPr(pr)
    },
    onBack: () => {
      if (selectedPr.current) options.onBackToList()
    },
  })

  function groupByRepo(prs: ReviewPullRequest[]): Map<string, ReviewPullRequest[]> {
    const grouped = new Map<string, ReviewPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) ?? []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  function groupAuthoredByRepo(prs: AuthoredPullRequest[]): Map<string, AuthoredPullRequest[]> {
    const grouped = new Map<string, AuthoredPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) ?? []
      existing.push(pr)
      grouped.set(key, existing)
    }
    for (const [key, repoPrs] of grouped) grouped.set(key, sortAuthoredPrs(repoPrs))
    return grouped
  }

  function getHiddenRepos(prs: Array<ReviewPullRequest | AuthoredPullRequest>): string[] {
    const repos = new Set<string>()
    for (const pr of prs) {
      const repo = `${pr.repo_owner}/${pr.repo_name}`
      if (excludedRepos.has(repo)) repos.add(repo)
    }
    return [...repos].sort()
  }

  function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return count === 1 ? singular : plural
  }

  function formatUnknownError(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  function formatPrLoadError(kind: 'review' | 'authored', cause: unknown): string {
    const message = formatUnknownError(cause)
    if (message.toLowerCase().includes('github_token not configured')) {
      return 'No GitHub token is configured. Add a token in Global Settings, then retry.'
    }
    const label = kind === 'review' ? 'review requests' : 'authored pull requests'
    return `GitHub could not load ${label}: ${message}`
  }

  async function loadExcludedRepos(): Promise<void> {
    try {
      const value = await options.api.config.get<string>('pr_excluded_repos')
      if (!value) {
        excludedRepos = new Set()
        return
      }
      const parsed = JSON.parse(value)
      excludedRepos = new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      excludedRepos = new Set()
    }
  }

  async function persistExcludedRepos(next: Set<string>): Promise<void> {
    excludedRepos = next
    await options.api.config.set('pr_excluded_repos', JSON.stringify([...next].sort()))
  }

  async function addExcludedRepo(repo: string): Promise<void> {
    const trimmed = repo.trim()
    if (!trimmed || excludedRepos.has(trimmed)) return

    const next = new Set(excludedRepos)
    next.add(trimmed)
    await persistExcludedRepos(next)
    newRepoInput = ''
  }

  async function removeExcludedRepo(repo: string): Promise<void> {
    const next = new Set(excludedRepos)
    next.delete(repo)
    await persistExcludedRepos(next)
  }

  async function loadGithubConfiguration(): Promise<void> {
    try {
      const token = await options.api.config.get<string>('github_token')
      githubTokenConfigured = Boolean(token?.trim())
    } catch (cause) {
      console.error('Failed to load GitHub configuration:', cause)
      githubTokenConfigured = null
    }
  }

  async function loadPrs(): Promise<void> {
    isLoading = true
    error = null
    try {
      const prs = await options.githubSync.listReviewPullRequests()
      pullRequests.current = prs
      void options.walkthroughs.refreshVisible(prs)
    } catch (cause) {
      console.error('Failed to load PRs:', cause)
      error = formatPrLoadError('review', cause)
    } finally {
      isLoading = false
    }
  }

  async function refreshPrs(): Promise<void> {
    isLoading = true
    error = null
    try {
      const prs = await options.githubSync.refreshReviewPullRequests()
      pullRequests.current = prs
      void options.walkthroughs.refreshVisible(prs)
    } catch (cause) {
      console.error('Failed to refresh PRs:', cause)
      error = formatPrLoadError('review', cause)
    } finally {
      isLoading = false
    }
  }

  async function silentRefreshPrs(): Promise<void> {
    try {
      const prs = await options.githubSync.listReviewPullRequests()
      pullRequests.current = prs
      void options.walkthroughs.refreshVisible(prs)
    } catch (cause) {
      console.error('Failed to silently refresh PRs:', cause)
    }
  }

  async function loadAuthoredPrs(): Promise<void> {
    isLoadingAuthored = true
    authoredError = null
    try {
      authoredPullRequests.current = await options.githubSync.listAuthoredPullRequests()
    } catch (cause) {
      console.error('Failed to load authored PRs:', cause)
      authoredError = formatPrLoadError('authored', cause)
    } finally {
      isLoadingAuthored = false
    }
  }

  async function refreshAuthoredPrs(): Promise<void> {
    isLoadingAuthored = true
    authoredError = null
    try {
      authoredPullRequests.current = await options.githubSync.refreshAuthoredPullRequests()
    } catch (cause) {
      console.error('Failed to refresh authored PRs:', cause)
      authoredError = formatPrLoadError('authored', cause)
    } finally {
      isLoadingAuthored = false
    }
  }

  async function silentRefreshAuthoredPrs(): Promise<void> {
    try {
      authoredPullRequests.current = await options.githubSync.listAuthoredPullRequests()
    } catch (cause) {
      console.error('Failed to silently refresh authored PRs:', cause)
    }
  }

  function startTaskFromAuthoredPr(pr: AuthoredPullRequest): void {
    const projectId = options.getProjectId()
    if (!projectId) return
    void options.api.tasks.compose(composeRequestForAuthoredPr(projectId, pr)).catch((cause) => {
      console.error('Failed to compose a task from the pull request:', cause)
    })
  }

  function handleFilterKeydown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape' || !showFilterDropdown) return false
    event.preventDefault()
    showFilterDropdown = false
    return true
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isInputFocused()) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    vimList.handleKeydown(event)
  }

  $effect(() => {
    void loadExcludedRepos()
  })

  $effect(() => {
    const projectId = options.getProjectId()
    if (scope === 'repo' && projectId) {
      repoResolutionLoaded = false
      options.api.projectConfig.get<string>('resolved_repo', projectId).then((value) => {
        scopedRepo = typeof value === 'string' && value.includes('/') ? value : null
        repoResolutionLoaded = true
      }).catch(() => {
        scopedRepo = null
        repoResolutionLoaded = true
      })
    } else {
      scopedRepo = null
      repoResolutionLoaded = true
    }
  })

  $effect(() => {
    if (selectedPr.current) return
    const items = document.querySelectorAll('[data-vim-pr-item]')
    getHTMLElementAt(items, vimList.focusedIndex)?.scrollIntoView?.({ block: 'nearest' })
  })

  onMount(() => {
    void loadGithubConfiguration()
    void loadPrs()
    void loadAuthoredPrs()
    subscriptions.push(options.githubSync.onAuthoredPullRequestsUpdated(() => {
      void silentRefreshAuthoredPrs()
    }))
    subscriptions.push(options.githubSync.onReviewPullRequestCountChanged(() => {
      void silentRefreshPrs()
    }))
  })

  onDestroy(() => {
    for (const subscription of subscriptions) void subscription.dispose()
  })

  return {
    get headerTitle() { return headerTitle },
    get headerSubtitle() { return headerSubtitle },
    get showFilters() { return showFilters },
    get projectHasNoRepo() { return projectHasNoRepo },
    get excludedRepos() { return excludedRepos },
    get showFilterDropdown() { return showFilterDropdown },
    get newRepoInput() { return newRepoInput },
    get suggestedRepos() { return suggestedRepos },
    get isLoading() { return isLoading },
    get isLoadingAuthored() { return isLoadingAuthored },
    get error() { return error },
    get authoredError() { return authoredError },
    get githubTokenConfigured() { return githubTokenConfigured },
    get filteredReviewPrs() { return filteredReviewPrs },
    get filteredAuthoredPrs() { return filteredAuthoredPrs },
    get hiddenReviewRepos() { return hiddenReviewRepos },
    get hiddenAuthoredRepos() { return hiddenAuthoredRepos },
    get groupedPrs() { return groupedPrs },
    get groupedAuthoredPrs() { return groupedAuthoredPrs },
    get flatPrList() { return flatPrList },
    get focusedIndex() { return vimList.focusedIndex },
    setShowFilterDropdown: (value: boolean) => { showFilterDropdown = value },
    setNewRepoInput: (value: string) => { newRepoInput = value },
    addExcludedRepo,
    removeExcludedRepo,
    refreshPrs,
    refreshAuthoredPrs,
    startTaskFromAuthoredPr,
    handleFilterKeydown,
    handleKeydown,
    pluralize,
  }
}
