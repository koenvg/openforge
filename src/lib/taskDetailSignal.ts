import type { PullRequestInfo } from './types'
import { getMergeReadiness, getMostAttentionWorthyPullRequest } from './types'

export type TaskDetailSignalTone = 'error' | 'warning' | 'success' | 'info'

export interface TaskDetailSignal {
  message: string
  tone: TaskDetailSignalTone
}

/**
 * Derive the highest-priority PR/dependency signal for the Task detail panel's
 * conditional Attention banner, or `null` when that narrow banner is calm.
 *
 * This presentation helper does not determine membership in the backend-owned
 * Task Needs Attention projection. Agent checkpoints and other membership signals
 * intentionally remain outside this detail-panel banner.
 */
export function deriveTaskDetailSignal(
  prs: PullRequestInfo[],
  waitingDependencyCount: number,
): TaskDetailSignal | null {
  const drivingPr = getMostAttentionWorthyPullRequest(prs.filter((pr) => pr.state === 'open'))
  if (drivingPr) {
    const readiness = getMergeReadiness(drivingPr)

    if (readiness.status === 'ready_to_merge') {
      return { message: 'Ready to merge', tone: 'success' }
    }
    if (readiness.status === 'ready_to_enqueue') {
      return { message: 'Ready to enqueue', tone: 'success' }
    }
    if (readiness.status === 'blocked') {
      const blockerCodes = new Set(readiness.blockers.map((blocker) => blocker.code))
      if (blockerCodes.has('merge_conflict')) return { message: 'Resolve merge conflicts', tone: 'error' }
      if (blockerCodes.has('checks_failed')) return { message: 'Fix failing CI checks', tone: 'error' }
      if (blockerCodes.has('changes_requested')) return { message: 'Address requested changes', tone: 'warning' }
      if (blockerCodes.has('unresolved_conversations')) return { message: 'Review PR comments before merge', tone: 'warning' }
      if (readiness.warnings.some((warning) => warning.code === 'unresolved_conversations')) {
        return { message: 'Review PR comments before merge', tone: 'warning' }
      }
    }
  }

  if (waitingDependencyCount > 0) {
    const noun = waitingDependencyCount === 1 ? 'dependency' : 'dependencies'
    return { message: `Blocked by ${waitingDependencyCount} ${noun}`, tone: 'warning' }
  }

  if (drivingPr) {
    const readiness = getMergeReadiness(drivingPr)
    const blockerCodes = new Set(readiness.blockers.map((blocker) => blocker.code))
    if (readiness.status === 'blocked' && blockerCodes.has('checks_pending')) {
      return { message: 'Waiting for CI', tone: 'info' }
    }
    if (readiness.status === 'readiness_unknown') {
      return { message: 'Waiting for merge readiness', tone: 'info' }
    }
    if (readiness.status === 'blocked' && (drivingPr.review_status === 'pending' || drivingPr.review_status === 'review_required')) {
      return { message: 'Waiting for review', tone: 'info' }
    }
  }

  return null
}
