import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel, hasMergeConflicts, type PrLabel } from '@openforge-app/plugin-sdk/domain'

// The "DO NOT REVIEW" label constant and predicate live in plugin-sdk/domain (the
// canonical home). Re-export them so existing importers of this module keep working.
export { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel }

/**
 * Returns a new array with "DO NOT REVIEW"-labeled PRs moved to the end, while
 * preserving the relative order of every other PR (a stable partition). The
 * input array is not mutated. Generic so it works for both ReviewPullRequest
 * and AuthoredPullRequest lists.
 */
export function sortDoNotReviewLast<T extends { labels?: PrLabel[] | null }>(prs: T[]): T[] {
  const keep: T[] = []
  const sink: T[] = []
  for (const pr of prs) {
    if (hasDoNotReviewLabel(pr)) {
      sink.push(pr)
    } else {
      keep.push(pr)
    }
  }
  return [...keep, ...sink]
}

/**
 * The fields {@link sortAuthoredPrs} reads. Declared structurally rather than as
 * AuthoredPullRequest so the comparator states exactly what it depends on — and so it
 * cannot be applied to ReviewPullRequest, which carries neither `ci_status` nor
 * `review_status`.
 */
export interface AuthoredPrSortInfo {
  state: string
  draft: boolean
  mergeable?: boolean | null
  mergeable_state: string | null
  ci_status: string | null
  review_status: string | null
}

/**
 * Whether an authored PR is waiting on its author to fix something: it conflicts with
 * its base branch, its checks failed, or a reviewer requested changes. Checks that are
 * still running and reviews that are merely awaited are normal, not blocking. A PR that
 * is no longer open never needs attention.
 */
export function authoredPrNeedsAttention(pr: AuthoredPrSortInfo): boolean {
  if (pr.state !== 'open') return false
  const conflicted = hasMergeConflicts({
    state: pr.state,
    mergeable: pr.mergeable ?? null,
    mergeable_state: pr.mergeable_state,
  })
  return conflicted || pr.ci_status === 'failure' || pr.review_status === 'changes_requested'
}

/**
 * Rank within the authored list, lowest first: active PRs above drafts, and within each
 * of those, PRs needing attention above healthy ones.
 *
 * 0 active + needs attention   2 draft + needs attention
 * 1 active                     3 draft
 */
function authoredPrRank(pr: AuthoredPrSortInfo): number {
  return (pr.draft ? 2 : 0) + (authoredPrNeedsAttention(pr) ? 0 : 1)
}

/**
 * Returns a new array ordered by {@link authoredPrRank}. The sort is stable, so PRs
 * sharing a rank keep their incoming order — most recently updated first, as the
 * backend returns them. The input array is not mutated.
 *
 * The "DO NOT REVIEW" label is deliberately not consulted: it tells reviewers to skip a
 * PR, which says nothing about whether its author still has work to do on it.
 */
export function sortAuthoredPrs<T extends AuthoredPrSortInfo>(prs: T[]): T[] {
  return [...prs].sort((a, b) => authoredPrRank(a) - authoredPrRank(b))
}
