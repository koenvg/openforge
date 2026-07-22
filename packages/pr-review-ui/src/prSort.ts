import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel, type PrLabel } from '@openforge-app/plugin-sdk/domain'

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
