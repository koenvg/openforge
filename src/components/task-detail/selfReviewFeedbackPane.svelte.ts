import type { ResolvedMarkdownMedia } from '../../lib/markdown'
import type { CommentSelectionState } from '../../lib/useCommentSelection.svelte'
import type { PrComment, PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'
import type { SelfReviewCommentController } from './selfReviewCommentController.svelte'
import type { SelfReviewDiffController } from './selfReviewDiffController.svelte'
import type { SelfReviewNavigationController } from './selfReviewNavigationController.svelte'

interface SelfReviewPullRequestFeedback {
  readonly linkedPr: PullRequestInfo | null
  readonly comments: PrComment[]
  readonly visibleComments: PrComment[]
  readonly selection: CommentSelectionState
  readonly markdownImageBaseUrl: string | null
  readonly showAddressed: boolean
  resolveRemoteMedia: (url: string) => Promise<ResolvedMarkdownMedia | null>
  onRefresh: () => void | Promise<void>
  onCommentClick: (comment: PrComment) => void
  onOpenLinkedPr: () => void
  onShowAddressedChange: (showAddressed: boolean) => void
}

interface SelfReviewFeedbackComposer {
  readonly pendingInlineComments: ReviewSubmissionComment[]
  onPendingInlineCommentsChange: (comments: ReviewSubmissionComment[]) => void
  onSendComplete: () => void
}

interface SelfReviewFeedbackNavigation {
  onCollapse: () => void
}

export interface SelfReviewFeedbackPane {
  readonly totalCommentCount: number
  readonly pullRequest: SelfReviewPullRequestFeedback
  readonly composer: SelfReviewFeedbackComposer
  readonly navigation: SelfReviewFeedbackNavigation
}

interface SelfReviewFeedbackPaneSources {
  diff: Pick<SelfReviewDiffController, 'linkedPr' | 'prComments' | 'refresh'>
  comments: Pick<
    SelfReviewCommentController,
    | 'commentSelection'
    | 'pendingInlineComments'
    | 'markdownImageBaseUrl'
    | 'resolveRemoteMedia'
    | 'handlePendingInlineCommentsChange'
  >
  navigation: Pick<
    SelfReviewNavigationController,
    | 'showAddressed'
    | 'setSidebarVisible'
    | 'setShowAddressed'
    | 'openLinkedPr'
    | 'scrollToComment'
  >
}

export function createSelfReviewFeedbackPane(
  sources: SelfReviewFeedbackPaneSources,
): SelfReviewFeedbackPane {
  return {
    get totalCommentCount() {
      return sources.comments.commentSelection.unaddressedCount
        + sources.comments.pendingInlineComments.length
    },
    pullRequest: {
      get linkedPr() { return sources.diff.linkedPr },
      get comments() { return sources.diff.prComments },
      get visibleComments() {
        return sources.navigation.showAddressed
          ? sources.diff.prComments
          : sources.comments.commentSelection.unaddressedComments
      },
      get selection() { return sources.comments.commentSelection },
      get markdownImageBaseUrl() { return sources.comments.markdownImageBaseUrl },
      get showAddressed() { return sources.navigation.showAddressed },
      resolveRemoteMedia: sources.comments.resolveRemoteMedia,
      onRefresh: sources.diff.refresh,
      onCommentClick: sources.navigation.scrollToComment,
      onOpenLinkedPr: sources.navigation.openLinkedPr,
      onShowAddressedChange: sources.navigation.setShowAddressed,
    },
    composer: {
      get pendingInlineComments() { return sources.comments.pendingInlineComments },
      onPendingInlineCommentsChange: sources.comments.handlePendingInlineCommentsChange,
      onSendComplete: sources.comments.commentSelection.deselectAll,
    },
    navigation: {
      onCollapse: () => sources.navigation.setSidebarVisible(false),
    },
  }
}
