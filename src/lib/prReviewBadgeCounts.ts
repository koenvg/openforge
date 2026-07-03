import type { ReviewPullRequest } from './types'
import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel } from './types'

// Re-export the shared label helpers so existing importers keep their import path.
export { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel }

/** A review request still owed: not yet opened in-app and not marked "do not review". */
function isUnopened(pr: ReviewPullRequest): boolean {
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

/**
 * Per-project unopened review counts, keyed by project id. Each project is scored against
 * its own resolved repo with the same unopened / not-"do not review" rule as the rail badge,
 * so a project with an unresolved repo (null) reports zero. Backs the sidebar's per-project
 * review-request badge.
 */
export function buildReviewRequestCountByProject(
  reviewPrs: ReviewPullRequest[],
  projectRepos: ReadonlyMap<string, string | null>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [projectId, repo] of projectRepos) {
    counts.set(projectId, countRepoUnopenedReviews(reviewPrs, repo))
  }
  return counts
}
