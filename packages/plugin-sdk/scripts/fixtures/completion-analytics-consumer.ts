import type { CompletionCoverage, CompletedTaskQuery, TasksAPI } from '@openforge-app/plugin-sdk'

/** Boundaries in the host's local calendar. Compute both midnights, not midnight + 86,400 seconds. */
export function localDayBounds(day: Date): Pick<CompletedTaskQuery, 'completedFrom' | 'completedBefore'> {
  const year = day.getFullYear()
  const month = day.getMonth()
  const date = day.getDate()
  return {
    completedFrom: Math.floor(new Date(year, month, date).getTime() / 1000),
    completedBefore: Math.floor(new Date(year, month, date + 1).getTime() / 1000),
  }
}

/** A plugin-owned usage index keyed by Task ID is joined only after reading dated Task pages. */
export async function countCompletedForLocalDay(
  tasks: Pick<TasksAPI, 'completed'>,
  projectId: string,
  day: Date,
  usageByTaskId: ReadonlyMap<string, number>,
): Promise<{ knownCount: number; usageTotal: number; coverage: CompletionCoverage }> {
  const bounds = localDayBounds(day)
  let cursor: string | null = null
  let coverage: CompletionCoverage | null = null
  let knownCount = 0
  let usageTotal = 0
  const seen = new Set<string>()
  do {
    const page = await tasks.completed(projectId, { ...bounds, cursor })
    if (!page.completionCoverage) throw new Error('Host does not support completion coverage')
    if (coverage && (coverage.trackedFrom !== page.completionCoverage.trackedFrom
      || coverage.rangeStatus !== page.completionCoverage.rangeStatus)) {
      throw new Error('Completion coverage changed during pagination; restart the query')
    }
    coverage = page.completionCoverage
    for (const task of page.tasks) {
      if (task.completedAt === null || seen.has(task.id)) {
        throw new Error('Invalid completion page; restart the query')
      }
      seen.add(task.id)
      knownCount += 1
      usageTotal += usageByTaskId.get(task.id) ?? 0
    }
    cursor = page.nextCursor
  } while (cursor)
  // A zero with rangeStatus 'partial' or 'unavailable' is not a verified historical zero.
  return { knownCount, usageTotal, coverage: coverage! }
}
