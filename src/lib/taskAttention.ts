import type { PullRequestInfo } from './types'
import { canMergePullRequest, hasMergeConflicts } from './types'

export type AttentionTone = 'error' | 'warning' | 'success' | 'info'

export interface TaskAttention {
  message: string
  tone: AttentionTone
}

/**
 * Derive the single most important actionable signal for a task, or `null` when
 * nothing needs attention. Drives the panel's conditional Attention banner so it
 * stays quiet when calm and names the next action when something matters.
 *
 * The live agent checkpoint is intentionally NOT handled here — it lives in the
 * always-visible control-row status pill, not the (hideable) panel.
 */
export function deriveTaskAttention(
  prs: PullRequestInfo[],
  waitingDependencyCount: number,
): TaskAttention | null {
  if (prs.some((pr) => hasMergeConflicts(pr))) {
    return { message: 'Resolve merge conflicts', tone: 'error' }
  }
  if (prs.some((pr) => (pr.unaddressed_comment_count ?? 0) > 0)) {
    return { message: 'Review PR comments before merge', tone: 'warning' }
  }
  if (prs.some((pr) => pr.ci_status === 'failure')) {
    return { message: 'Fix failing CI checks', tone: 'error' }
  }
  if (waitingDependencyCount > 0) {
    const noun = waitingDependencyCount === 1 ? 'dependency' : 'dependencies'
    return { message: `Blocked by ${waitingDependencyCount} ${noun}`, tone: 'warning' }
  }
  if (prs.some((pr) => canMergePullRequest(pr))) {
    return { message: 'Ready to merge', tone: 'success' }
  }
  if (prs.some((pr) => pr.review_status === 'changes_requested')) {
    return { message: 'Address requested changes', tone: 'warning' }
  }
  if (prs.some((pr) => pr.ci_status === 'pending')) {
    return { message: 'Waiting for CI', tone: 'info' }
  }
  if (prs.some((pr) => pr.review_status === 'pending' || pr.review_status === 'review_required')) {
    return { message: 'Waiting for review', tone: 'info' }
  }
  return null
}
