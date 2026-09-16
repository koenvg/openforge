import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { getGitHubMarkdownImageBaseUrl, isGitHubAttachmentUrl } from '../../lib/githubMarkdown'
import { createReviewCommentReply, resolveGithubAsset } from '../../lib/ipc'
import type { ResolvedMarkdownMedia } from '../../lib/markdown'
import { compileReviewPrompt, type ReviewPromptMode } from '../../lib/reviewPrompt'
import {
  emptySelfReviewTaskState,
  mergeVisiblePendingSelfReviewComments,
  setPendingSelfReviewComments,
  type SelfReviewTaskState,
} from '../../lib/taskScopedSelfReviewState'
import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
import type { PrComment, PullRequestInfo, ReviewComment, ReviewSubmissionComment } from '../../lib/types'

function mergeReviewComments(cached: ReviewComment[], acceptedReplies: ReviewComment[]): ReviewComment[] {
  const cachedIds = new Set(cached.map(comment => comment.id))
  return [...cached, ...acceptedReplies.filter(comment => !cachedIds.has(comment.id))]
}

export interface ReviewFeedbackCapture {
  compilePrompt(mode: ReviewPromptMode): string
  /** Reconcile once after synchronous dispatch, without marking comments addressed. */
  reconcileAfterSend(): void
}

export interface ReviewFeedbackComposer {
  readonly feedbackCount: number
  captureReviewFeedback(): ReviewFeedbackCapture
}

export interface SelfReviewCommentControllerOptions {
  getTaskId: () => string
  getState: () => SelfReviewTaskState | undefined
  getPrComments: () => PrComment[]
  getGithubUsername?: () => string | null
  getLinkedPr?: () => PullRequestInfo | null
  getReplyPullRequest?: () => PullRequestInfo | null
  getComparisonFilenames: () => Set<string>
  setPendingComments?: (taskId: string, comments: ReviewSubmissionComment[]) => void
  onCommentsNeedAttention?: () => void
}

export function createSelfReviewCommentController(options: SelfReviewCommentControllerOptions) {
  let synchronizedTaskId: string | null = null
  let synchronizedPrId: number | null = null
  let hasRequestedAttention = false
  let acceptedReplies = $state<ReviewComment[]>([])
  const commentSelection = createCommentSelection({
    getPrComments: options.getPrComments,
    getGithubUsername: options.getGithubUsername,
  })
  const getState = () => options.getState() ?? emptySelfReviewTaskState
  const getReplyPullRequest = options.getReplyPullRequest ?? options.getLinkedPr ?? (() => null)
  const setPendingComments = options.setPendingComments ?? setPendingSelfReviewComments

  let pendingInlineComments = $derived(getState().pendingInlineComments)
  let inlineReviewComments = $derived(mergeReviewComments(
    prCommentsToReviewComments(options.getPrComments()),
    acceptedReplies,
  ))
  let visibleInlineReviewComments = $derived(
    inlineReviewComments.filter((comment) => !options.getComparisonFilenames().has(comment.path)),
  )
  let visiblePendingInlineComments = $derived(
    pendingInlineComments.filter((comment) => !options.getComparisonFilenames().has(comment.path)),
  )
  let canReplyToExistingComments = $derived(getReplyPullRequest()?.state === 'open')
  let markdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl(options.getLinkedPr?.() ?? null))

  function synchronize(): void {
    const taskId = options.getTaskId()
    const prId = getReplyPullRequest()?.id ?? null
    if (synchronizedTaskId !== taskId || synchronizedPrId !== prId) {
      synchronizedTaskId = taskId
      synchronizedPrId = prId
      acceptedReplies = []
      commentSelection.deselectAll()
      hasRequestedAttention = false
    }
    if (commentSelection.unaddressedCount === 0 || hasRequestedAttention) return
    hasRequestedAttention = true
    options.onCommentsNeedAttention?.()
  }

  function replacePendingInlineComments(comments: ReviewSubmissionComment[]): void {
    setPendingComments(options.getTaskId(), comments)
  }

  function handlePendingInlineCommentsChange(comments: ReviewSubmissionComment[]): void {
    setPendingComments(
      options.getTaskId(),
      mergeVisiblePendingSelfReviewComments(
        pendingInlineComments,
        comments,
        options.getComparisonFilenames(),
      ),
    )
  }

  function captureReviewFeedback(): ReviewFeedbackCapture {
    const taskId = options.getTaskId()
    const capturedInline = pendingInlineComments.map(comment => ({ ...comment }))
    const capturedPr = commentSelection.selectedPrComments.map(comment => ({ ...comment }))
    let reconciled = false

    return {
      compilePrompt: (mode) => compileReviewPrompt(mode, capturedInline, capturedPr),
      reconcileAfterSend() {
        if (reconciled || options.getTaskId() !== taskId) return
        reconciled = true
        const unmatched = [...capturedInline]
        replacePendingInlineComments(pendingInlineComments.filter(comment => {
          const index = unmatched.findIndex(sent =>
            sent.path === comment.path && sent.line === comment.line
            && sent.side === comment.side && sent.body === comment.body)
          if (index < 0) return true
          unmatched.splice(index, 1)
          return false
        }))
        for (const comment of commentSelection.selectedPrComments) {
          if (capturedPr.some(sent =>
            sent.id === comment.id && sent.body === comment.body && sent.author === comment.author
            && sent.file_path === comment.file_path && sent.line_number === comment.line_number,
          )) {
            commentSelection.toggleSelected(comment.id)
          }
        }
      },
    }
  }

  // Uploads pasted into a review comment sit behind a github.com URL only a
  // signed-in browser session can fetch; the sidecar trades it for a URL this app
  // can render, and tells us whether it is a picture or a recording.
  async function resolveRemoteMedia(url: string): Promise<ResolvedMarkdownMedia | null> {
    const pr = getReplyPullRequest()
    if (!pr || !isGitHubAttachmentUrl(url)) return null

    try {
      return await resolveGithubAsset(pr.repo_owner, pr.repo_name, url)
    } catch {
      return null
    }
  }

  async function replyToExistingComment(commentId: number, body: string): Promise<void> {
    const taskId = options.getTaskId()
    const pr = options.getLinkedPr?.() ?? null
    if (!pr || pr.state !== 'open') throw new Error('No linked open pull request')

    const reply = await createReviewCommentReply(
      pr.repo_owner,
      pr.repo_name,
      pr.pr_number,
      commentId,
      body,
    )
    if (options.getTaskId() !== taskId || getReplyPullRequest()?.id !== pr.id) return
    acceptedReplies = mergeReviewComments(acceptedReplies, [reply])
  }

  return {
    get commentSelection() { return commentSelection },
    get pendingInlineComments() { return pendingInlineComments },
    get visibleInlineReviewComments() { return visibleInlineReviewComments },
    get visiblePendingInlineComments() { return visiblePendingInlineComments },
    get canReplyToExistingComments() { return canReplyToExistingComments },
    get markdownImageBaseUrl() { return markdownImageBaseUrl },
    resolveRemoteMedia,
    replyToExistingComment,
    synchronize,
    handlePendingInlineCommentsChange,
    get feedbackCount() { return pendingInlineComments.length + commentSelection.selectedPrComments.length },
    captureReviewFeedback,
  }
}

export type SelfReviewCommentController = ReturnType<typeof createSelfReviewCommentController>
