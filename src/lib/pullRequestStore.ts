import { preservePullRequestState } from './types'
import type { PullRequestInfo } from './types'

function preserveWithPreviousTicketState(
  previousPrs: Map<string, PullRequestInfo[]>,
  pr: PullRequestInfo,
): PullRequestInfo {
  const oldPr = (previousPrs.get(pr.ticket_id) ?? []).find((candidate) => candidate.id === pr.id)
  return preservePullRequestState(oldPr, pr)
}

export function buildTicketPullRequestMap(
  prs: PullRequestInfo[],
  previousPrs: Map<string, PullRequestInfo[]> = new Map(),
): Map<string, PullRequestInfo[]> {
  const grouped = new Map<string, PullRequestInfo[]>()

  for (const pr of prs) {
    const preservedPr = preserveWithPreviousTicketState(previousPrs, pr)
    const existing = grouped.get(preservedPr.ticket_id) ?? []
    grouped.set(preservedPr.ticket_id, [...existing, preservedPr])
  }

  return grouped
}

export function updateTaskPullRequestsInMap(
  previousPrs: Map<string, PullRequestInfo[]>,
  taskId: string,
  prs: PullRequestInfo[],
): Map<string, PullRequestInfo[]> {
  const nextMap = new Map(previousPrs)
  const nextTaskPrs = prs
    .filter((pr) => pr.ticket_id === taskId)
    .map((pr) => preserveWithPreviousTicketState(previousPrs, pr))

  nextMap.set(taskId, nextTaskPrs)
  return nextMap
}
