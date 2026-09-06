import { onDestroy, onMount } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type {
  PrFileDiff,
  PrOverviewComment,
  ReviewComment,
  ReviewPullRequest,
  ReviewSubmissionComment,
} from '@openforge-app/plugin-sdk/domain'
import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
import { getImagePreviewDataUrl, type FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import { isGitHubAttachmentUrl } from '@openforge-app/pr-review-ui/githubMarkdown'
import {
  agentReviewComments,
  pendingManualComments,
  pendingReplies,
  pendingReviewPrOpen,
  prFileDiffs,
  prOverviewComments,
  reviewComments,
  reviewPrs,
  selectedReviewPr,
} from '../../../lib/stores'
import { isInputFocused } from '../../../lib/domUtils'
import { fetchGithubFileContents } from '../githubFileContents'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'

export type PrDetailTab = 'overview' | 'files' | 'walkthrough'

type AiThreadState = {
  load(pr: ReviewPullRequest): Promise<void>
  clear(): void
}

type WalkthroughState = {
  readonly selectedReady: boolean
  refreshStatus(pr: ReviewPullRequest): Promise<unknown>
}

export function useSelectedPrReview(
  api: FrontendOpenForgeAPI,
  githubSync: GithubSyncPrReviewClient,
  aiThreadState: AiThreadState,
  walkthroughState: WalkthroughState,
) {
  const agentCommentsStore = fromStore(agentReviewComments)
  const manualComments = fromStore(pendingManualComments)
  const replies = fromStore(pendingReplies)
  const pendingPrOpen = fromStore(pendingReviewPrOpen)
  const fileDiffs = fromStore(prFileDiffs)
  const overviewComments = fromStore(prOverviewComments)
  const reviewCommentsStore = fromStore(reviewComments)
  const pullRequests = fromStore(reviewPrs)
  const selectedPr = fromStore(selectedReviewPr)
  let activeTab = $state<PrDetailTab>('overview')
  let fileTreeVisible = $state(true)
  let includeNonApplicationFiles = $state(true)
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let replyPostingError = $state<string | null>(null)
  let isPostingReplies = $state(false)
  let loadSequence = 0
  let viewInvokedSubscription: { dispose(): void | Promise<void> } | null = null

  function isCurrentLoad(sequence: number, pr: ReviewPullRequest): boolean {
    return sequence === loadSequence && selectedPr.current?.id === pr.id
  }

  function clearDetailState(): void {
    replyPostingError = null
    isPostingReplies = false
    fileDiffs.current = []
    reviewCommentsStore.current = []
    manualComments.current = []
    replies.current = []
    overviewComments.current = []
    agentCommentsStore.current = []
    aiThreadState.clear()
  }

  async function select(pr: ReviewPullRequest): Promise<void> {
    void api.navigation.navigate({ viewId: 'plugin:com.openforge.github-sync:pr_review' })
    await open(pr)
  }

  async function open(pr: ReviewPullRequest): Promise<void> {
    const sequence = ++loadSequence
    const now = Math.floor(Date.now() / 1000)
    const updatedPr = { ...pr, viewed_at: now, viewed_head_sha: pr.head_sha }
    selectedPr.current = updatedPr
    pullRequests.current = pullRequests.current.map(candidate => candidate.id === pr.id ? updatedPr : candidate)
    void walkthroughState.refreshStatus(updatedPr)
    includeNonApplicationFiles = true
    clearDetailState()
    githubSync.markReviewPullRequestViewed({ prId: pr.id, headSha: pr.head_sha })
      .catch(cause => console.error('Failed to mark viewed:', cause))

    isLoading = true
    try {
      const diffs = await githubSync.listPullRequestFileDiffs({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (!isCurrentLoad(sequence, pr)) return
      fileDiffs.current = diffs

      const comments = await githubSync.listReviewComments({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (!isCurrentLoad(sequence, pr)) return
      reviewCommentsStore.current = comments

      const agentComments = await githubSync.getPrAiReviewComments({
        reviewPrId: pr.id,
        headSha: pr.head_sha,
      })
      if (!isCurrentLoad(sequence, pr)) return
      agentCommentsStore.current = agentComments

      await aiThreadState.load(pr)
    } catch (cause) {
      if (!isCurrentLoad(sequence, pr)) return
      console.error('Failed to load PR diffs:', cause)
      error = 'Failed to load pull request details.'
    } finally {
      if (sequence === loadSequence) isLoading = false
    }
  }

  function backToList(): void {
    loadSequence += 1
    isLoading = false
    selectedPr.current = null
    clearDetailState()
    activeTab = 'overview'
  }

  function markUnread(pr: ReviewPullRequest): void {
    const updatedPr = { ...pr, viewed_at: null, viewed_head_sha: null }
    pullRequests.current = pullRequests.current.map(candidate => candidate.id === pr.id ? updatedPr : candidate)
    if (selectedPr.current?.id === pr.id) selectedPr.current = updatedPr
    githubSync.markReviewPullRequestUnviewed({ prId: pr.id })
      .catch(cause => console.error('Failed to mark unread:', cause))
  }

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      if (event.key === '1') {
        event.preventDefault()
        activeTab = 'overview'
        return
      }
      if (event.key === '2') {
        event.preventDefault()
        activeTab = 'files'
        return
      }
      if (event.key === '3') {
        event.preventDefault()
        if (walkthroughState.selectedReady) activeTab = 'walkthrough'
        return
      }
    }

    if (isInputFocused() || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape' || event.key === 'q') {
      event.preventDefault()
      backToList()
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
    return JSON.stringify([comment.path, comment.line, comment.side.toUpperCase(), comment.body.trim()])
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

  function incrementCount(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  function countSubmittedInlineComments(comments: ReviewSubmissionComment[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const comment of comments) incrementCount(counts, submittedInlineCommentKey(comment))
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
      if (!hasNewlySubmittedInlineComments({
        previousComments: request.previousComments,
        latestComments,
        submittedComments: request.comments,
      })) return false

      reviewCommentsStore.current = latestComments
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
    const previousComments = reviewCommentsStore.current
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
    } catch (cause) {
      if (await recoverAlreadySubmittedInlineComments({ ...request, previousComments })) {
        await postPendingReplies(request)
        return
      }
      throw cause
    }
    await postPendingReplies(request)
  }

  async function postPendingReplies(request: {
    repoOwner: string
    repoName: string
    prNumber: number
  }): Promise<void> {
    if (isPostingReplies) return
    const queued = replies.current
    if (queued.length === 0) {
      replyPostingError = null
      return
    }
    const sequence = loadSequence
    isPostingReplies = true
    replyPostingError = null
    let failedCount = 0
    for (const reply of queued) {
      if (sequence !== loadSequence) break
      try {
        await githubSync.replyToReviewComment({
          owner: request.repoOwner,
          repo: request.repoName,
          prNumber: request.prNumber,
          commentId: reply.commentId,
          body: reply.body,
        })
        replies.current = replies.current.filter(candidate => candidate !== reply)
      } catch (cause) {
        failedCount += 1
        console.error('Failed to post queued reply:', cause)
      }
    }
    if (sequence !== loadSequence) return
    isPostingReplies = false
    if (failedCount > 0) {
      replyPostingError = `Your review was submitted, but ${failedCount} queued ${failedCount === 1 ? 'reply was' : 'replies were'} not posted. Use Retry replies to send them without submitting the review again.`
    }
    try {
      const comments = await githubSync.listReviewComments({
        owner: request.repoOwner,
        repo: request.repoName,
        prNumber: request.prNumber,
      })
      if (
        selectedPr.current?.number === request.prNumber
        && selectedPr.current?.repo_owner === request.repoOwner
      ) {
        reviewCommentsStore.current = comments
      }
    } catch (cause) {
      console.error('Failed to refresh comments after posting replies:', cause)
    }
  }

  async function retryReplies(): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return
    await postPendingReplies({ repoOwner: pr.repo_owner, repoName: pr.repo_name, prNumber: pr.number })
  }

  async function replyToExistingComment(commentId: number, body: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    try {
      await githubSync.replyToReviewComment({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
        commentId,
        body,
      })
      const comments = await githubSync.listReviewComments({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (selectedPr.current?.id === pr.id) reviewCommentsStore.current = comments
    } catch (cause) {
      console.error('Failed to reply to review comment:', cause)
    }
  }

  function addReplyToReview(commentId: number, body: string): void {
    replies.current = [...replies.current, { commentId, body }]
  }

  function removePendingReply(commentId: number): void {
    const index = replies.current.findIndex(reply => reply.commentId === commentId)
    if (index === -1) return
    replies.current = replies.current.filter((_, candidateIndex) => candidateIndex !== index)
  }

  async function commentNow(
    filename: string,
    line: number,
    side: 'LEFT' | 'RIGHT',
    body: string,
  ): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    try {
      await githubSync.createReviewComment({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
        commitId: pr.head_sha,
        path: filename,
        line,
        side,
        body,
      })
      const comments = await githubSync.listReviewComments({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      if (selectedPr.current?.id === pr.id) reviewCommentsStore.current = comments
    } catch (cause) {
      console.error('Failed to create review comment:', cause)
    }
  }

  async function fetchFileContents(file: PrFileDiff): Promise<FileContents> {
    return fetchGithubFileContents(githubSync, selectedPr.current!, file)
  }

  async function resolveRepositoryImage(repositoryPath: string): Promise<string | null> {
    const pr = selectedPr.current
    if (!pr) return null

    try {
      const result = await githubSync.getFileAtRefBase64({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        path: repositoryPath,
        refSha: pr.head_sha,
      })
      return getImagePreviewDataUrl(repositoryPath, result.content)
    } catch {
      return null
    }
  }

  async function resolveRemoteMedia(url: string): Promise<ResolvedMarkdownMedia | null> {
    const pr = selectedPr.current
    if (!pr || !isGitHubAttachmentUrl(url)) return null

    try {
      return await githubSync.resolveGithubAsset({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        url,
      })
    } catch {
      return null
    }
  }

  function updateAgentCommentStatus(commentId: number, status: string): Promise<void> | undefined {
    const pr = selectedPr.current
    if (!pr) return
    return githubSync.updatePrAiReviewCommentStatus({
      reviewPrId: pr.id,
      headSha: pr.head_sha,
      commentId,
      status,
    })
  }

  function openOnGitHub(): void {
    if (selectedPr.current) api.system.openUrl(selectedPr.current.html_url)
  }

  $effect(() => {
    const pr = pendingPrOpen.current
    if (!pr) return
    pendingPrOpen.current = null
    void open(pr)
  })

  onMount(() => {
    viewInvokedSubscription = githubSync.onViewInvoked((payload) => {
      if (payload?.view === api.navigation.get().currentView) backToList()
    })
  })

  onDestroy(() => {
    void viewInvokedSubscription?.dispose()
  })

  return {
    get activeTab() { return activeTab },
    get fileTreeVisible() { return fileTreeVisible },
    get includeNonApplicationFiles() { return includeNonApplicationFiles },
    get isLoading() { return isLoading },
    get error() { return error },
    get replyPostingError() { return replyPostingError },
    get isPostingReplies() { return isPostingReplies },
    retryReplies,
    setActiveTab: (tab: PrDetailTab) => { activeTab = tab },
    setIncludeNonApplicationFiles: (value: boolean) => { includeNonApplicationFiles = value },
    toggleFileTree: () => { fileTreeVisible = !fileTreeVisible },
    select,
    open,
    backToList,
    markUnread,
    handleKeydown,
    loadOverviewComments,
    submitReview,
    replyToExistingComment,
    addReplyToReview,
    removePendingReply,
    commentNow,
    fetchFileContents,
    resolveRepositoryImage,
    resolveRemoteMedia,
    updateAgentCommentStatus,
    openOnGitHub,
  }
}
