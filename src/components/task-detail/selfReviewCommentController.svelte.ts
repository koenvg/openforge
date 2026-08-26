import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { getGitHubMarkdownImageBaseUrl, isGitHubAttachmentUrl } from '../../lib/githubMarkdown'
import { resolveGithubAsset } from '../../lib/ipc'
import type { ResolvedMarkdownMedia } from '../../lib/markdown'
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
  }
}

export type SelfReviewCommentController = ReturnType<typeof createSelfReviewCommentController>
