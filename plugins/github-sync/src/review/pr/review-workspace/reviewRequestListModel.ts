import { isClosedOrMergedPullRequest, type ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { getReviewRequestProgress } from '@openforge-app/plugin-sdk/prStatusPresentation'

export interface ReviewRequestCollections {
  needsReview: ReviewPullRequest[]
  reviewed: ReviewPullRequest[]
  finished: ReviewPullRequest[]
  counts: {
    needsReview: number
    reviewed: number
    finished: number
  }
  groupedNeedsReview: Map<string, ReviewPullRequest[]>
  groupedReviewed: Map<string, ReviewPullRequest[]>
  groupedFinished: Map<string, ReviewPullRequest[]>
  keyboardNavigable: ReviewPullRequest[]
}

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

export function deriveReviewRequestCollections(prs: ReviewPullRequest[]): ReviewRequestCollections {
  const needsReview: ReviewPullRequest[] = []
  const reviewed: ReviewPullRequest[] = []
  const finished: ReviewPullRequest[] = []

  for (const pr of prs) {
    if (isClosedOrMergedPullRequest(pr.state)) {
      finished.push(pr)
      continue
    }

    if (getReviewRequestProgress(pr)?.kind === 'reviewed') reviewed.push(pr)
    else needsReview.push(pr)
  }

  return {
    needsReview,
    reviewed,
    finished,
    counts: {
      needsReview: needsReview.length,
      reviewed: reviewed.length,
      finished: finished.length,
    },
    groupedNeedsReview: groupByRepo(needsReview),
    groupedReviewed: groupByRepo(reviewed),
    groupedFinished: groupByRepo(finished),
    keyboardNavigable: needsReview,
  }
}
