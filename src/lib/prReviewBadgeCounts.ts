import type { ReviewPullRequest } from './types'
import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel } from './types'

// Re-export the shared label helpers so existing importers keep their import path.
export { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel }

/** A review request still owed: not yet opened in-app and not marked "do not review". */
export function isUnopened(pr: ReviewPullRequest): boolean {
  return pr.viewed_at === null && !hasDoNotReviewLabel(pr)
}

/**
 * All-repos unopened review count backing the "All Pull Requests" badge. Honors the
 * global repo-exclusion filter. Depends only on the review list (and the filter), so it
 * is constant regardless of which project is active.
 */
export function countAllReposUnopenedReviews(
  reviewPrs: ReviewPullRequest[],
  excludedRepos: ReadonlySet<string> = new Set(),
): number {
  return reviewPrs.filter(
    (pr) => isUnopened(pr) && !excludedRepos.has(`${pr.repo_owner}/${pr.repo_name}`),
  ).length
}

/**
 * Active-repo unopened review count backing the rail "Pull Requests" icon badge. Zero when
 * the repo is not yet resolved, so the rail never shows an all-repos number.
 */
export function countRepoUnopenedReviews(
  reviewPrs: ReviewPullRequest[],
  resolvedRepo: string | null,
): number {
  if (!resolvedRepo) return 0
  return reviewPrs.filter(
    (pr) => isUnopened(pr) && `${pr.repo_owner}/${pr.repo_name}` === resolvedRepo,
  ).length
}
