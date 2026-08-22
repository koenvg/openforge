import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
import {
  emptySelfReviewTaskState,
  mergeVisiblePendingSelfReviewComments,
  setPendingSelfReviewComments,
  type SelfReviewTaskState,
} from '../../lib/taskScopedSelfReviewState'
import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
import type { PrComment, PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'

export interface SelfReviewCommentControllerOptions {
  getTaskId: () => string
  getState: () => SelfReviewTaskState | undefined
  getPrComments: () => PrComment[]
  getLinkedPr?: () => PullRequestInfo | null
  getComparisonFilenames: () => Set<string>
  setPendingComments?: (taskId: string, comments: ReviewSubmissionComment[]) => void
  onCommentsNeedAttention?: () => void
}

export function createSelfReviewCommentController(options: SelfReviewCommentControllerOptions) {
  let synchronizedTaskId: string | null = null
  let hasRequestedAttention = false
  const commentSelection = createCommentSelection({ getPrComments: options.getPrComments })
  const getState = () => options.getState() ?? emptySelfReviewTaskState
  const setPendingComments = options.setPendingComments ?? setPendingSelfReviewComments

  let generalComments = $derived(getState().generalComments)
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
      hasRequestedAttention = false
    }
    if (commentSelection.unaddressedCount === 0 || hasRequestedAttention) return
    hasRequestedAttention = true
    options.onCommentsNeedAttention?.()
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

  return {
    get commentSelection() { return commentSelection },
    get generalCommentCount() { return generalComments.length },
    get pendingInlineComments() { return pendingInlineComments },
    get visibleInlineReviewComments() { return visibleInlineReviewComments },
    get visiblePendingInlineComments() { return visiblePendingInlineComments },
    get markdownImageBaseUrl() { return markdownImageBaseUrl },
    synchronize,
    handlePendingInlineCommentsChange,
  }
}

export type SelfReviewCommentController = ReturnType<typeof createSelfReviewCommentController>
