<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { Disposable, FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  type UnlistenFn = Disposable
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewComments, pendingManualComments, prOverviewComments, agentReviewComments, authoredPrs, activeProjectId, pendingReviewPrOpen } from '../../lib/stores'
  import { getHTMLElementAt, isInputFocused } from '../../lib/domUtils'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { sortDoNotReviewLast } from '@openforge-app/pr-review-ui/prSort'
  import PrReviewDetailSection from './PrReviewDetailSection.svelte'
  import PrReviewListSection from './PrReviewListSection.svelte'
  import type { ReviewPullRequest, AuthoredPullRequest, PrFileDiff, PrOverviewComment, ReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
  import { createGithubSyncPrReviewClient } from './githubSyncClient'
  import {
    getPrReviewFilesKey,
    loadPrReviewedFileShas,
    persistPrReviewedFileShas,
    prunePrReviewedFileShas,
    reviewedFileMapsEqual,
    updatePrReviewedFileShas,
  } from './reviewedFilesState'
  import { isImageFileDiff, type FileContents } from '@openforge-app/pr-review-ui/diffAdapter'

  type PrDetailTab = 'overview' | 'files' | 'walkthrough'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  // The same component backs two views: the per-repo "Pull Requests" view
  // (scope 'repo') and the "All Pull Requests" view (scope 'global'). Derive the
  // scope from the navigation snapshot reactively so this does not rely on a
  // one-time capture of api/navigation state at component initialization.
  let scope: 'repo' | 'global' = $derived.by(() => {
    const currentView = api.navigation.get().currentView
    return typeof currentView === 'string' && currentView.endsWith('pr_review_global')
      ? 'global'
      : 'repo'
  })
  // The repo-exclusion filter only makes sense for the all-repos view. The
  // per-repo view is already scoped to a single repo, so its filter control is
  // hidden and exclusions are not applied.
  let showFilters = $derived(scope === 'global')
  // The all-repos view spans every repository, so its header must not be tied to
  // the active project's name.
  let headerTitle = $derived(scope === 'global' ? 'All Pull Requests' : `${projectName} — Pull Requests`)
  let headerSubtitle = $derived(
    scope === 'global'
      ? 'Review open pull requests across all your repositories'
      : 'Review open pull requests for this project',
  )
  let githubSync = $derived(createGithubSyncPrReviewClient(api))

  $effect(() => {
    $activeProjectId = projectId
  })

  let isLoading = $state(false)
  let isLoadingAuthored = $state(false)
  let error = $state<string | null>(null)
  let authoredError = $state<string | null>(null)
  let githubTokenConfigured = $state<boolean | null>(null)
  let fileTreeVisible = $state(true)
  let activeTab = $state<PrDetailTab>('overview')
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let loadedReviewedFilesKey = $state<string | null>(null)
  let reviewedFilesLoadSequence = 0
  let prDetailsLoadSequence = 0
  let unlisteners: UnlistenFn[] = []

  // Repo filtering
  let excludedRepos = $state<Set<string>>(new Set())
  let showFilterDropdown = $state(false)

  // The repo-exclusion filter is a single GLOBAL list (not per-project), so the "All
  // Pull Requests" view and its sidebar badge are independent of the active project.
  async function loadExcludedRepos() {
    try {
      const val = await api.config.get<string>('pr_excluded_repos')
      if (!val) {
        excludedRepos = new Set()
        return
      }
      const parsed = JSON.parse(val)
      excludedRepos = new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      excludedRepos = new Set()
    }
  }
  $effect(() => {
    void loadExcludedRepos()
  })

  function isRepoExcluded(repoOwner: string, repoName: string): boolean {
    return excludedRepos.has(`${repoOwner}/${repoName}`)
  }

  // When scope === 'repo', restrict the lists to the active project's repo. The
  // sidecar resolves it from the project's git origin into the 'resolved_repo'
  // project config.
  let scopedRepo = $state<string | null>(null)
  // Whether the repo-scope resolution has finished, so we can distinguish "still
  // resolving" from "resolved to no repo" and avoid flashing the not-linked message.
  let repoResolutionLoaded = $state(false)
  $effect(() => {
    const pid = $activeProjectId
    if (scope === 'repo' && pid) {
      repoResolutionLoaded = false
      api.projectConfig.get<string>('resolved_repo', pid).then((val) => {
        scopedRepo = typeof val === 'string' && val.includes('/') ? val : null
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

  // A per-repo view whose project has no resolved GitHub repo (e.g. a project with no
  // remote): render an explanatory message instead of PR columns.
  let projectHasNoRepo = $derived(scope === 'repo' && repoResolutionLoaded && !scopedRepo)

  function matchesScope(repoOwner: string, repoName: string): boolean {
    // The all-repos view spans every repository.
    if (scope !== 'repo') return true
    // A per-repo view whose project has no resolved GitHub repo (e.g. a project with
    // no remote) shows nothing — never other repos' PRs.
    if (!scopedRepo) return false
    return `${repoOwner}/${repoName}` === scopedRepo
  }

  let filteredReviewPrs = $derived($reviewPrs.filter(pr => matchesScope(pr.repo_owner, pr.repo_name) && (!showFilters || !isRepoExcluded(pr.repo_owner, pr.repo_name))))
  let filteredAuthoredPrs = $derived($authoredPrs.filter(pr => matchesScope(pr.repo_owner, pr.repo_name) && (!showFilters || !isRepoExcluded(pr.repo_owner, pr.repo_name))))

  // PRs labeled "DO NOT REVIEW" always sort to the bottom of their list (reviewed & authored).
  let sortedReviewPrs = $derived(sortDoNotReviewLast(filteredReviewPrs))
  let sortedAuthoredPrs = $derived(sortDoNotReviewLast(filteredAuthoredPrs))

  // Text input for manually adding repos
  let newRepoInput = $state('')

  // Suggested repos from current PRs that aren't already excluded
  let suggestedRepos = $derived(() => {
    const repos = new Set<string>()
    for (const pr of $reviewPrs) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    for (const pr of $authoredPrs) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    return [...repos].filter(r => !excludedRepos.has(r)).sort()
  })

  async function persistExcludedRepos(newExcluded: Set<string>) {
    excludedRepos = newExcluded
    const arr = [...newExcluded].sort()
    await api.config.set('pr_excluded_repos', JSON.stringify(arr))
  }

  async function addExcludedRepo(repo: string) {
    const trimmed = repo.trim()
    if (!trimmed || excludedRepos.has(trimmed)) return
    const newExcluded = new Set(excludedRepos)
    newExcluded.add(trimmed)
    await persistExcludedRepos(newExcluded)
    newRepoInput = ''
  }

  async function removeExcludedRepo(repo: string) {
    const newExcluded = new Set(excludedRepos)
    newExcluded.delete(repo)
    await persistExcludedRepos(newExcluded)
  }

  // Flat PR list for vim navigation
  let flatPrList = $derived(sortedReviewPrs)

  const vimList = useVimNavigation({
    getItemCount: () => $selectedReviewPr ? 0 : flatPrList.length,
    onSelect: (index) => {
      const pr = flatPrList[index]
      if (pr) selectPr(pr)
    },
    onBack: () => {
      if ($selectedReviewPr) backToList()
    },
  })

  function handlePrReviewKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showFilterDropdown) {
      e.preventDefault()
      showFilterDropdown = false
      return
    }
    // ⌘/Ctrl + 1/2/3 switch the PR detail tabs (Overview / Files changed / Walkthrough),
    // matching the app's ⌘-based navigation. Works regardless of input focus.
    if ($selectedReviewPr && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      if (e.key === '1') {
        e.preventDefault()
        activeTab = 'overview'
        return
      }
      if (e.key === '2') {
        e.preventDefault()
        activeTab = 'files'
        return
      }
      if (e.key === '3') {
        e.preventDefault()
        activeTab = 'walkthrough'
        return
      }
    }

    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    // Detail mode
    if ($selectedReviewPr) {
      if (e.key === 'Escape' || e.key === 'q') {
        e.preventDefault()
        backToList()
        return
      }
      return
    }

    // List mode — delegate to vim navigation
    vimList.handleKeydown(e)
  }

  // Scroll focused PR into view
  $effect(() => {
    if ($selectedReviewPr) return
    const idx = vimList.focusedIndex
    const items = document.querySelectorAll('[data-vim-pr-item]')
    const el = getHTMLElementAt(items, idx)
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  let groupedPrs = $derived(groupByRepo(sortedReviewPrs))
  let groupedAuthoredPrs = $derived(groupAuthoredByRepo(sortedAuthoredPrs))
  let hiddenReviewRepos = $derived(showFilters ? getHiddenRepos($reviewPrs) : [])
  let hiddenAuthoredRepos = $derived(showFilters ? getHiddenRepos($authoredPrs) : [])

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

  function formatUnknownError(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  function formatPrLoadError(scope: 'review' | 'authored', e: unknown): string {
    const message = formatUnknownError(e)
    if (message.toLowerCase().includes('github_token not configured')) {
      return 'No GitHub token is configured. Add a token in Global Settings, then retry.'
    }
    const label = scope === 'review' ? 'review requests' : 'authored pull requests'
    return `GitHub could not load ${label}: ${message}`
  }

  function openGithubSettings() {
    void api.navigation.navigate({ viewId: 'global_settings' })
  }

  function openRepositoryFilters() {
    showFilterDropdown = true
  }

  async function loadGithubConfiguration() {
    try {
      const token = await api.config.get<string>('github_token')
      githubTokenConfigured = Boolean(token?.trim())
    } catch (e) {
      console.error('Failed to load GitHub configuration:', e)
      githubTokenConfigured = null
    }
  }

  function groupByRepo(prs: ReviewPullRequest[]): Map<string, ReviewPullRequest[]> {
    const grouped = new Map<string, ReviewPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) || []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  function groupAuthoredByRepo(prs: AuthoredPullRequest[]): Map<string, AuthoredPullRequest[]> {
    const grouped = new Map<string, AuthoredPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) || []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  function getReviewedFilesStorageScope() {
    return projectId ? api.storage.project(projectId) : api.storage.global
  }

  async function hydrateReviewedFiles(pr: ReviewPullRequest) {
    const prKey = getPrReviewFilesKey(pr)
    const sequence = ++reviewedFilesLoadSequence
    const storedReviewedFileShas = await loadPrReviewedFileShas(getReviewedFilesStorageScope(), prKey)
    if (sequence !== reviewedFilesLoadSequence) return
    if (!$selectedReviewPr || getPrReviewFilesKey($selectedReviewPr) !== prKey) return
    reviewedFileShas = storedReviewedFileShas
    loadedReviewedFilesKey = prKey
  }

  async function persistReviewedFiles(prKey: string, nextReviewedFileShas: Map<string, string>) {
    await persistPrReviewedFileShas(getReviewedFilesStorageScope(), prKey, nextReviewedFileShas)
  }

  function handleToggleFileReviewed(file: PrFileDiff, reviewed: boolean) {
    const pr = $selectedReviewPr
    if (!pr) return

    const prKey = getPrReviewFilesKey(pr)
    reviewedFilesLoadSequence += 1
    const nextReviewedFileShas = updatePrReviewedFileShas(reviewedFileShas, file, reviewed)
    reviewedFileShas = nextReviewedFileShas
    loadedReviewedFilesKey = prKey
    void persistReviewedFiles(prKey, nextReviewedFileShas)
  }

  $effect(() => {
    const pr = $selectedReviewPr
    if (!pr) {
      reviewedFilesLoadSequence += 1
      loadedReviewedFilesKey = null
      reviewedFileShas = new Map()
      return
    }

    const prKey = getPrReviewFilesKey(pr)
    if (loadedReviewedFilesKey === prKey) return

    reviewedFileShas = new Map()
    loadedReviewedFilesKey = null
    void hydrateReviewedFiles(pr)
  })

  $effect(() => {
    const pr = $selectedReviewPr
    if (!pr || loadedReviewedFilesKey !== getPrReviewFilesKey(pr) || $prFileDiffs.length === 0) return

    const prunedReviewedFileShas = prunePrReviewedFileShas(reviewedFileShas, $prFileDiffs)
    if (reviewedFileMapsEqual(reviewedFileShas, prunedReviewedFileShas)) return

    reviewedFileShas = prunedReviewedFileShas
    void persistReviewedFiles(loadedReviewedFilesKey, prunedReviewedFileShas)
  })

  // Consume a host request to open a specific PR (from the "Needs your attention"
  // dialog). Clear the store before loading so this doesn't re-fire on its own writes.
  $effect(() => {
    const pr = $pendingReviewPrOpen
    if (!pr) return
    $pendingReviewPrOpen = null
    void openPrDetail(pr)
  })

  async function loadPrs() {
    isLoading = true
    error = null
    try {
      const prs = await githubSync.listReviewPullRequests()
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to load PRs:', e)
      error = formatPrLoadError('review', e)
    } finally {
      isLoading = false
    }
  }

  async function refreshPrs() {
    isLoading = true
    error = null
    try {
      const prs = await githubSync.refreshReviewPullRequests()
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to refresh PRs:', e)
      error = formatPrLoadError('review', e)
    } finally {
      isLoading = false
    }
  }

  /** Silently update PR store from DB without showing loading state. Used by background sync events. */
  async function silentRefreshPrs() {
    try {
      const prs = await githubSync.listReviewPullRequests()
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh PRs:', e)
    }
  }

  async function loadAuthoredPrs() {
    isLoadingAuthored = true
    authoredError = null
    try {
      const prs = await githubSync.listAuthoredPullRequests()
      $authoredPrs = prs
      // count is updated reactively via $effect
    } catch (e) {
      console.error('Failed to load authored PRs:', e)
      authoredError = formatPrLoadError('authored', e)
    } finally {
      isLoadingAuthored = false
    }
  }

  async function refreshAuthoredPrs() {
    isLoadingAuthored = true
    authoredError = null
    try {
      const prs = await githubSync.refreshAuthoredPullRequests()
      $authoredPrs = prs
      // count is updated reactively via $effect
    } catch (e) {
      console.error('Failed to refresh authored PRs:', e)
      authoredError = formatPrLoadError('authored', e)
    } finally {
      isLoadingAuthored = false
    }
  }

  /** Silently update authored PR store from DB without showing loading state. Used by background sync events. */
  async function silentRefreshAuthoredPrs() {
    try {
      const prs = await githubSync.listAuthoredPullRequests()
      $authoredPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh authored PRs:', e)
    }
  }

  function isCurrentPrDetailsLoad(sequence: number, pr: ReviewPullRequest): boolean {
    return sequence === prDetailsLoadSequence && $selectedReviewPr?.id === pr.id
  }

  async function selectPr(pr: ReviewPullRequest) {
    void api.navigation.navigate({ viewId: 'plugin:com.openforge.github-sync:pr_review' })
    await openPrDetail(pr)
  }

  // Load a PR into the detail view without navigating — the navigation has already
  // happened (either via selectPr's list-click or the host's open_review_pr command).
  async function openPrDetail(pr: ReviewPullRequest) {
    const loadSequence = ++prDetailsLoadSequence
    const now = Math.floor(Date.now() / 1000)
    const updatedPr = { ...pr, viewed_at: now, viewed_head_sha: pr.head_sha }
    $selectedReviewPr = updatedPr
    $reviewPrs = $reviewPrs.map(p => p.id === pr.id ? updatedPr : p)
    $prFileDiffs = []
    $reviewComments = []
    $pendingManualComments = []
    $prOverviewComments = []
    $agentReviewComments = []
    githubSync.markReviewPullRequestViewed({ prId: pr.id, headSha: pr.head_sha }).catch(e => console.error('Failed to mark viewed:', e))
    isLoading = true
    try {
      const diffs = await githubSync.listPullRequestFileDiffs({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (!isCurrentPrDetailsLoad(loadSequence, pr)) return
      $prFileDiffs = diffs
      const comments = await githubSync.listReviewComments({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (!isCurrentPrDetailsLoad(loadSequence, pr)) return
      $reviewComments = comments
      const agentComments = await githubSync.listAgentReviewComments({ reviewPrId: pr.id })
      if (!isCurrentPrDetailsLoad(loadSequence, pr)) return
      $agentReviewComments = agentComments
    } catch (e) {
      if (!isCurrentPrDetailsLoad(loadSequence, pr)) return
      console.error('Failed to load PR diffs:', e)
      error = 'Failed to load pull request details.'
    } finally {
      if (loadSequence === prDetailsLoadSequence) {
        isLoading = false
      }
    }
  }

  function backToList() {
    prDetailsLoadSequence += 1
    isLoading = false
    $selectedReviewPr = null
    $prFileDiffs = []
    $reviewComments = []
    $pendingManualComments = []
    $prOverviewComments = []
    $agentReviewComments = []
    activeTab = 'overview'
  }

  function openPrOnGitHub() {
    if ($selectedReviewPr) {
      api.system.openUrl($selectedReviewPr.html_url)
    }
  }

  async function loadOverviewComments(pr: ReviewPullRequest): Promise<PrOverviewComment[]> {
    return githubSync.listPullRequestOverviewComments({
      owner: pr.repo_owner,
      repo: pr.repo_name,
      prNumber: pr.number,
    })
  }

  function submittedInlineCommentKey(comment: ReviewSubmissionComment): string {
    return JSON.stringify([
      comment.path,
      comment.line,
      comment.side.toUpperCase(),
      comment.body.trim(),
    ])
  }

  function existingInlineCommentKey(comment: ReviewComment): string | null {
    if (comment.line === null) return null

    return JSON.stringify([
      comment.path,
      comment.line,
      (comment.side ?? '').toUpperCase(),
      comment.body.trim(),
    ])
  }

  function incrementCount(counts: Map<string, number>, key: string) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  function countSubmittedInlineComments(comments: ReviewSubmissionComment[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const comment of comments) {
      incrementCount(counts, submittedInlineCommentKey(comment))
    }
    return counts
  }

  function countExistingInlineComments(comments: ReviewComment[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const comment of comments) {
      const key = existingInlineCommentKey(comment)
      if (key) incrementCount(counts, key)
    }
    return counts
  }

  function hasNewlySubmittedInlineComments(request: {
    previousComments: ReviewComment[]
    latestComments: ReviewComment[]
    submittedComments: ReviewSubmissionComment[]
  }): boolean {
    const submittedCounts = countSubmittedInlineComments(request.submittedComments)
    const previousCounts = countExistingInlineComments(request.previousComments)
    const latestCounts = countExistingInlineComments(request.latestComments)

    for (const [key, submittedCount] of submittedCounts) {
      const previousCount = previousCounts.get(key) ?? 0
      const latestCount = latestCounts.get(key) ?? 0
      if (latestCount < previousCount + submittedCount) return false
    }

    return true
  }

  async function recoverAlreadySubmittedInlineComments(request: {
    repoOwner: string
    repoName: string
    prNumber: number
    comments: ReviewSubmissionComment[]
    previousComments: ReviewComment[]
  }): Promise<boolean> {
    if (request.comments.length === 0) return false

    try {
      const latestComments = await githubSync.listReviewComments({
        owner: request.repoOwner,
        repo: request.repoName,
        prNumber: request.prNumber,
      })
      const allSubmittedCommentsWereAdded = hasNewlySubmittedInlineComments({
        previousComments: request.previousComments,
        latestComments,
        submittedComments: request.comments,
      })
      if (!allSubmittedCommentsWereAdded) return false

      $reviewComments = latestComments
      return true
    } catch {
      return false
    }
  }

  async function submitReview(request: {
    repoOwner: string
    repoName: string
    prNumber: number
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    body: string
    comments: ReviewSubmissionComment[]
    commitId: string
  }): Promise<void> {
    const previousComments = $reviewComments

    try {
      await githubSync.submitPullRequestReview({
        owner: request.repoOwner,
        repo: request.repoName,
        prNumber: request.prNumber,
        event: request.event,
        body: request.body,
        comments: request.comments,
        commitId: request.commitId,
      })
    } catch (error) {
      if (await recoverAlreadySubmittedInlineComments({ ...request, previousComments })) return
      throw error
    }
  }

  async function fetchPrFileContents(file: PrFileDiff): Promise<FileContents> {
    const pr = $selectedReviewPr!
    const isImageFile = isImageFileDiff(file)
    let oldContent = ''
    let newContent = ''

    if (file.status !== 'removed' && file.sha) {
      try {
        newContent = isImageFile
          ? await githubSync.getFileContentBase64({
            owner: pr.repo_owner,
            repo: pr.repo_name,
            sha: file.sha,
          })
          : await githubSync.getFileContent({
            owner: pr.repo_owner,
            repo: pr.repo_name,
            sha: file.sha,
          })
      } catch { /* file may not exist */ }
    }

    if (file.status !== 'added') {
      const oldPath = file.previous_filename || file.filename
      try {
        oldContent = isImageFile
          ? await githubSync.getFileAtRefBase64({
            owner: pr.repo_owner,
            repo: pr.repo_name,
            path: oldPath,
            refSha: pr.base_ref,
          })
          : await githubSync.getFileAtRef({
            owner: pr.repo_owner,
            repo: pr.repo_name,
            path: oldPath,
            refSha: pr.base_ref,
          })
      } catch { /* file may not exist on base */ }
    }

    return { oldContent, newContent }
  }

  onMount(async () => {
    loadGithubConfiguration()
    loadPrs()
    loadAuthoredPrs()
    unlisteners.push(
      githubSync.onAuthoredPullRequestsUpdated(() => {
        silentRefreshAuthoredPrs()
      })
    )
    unlisteners.push(
      githubSync.onReviewPullRequestCountChanged(() => {
        silentRefreshPrs()
      })
    )
    unlisteners.push(
      githubSync.onViewInvoked((payload) => {
        if (payload?.view === api.navigation.get().currentView) {
          backToList()
        }
      })
    )
  })

  onDestroy(() => {
    unlisteners.forEach((subscription) => {
      void subscription.dispose()
    })
  })
</script>

<svelte:window onkeydown={handlePrReviewKeydown} />

<div class="flex flex-col w-full h-full min-h-0 overflow-hidden">
  {#if $selectedReviewPr}
    <PrReviewDetailSection
      {api}
      {githubSync}
      pr={$selectedReviewPr}
      activeProjectId={$activeProjectId}
      {activeTab}
      files={$prFileDiffs}
      {isLoading}
      {error}
      reviewComments={$reviewComments}
      pendingManualComments={$pendingManualComments}
      overviewComments={$prOverviewComments}
      agentReviewComments={$agentReviewComments}
      {fileTreeVisible}
      {reviewedFileShas}
      onBackToList={backToList}
      onOpenPrOnGitHub={openPrOnGitHub}
      onActiveTabChange={(tab) => { activeTab = tab }}
      onOverviewCommentsChange={(comments) => { $prOverviewComments = comments }}
      {loadOverviewComments}
      fetchFileContents={fetchPrFileContents}
      onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
      onPendingCommentsChange={(comments) => { $pendingManualComments = comments }}
      onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
      onUpdateAgentCommentStatus={(commentId, status) => githubSync.updateAgentReviewCommentStatus({ commentId, status })}
      onToggleFileReviewed={handleToggleFileReviewed}
      onSubmitReview={submitReview}
      onOpenUrl={(url) => api.system.openUrl(url)}
    />
  {:else}
    <PrReviewListSection
      {headerTitle}
      {headerSubtitle}
      {projectName}
      {showFilters}
      {projectHasNoRepo}
      {excludedRepos}
      {showFilterDropdown}
      {newRepoInput}
      suggestedRepos={suggestedRepos()}
      {isLoading}
      {isLoadingAuthored}
      {error}
      {authoredError}
      {githubTokenConfigured}
      {filteredReviewPrs}
      {filteredAuthoredPrs}
      allReviewPrs={$reviewPrs}
      allAuthoredPrs={$authoredPrs}
      {hiddenReviewRepos}
      {hiddenAuthoredRepos}
      {groupedPrs}
      {groupedAuthoredPrs}
      {flatPrList}
      focusedIndex={vimList.focusedIndex}
      onToggleFilterDropdown={() => { showFilterDropdown = !showFilterDropdown }}
      onCloseFilterDropdown={() => { showFilterDropdown = false }}
      onNewRepoInputChange={(value) => { newRepoInput = value }}
      onAddExcludedRepo={(repo) => { void addExcludedRepo(repo) }}
      onRemoveExcludedRepo={(repo) => { void removeExcludedRepo(repo) }}
      onRefreshPrs={() => { void refreshPrs() }}
      onRefreshAuthoredPrs={() => { void refreshAuthoredPrs() }}
      onOpenGithubSettings={openGithubSettings}
      onOpenRepositoryFilters={openRepositoryFilters}
      onSelectPr={(pr) => { void selectPr(pr) }}
      onOpenAuthoredPr={(url) => api.system.openUrl(url)}
      {pluralize}
    />
  {/if}
</div>
