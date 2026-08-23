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
  onRefresh: () => void | Promise<void>
  onCommentClick: (comment: PrComment) => void
  onOpenLinkedPr: () => void
  onShowAddressedChange: (showAddressed: boolean) => void
}

interface SelfReviewGeneralFeedback {
  readonly taskId: string
  readonly commentCount: number
}

interface SelfReviewFeedbackComposer {
  readonly pendingInlineComments: ReviewSubmissionComment[]
  onPendingInlineCommentsChange: (comments: ReviewSubmissionComment[]) => void
  onSendComplete: () => void
}

interface SelfReviewFeedbackNavigation {
  readonly activeTab: 'pr' | 'notes'
  onActiveTabChange: (tab: 'pr' | 'notes') => void
  onCollapse: () => void
}

export interface SelfReviewFeedbackPane {
  readonly totalCommentCount: number
  readonly pullRequest: SelfReviewPullRequestFeedback
  readonly general: SelfReviewGeneralFeedback
  readonly composer: SelfReviewFeedbackComposer
  readonly navigation: SelfReviewFeedbackNavigation
}

interface SelfReviewFeedbackPaneSources {
  getTaskId: () => string
  diff: Pick<SelfReviewDiffController, 'linkedPr' | 'prComments' | 'refresh'>
  comments: Pick<
    SelfReviewCommentController,
    | 'commentSelection'
    | 'generalCommentCount'
    | 'pendingInlineComments'
    | 'markdownImageBaseUrl'
    | 'handlePendingInlineCommentsChange'
  >
  navigation: Pick<
    SelfReviewNavigationController,
    | 'sidebarTab'
    | 'showAddressed'
    | 'setSidebarVisible'
    | 'setSidebarTab'
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
        + sources.comments.generalCommentCount
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
      onRefresh: sources.diff.refresh,
      onCommentClick: sources.navigation.scrollToComment,
      onOpenLinkedPr: sources.navigation.openLinkedPr,
      onShowAddressedChange: sources.navigation.setShowAddressed,
    },
    general: {
      get taskId() { return sources.getTaskId() },
      get commentCount() { return sources.comments.generalCommentCount },
    },
    composer: {
      get pendingInlineComments() { return sources.comments.pendingInlineComments },
      onPendingInlineCommentsChange: sources.comments.handlePendingInlineCommentsChange,
      onSendComplete: sources.comments.commentSelection.deselectAll,
    },
    navigation: {
      get activeTab() { return sources.navigation.sidebarTab },
      onActiveTabChange: sources.navigation.setSidebarTab,
      onCollapse: () => sources.navigation.setSidebarVisible(false),
    },
  }
}
