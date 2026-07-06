<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { Disposable, FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  type UnlistenFn = Disposable
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewComments, pendingManualComments, prOverviewComments, agentReviewComments, authoredPrs, activeProjectId, pendingReviewPrOpen } from '../../lib/stores'
  import { getHTMLElementAt, isInputFocused } from '../../lib/domUtils'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import ReviewPrCard from '@openforge-app/pr-review-ui/ReviewPrCard.svelte'
  import AuthoredPrCard from '@openforge-app/pr-review-ui/AuthoredPrCard.svelte'
  import { sortDoNotReviewLast } from '@openforge-app/pr-review-ui/prSort'
  import FileTree from '@openforge-app/pr-review-ui/FileTree.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import DiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
  import { getReviewFileIdentity } from '@openforge-app/pr-review-ui/reviewFileIdentity'
  import ProjectPageHeader from '../../project/ProjectPageHeader.svelte'
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
  import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
  import WalkthroughTab from './WalkthroughTab.svelte'
  import { isPrLargeEnoughForWalkthroughHint } from '../../lib/walkthroughViewState'
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
  let diffViewer = $state<DiffViewer>()
  let prFileTree = $state<FileTree>()
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

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
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
      api.events.onGlobal<{ view: string }>('openforge.view-invoked', (payload) => {
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
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="flex flex-col gap-1.5 px-4 py-2.5 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
        <div class="flex items-center gap-2 min-w-0">
          <button class="btn btn-ghost btn-xs text-base-content/50 shrink-0" onclick={backToList}>← Back</button>
          <span class="badge badge-primary badge-sm shrink-0">{$selectedReviewPr.repo_owner}/{$selectedReviewPr.repo_name}</span>
          <h2 class="text-sm font-semibold text-base-content m-0 truncate flex-1">{$selectedReviewPr.title}</h2>
          <span
            class="text-xs text-primary font-medium cursor-pointer hover:opacity-80 hover:underline shrink-0"
            role="link"
            tabindex="0"
            onclick={openPrOnGitHub}
            onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openPrOnGitHub()}
          >GitHub ↗</span>
        </div>
        <div class="flex items-center">
          <div class="flex gap-1" role="tablist" aria-label="Pull request detail sections">
            <button
              role="tab"
              aria-selected={activeTab === 'overview'}
              class="btn btn-ghost btn-xs {activeTab === 'overview' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
              onclick={() => { activeTab = 'overview' }}
            >Overview</button>
            <button
              role="tab"
              aria-selected={activeTab === 'files'}
              class="btn btn-ghost btn-xs {activeTab === 'files' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
              onclick={() => { activeTab = 'files' }}
            >Files changed <span class="badge badge-xs ml-1">{$prFileDiffs.length}</span></button>
            <button
              class="btn btn-ghost btn-xs {activeTab === 'walkthrough' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
              onclick={() => { activeTab = 'walkthrough' }}
              title={isPrLargeEnoughForWalkthroughHint($selectedReviewPr, $prFileDiffs) ? 'This PR is large — a walkthrough may help.' : 'AI walkthrough'}
            >
              Walkthrough
              {#if isPrLargeEnoughForWalkthroughHint($selectedReviewPr, $prFileDiffs)}
                <span class="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning"></span>
              {/if}
            </button>
          </div>
          <span class="flex-1"></span>
          <div class="flex items-center gap-2 text-xs text-base-content/50">
            <span class="font-semibold text-base-content">#{$selectedReviewPr.number}</span>
            <span class="text-base-300">•</span>
            <span class="font-medium">{$selectedReviewPr.user_login}</span>
            <span class="text-base-300">•</span>
            <span>{timeAgoFromSeconds($selectedReviewPr.created_at)}</span>
          </div>
        </div>
      </div>

      {#if activeTab === 'overview'}
        <PrOverviewTab
          pr={$selectedReviewPr}
          comments={$prOverviewComments}
          onCommentsChange={(comments) => { $prOverviewComments = comments }}
          loadComments={loadOverviewComments}
          onOpenUrl={(url) => api.system.openUrl(url)}
        />
      {:else if activeTab === 'walkthrough'}
        <WalkthroughTab
          {api}
          {githubSync}
          pr={$selectedReviewPr}
          files={$prFileDiffs}
          fetchFileContents={fetchPrFileContents}
          projectId={$activeProjectId}
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
                  files={$prFileDiffs}
                  onSelectFile={handleFileSelect}
                  {reviewedFileShas}
                  getFileReviewIdentity={getReviewFileIdentity}
                  onToggleFileReviewed={handleToggleFileReviewed}
                  onRequestFocusDiff={() => diffViewer?.focusDiff()}
                />
              </ResizablePanel>
            {/if}
            <DiffViewer
              bind:this={diffViewer}
              files={$prFileDiffs}
              existingComments={$reviewComments}
              repoOwner={$selectedReviewPr.repo_owner}
              repoName={$selectedReviewPr.repo_name}
              {fileTreeVisible}
              onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
              fetchFileContents={fetchPrFileContents}
              agentComments={$agentReviewComments}
              pendingComments={$pendingManualComments}
              onPendingCommentsChange={(comments) => { $pendingManualComments = comments }}
              onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
              onUpdateAgentCommentStatus={(commentId, status) => githubSync.updateAgentReviewCommentStatus({ commentId, status })}
              onOpenUrl={(url) => api.system.openUrl(url)}
              {reviewedFileShas}
              onToggleFileReviewed={handleToggleFileReviewed}
              getFileReviewIdentity={getReviewFileIdentity}
              onRequestFocusFileTree={() => prFileTree?.focusTree()}
            >
              {#snippet footer()}
                <ReviewSubmitPanel
                  repoOwner={$selectedReviewPr.repo_owner}
                  repoName={$selectedReviewPr.repo_name}
                  prNumber={$selectedReviewPr.number}
                  commitId={$selectedReviewPr.head_sha}
                  pendingComments={$pendingManualComments}
                  onPendingCommentsChange={(comments) => { $pendingManualComments = comments }}
                  onSubmitReview={submitReview}
                />
              {/snippet}
            </DiffViewer>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col h-full overflow-hidden">
      <ProjectPageHeader
        title={headerTitle}
        subtitle={headerSubtitle}
      >
        {#snippet actions()}
          {#if showFilters}
          <div class="relative">
            <button
              class="btn btn-ghost btn-sm gap-1 {excludedRepos.size > 0 ? 'text-warning' : 'text-base-content/50'}"
              title="Filter repositories"
              aria-label="Filter repositories"
              aria-haspopup="dialog"
              aria-expanded={showFilterDropdown}
              onclick={() => { showFilterDropdown = !showFilterDropdown }}
            >
              {#if excludedRepos.size > 0}
                <span class="badge badge-warning badge-xs">{excludedRepos.size}</span>
              {/if}
              Filter
            </button>
              {#if showFilterDropdown}
                <!-- Invisible backdrop to close dropdown on outside click -->
               <!-- svelte-ignore a11y_click_events_have_key_events -->
               <div role="presentation" class="fixed inset-0 z-40" onclick={() => { showFilterDropdown = false }}></div>
               <div class="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-[320px] p-3" role="dialog" aria-label="Excluded repositories filter">
                <div class="text-xs font-semibold text-base-content/50 mb-2">Excluded Repositories</div>

                <!-- Manual input to add a repo -->
                <form class="flex gap-1.5 mb-3" onsubmit={(e) => { e.preventDefault(); addExcludedRepo(newRepoInput) }}>
                  <input
                    type="text"
                    class="input input-bordered input-xs flex-1"
                    aria-label="Repository to exclude"
                    placeholder="owner/repo"
                    bind:value={newRepoInput}
                  />
                  <button type="submit" class="btn btn-primary btn-xs" disabled={!newRepoInput.trim()}>Add</button>
                </form>

                <!-- Current exclusion list -->
                {#if excludedRepos.size > 0}
                  <div class="flex flex-col gap-1 mb-3 max-h-[160px] overflow-y-auto">
                    {#each [...excludedRepos].sort() as repo}
                      <div class="flex items-center justify-between px-2 py-1 rounded bg-base-200 text-sm">
                        <span class="text-base-content truncate">{repo}</span>
                        <button
                          class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
                          onclick={() => removeExcludedRepo(repo)}
                          title="Remove from exclusion list"
                          aria-label="Remove {repo} from excluded repositories"
                        ><span aria-hidden="true">✕</span></button>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="text-xs text-base-content/40 px-1 mb-3">No repositories excluded</div>
                {/if}

                <!-- Quick-add suggestions from current PRs -->
                {#if suggestedRepos().length > 0}
                  <div class="border-t border-base-300 pt-2">
                    <div class="text-xs text-base-content/40 mb-1.5">Quick add from open PRs</div>
                    <div class="flex flex-wrap gap-1">
                      {#each suggestedRepos() as repo}
                        <button
                          class="btn btn-ghost btn-xs text-base-content/60"
                          aria-label="Exclude {repo} from pull request lists"
                          onclick={() => addExcludedRepo(repo)}
                        >+ {repo}</button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
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
        <!-- Left column: Review Requests -->
        <div class="flex-1 flex flex-col overflow-hidden border-r border-base-300">
          <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-base-content m-0">Review Requests</h3>
              <span class="badge badge-primary badge-xs">{filteredReviewPrs.length}</span>
            </div>
            <button class="btn btn-xs btn-ghost text-base-content/50" aria-label="Refresh review requests" onclick={refreshPrs} disabled={isLoading}>
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
                  <button class="btn btn-primary btn-sm" onclick={refreshPrs}>Retry loading review requests</button>
                  <button class="btn btn-ghost btn-sm" onclick={openGithubSettings}>Open GitHub settings</button>
                </div>
              </div>
            {:else if filteredReviewPrs.length === 0 && $reviewPrs.length > 0 && hiddenReviewRepos.length > 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-warning badge-lg">Filtered</div>
                <h3 class="text-xl font-semibold text-base-content m-0">All review requests are hidden by filters</h3>
                <p class="text-sm m-0 max-w-md">
                  {$reviewPrs.length} {pluralize($reviewPrs.length, 'PR')} from {hiddenReviewRepos.join(', ')} {pluralize(hiddenReviewRepos.length, 'is', 'are')} currently unchecked for this project.
                </p>
                <button class="btn btn-primary btn-sm" onclick={openRepositoryFilters}>Review repository filters</button>
              </div>
            {:else if filteredReviewPrs.length === 0 && githubTokenConfigured === false}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-warning badge-lg">Not connected</div>
                <h3 class="text-xl font-semibold text-base-content m-0">Connect GitHub to check review requests</h3>
                <p class="text-sm m-0 max-w-md">No GitHub token is configured, so OpenForge cannot check review requests for {projectName}.</p>
                <button class="btn btn-primary btn-sm" onclick={openGithubSettings}>Open GitHub settings</button>
              </div>
            {:else if filteredReviewPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-success badge-lg">Checked</div>
                <h3 class="text-xl font-semibold text-base-content m-0">No PRs requesting your review</h3>
                <p class="text-sm m-0 max-w-md">GitHub is connected for {projectName}. Sync again if you expected review requests, or check repository filters for hidden repos.</p>
                <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button class="btn btn-primary btn-sm" onclick={refreshPrs}>Sync review requests</button>
                  {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={openRepositoryFilters}>Review repository filters</button>{/if}
                </div>
              </div>
            {:else}
              {#each [...groupedPrs.entries()] as [repo, prs]}
                <div class="mb-6">
                  <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                  <div class="flex flex-col gap-3">
                    {#each prs as pr}
                      {@const flatIdx = flatPrList.indexOf(pr)}
                      <div data-vim-pr-item class={flatIdx === vimList.focusedIndex ? 'vim-focus' : ''}>
                        <ReviewPrCard
                          {pr}
                          selected={false}
                          onClick={() => selectPr(pr)}
                        />
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Right column: My Pull Requests -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-base-content m-0">My Pull Requests</h3>
              <span class="badge badge-primary badge-xs">{filteredAuthoredPrs.length}</span>
            </div>
            <button class="btn btn-xs btn-ghost text-base-content/50" aria-label="Refresh authored pull requests" onclick={refreshAuthoredPrs} disabled={isLoadingAuthored}>
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
                  <button class="btn btn-primary btn-sm" onclick={refreshAuthoredPrs}>Retry loading your pull requests</button>
                  <button class="btn btn-ghost btn-sm" onclick={openGithubSettings}>Open GitHub settings</button>
                </div>
              </div>
            {:else if filteredAuthoredPrs.length === 0 && $authoredPrs.length > 0 && hiddenAuthoredRepos.length > 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-warning badge-lg">Filtered</div>
                <h3 class="text-xl font-semibold text-base-content m-0">All authored PRs are hidden by filters</h3>
                <p class="text-sm m-0 max-w-md">
                  {$authoredPrs.length} {pluralize($authoredPrs.length, 'PR')} from {hiddenAuthoredRepos.join(', ')} {pluralize(hiddenAuthoredRepos.length, 'is', 'are')} currently unchecked for this project.
                </p>
                <button class="btn btn-primary btn-sm" onclick={openRepositoryFilters}>Review repository filters</button>
              </div>
            {:else if filteredAuthoredPrs.length === 0 && githubTokenConfigured === false}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-warning badge-lg">Not connected</div>
                <h3 class="text-xl font-semibold text-base-content m-0">Connect GitHub to check your PRs</h3>
                <p class="text-sm m-0 max-w-md">No GitHub token is configured, so OpenForge cannot check pull requests authored by your account.</p>
                <button class="btn btn-primary btn-sm" onclick={openGithubSettings}>Open GitHub settings</button>
              </div>
            {:else if filteredAuthoredPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/70 text-center">
                <div class="badge badge-success badge-lg">Checked</div>
                <h3 class="text-xl font-semibold text-base-content m-0">No open pull requests</h3>
                <p class="text-sm m-0 max-w-md">GitHub is connected for your account. Sync again if you expected authored PRs, or check repository filters for hidden repos.</p>
                <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button class="btn btn-primary btn-sm" onclick={refreshAuthoredPrs}>Sync my pull requests</button>
                  {#if showFilters}<button class="btn btn-ghost btn-sm" onclick={openRepositoryFilters}>Review repository filters</button>{/if}
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
                        onClick={() => api.system.openUrl(pr.html_url)}
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
  {/if}
</div>
