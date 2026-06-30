import type { PrLabel } from '@openforge/plugin-sdk/domain'

/**
 * Hard-coded GitHub label that forces a pull request to the bottom of its list.
 * A PR tagged with this label never needs the reviewer's immediate attention,
 * so it is always sorted last in both the reviewed and authored lists.
 */
export const DO_NOT_REVIEW_LABEL = 'DO NOT REVIEW'

const DO_NOT_REVIEW_KEY = DO_NOT_REVIEW_LABEL.toLowerCase()

/** Whether a PR carries the hard-coded "DO NOT REVIEW" label (case-insensitive, trimmed). */
export function hasDoNotReviewLabel(pr: { labels?: PrLabel[] | null }): boolean {
  return (pr.labels ?? []).some((label) => label.name.trim().toLowerCase() === DO_NOT_REVIEW_KEY)
}

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
