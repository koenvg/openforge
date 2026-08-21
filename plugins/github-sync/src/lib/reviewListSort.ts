/**
 * Stable partition that lifts PRs whose walkthrough + AI review has finished
 * generating ('ready') to the front of the list, preserving the relative order
 * within the ready group and within the rest. Compose this BEFORE
 * `sortDoNotReviewLast` so "DO NOT REVIEW" PRs still sink to the bottom even if
 * they happen to have a ready walkthrough.
 */
export function walkthroughReadyFirst<T extends { id: number }>(prs: T[], readyPrIds: Set<number>): T[] {
  const ready: T[] = []
  const rest: T[] = []
  for (const pr of prs) {
    if (readyPrIds.has(pr.id)) ready.push(pr)
    else rest.push(pr)
  }
  return [...ready, ...rest]
}
