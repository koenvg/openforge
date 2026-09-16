import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { getGitHubMarkdownImageBaseUrl, isGitHubAttachmentUrl } from '../../lib/githubMarkdown'
import { resolveGithubAsset } from '../../lib/ipc'
import type { ResolvedMarkdownMedia } from '../../lib/markdown'
import { compileReviewPrompt, type ReviewPromptMode } from '../../lib/reviewPrompt'
import {
  emptySelfReviewTaskState,
  mergeVisiblePendingSelfReviewComments,
  setPendingSelfReviewComments,
  type SelfReviewTaskState,
} from '../../lib/taskScopedSelfReviewState'
import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
import type { PrComment, PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'

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
  getComparisonFilenames: () => Set<string>
  setPendingComments?: (taskId: string, comments: ReviewSubmissionComment[]) => void
  onCommentsNeedAttention?: () => void
}

export function createSelfReviewCommentController(options: SelfReviewCommentControllerOptions) {
  let synchronizedTaskId: string | null = null
  let hasRequestedAttention = false
  const commentSelection = createCommentSelection({
    getPrComments: options.getPrComments,
    getGithubUsername: options.getGithubUsername,
  })
  const getState = () => options.getState() ?? emptySelfReviewTaskState
  const setPendingComments = options.setPendingComments ?? setPendingSelfReviewComments

  let pendingInlineComments = $derived(getState().pendingInlineComments)
  let inlineReviewComments = $derived(prCommentsToReviewComments(options.getPrComments()))
  let visibleInlineReviewComments = $derived(
    inlineReviewComments.filter((comment) => !options.getComparisonFilenames().has(comment.path)),
  )
  let visiblePendingInlineComments = $derived(
    pendingInlineComments.filter((comment) => !options.getComparisonFilenames().has(comment.path)),
  )
  let markdownImageBaseUrl = $derived(getGitHubMarkdownImageBaseUrl(options.getLinkedPr?.() ?? null))

  function synchronize(): void {
    const taskId = options.getTaskId()
    if (synchronizedTaskId !== taskId) {
      synchronizedTaskId = taskId
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
    const pr = options.getLinkedPr?.() ?? null
    if (!pr || !isGitHubAttachmentUrl(url)) return null

    try {
      return await resolveGithubAsset(pr.repo_owner, pr.repo_name, url)
    } catch {
      return null
    }
  }

  return {
    get commentSelection() { return commentSelection },
    get pendingInlineComments() { return pendingInlineComments },
    get visibleInlineReviewComments() { return visibleInlineReviewComments },
    get visiblePendingInlineComments() { return visiblePendingInlineComments },
    get markdownImageBaseUrl() { return markdownImageBaseUrl },
    resolveRemoteMedia,
    synchronize,
    handlePendingInlineCommentsChange,
    get feedbackCount() { return pendingInlineComments.length + commentSelection.selectedPrComments.length },
    captureReviewFeedback,
  }
}

export type SelfReviewCommentController = ReturnType<typeof createSelfReviewCommentController>
