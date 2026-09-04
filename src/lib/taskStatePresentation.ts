import { getStateDrivingPr } from './taskState'
import type { TaskState } from './taskState'
import type { PullRequestInfo } from './types'

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  backlog: 'Backlog',
  idle: 'Idle',
  active: 'Running',
  'needs-input': 'Needs Input',
  'paused': 'Paused',
  'agent-done': 'Agent Done',
  'failed': 'Failed',
  'interrupted': 'Interrupted',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Awaiting Review',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Requested',
  'unaddressed-comments': 'Unaddressed Comments',
  'ready-to-merge': 'Ready to Merge',
  'ready-to-enqueue': 'Ready to Enqueue',
  'pr-queued': 'In Merge Queue',
  'pr-merged': 'PR Merged',
  'pr-closed': 'PR Closed',
  'merge-conflict': 'Merge Conflict',
}

export const TASK_STATE_COMPACT_LABELS: Record<TaskState, string> = {
  backlog: 'Backlog',
  idle: 'Idle',
  active: 'Active',
  'needs-input': 'Needs Input',
  'paused': 'Paused',
  'agent-done': 'Done',
  'failed': 'Failed',
  'interrupted': 'Stopped',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Review Pending',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Req.',
  'unaddressed-comments': 'Unaddressed Comments',
  'ready-to-merge': 'Ready to Merge',
  'ready-to-enqueue': 'Ready to Enqueue',
  'pr-queued': 'Queued',
  'pr-merged': 'Merged',
  'pr-closed': 'Closed',
  'merge-conflict': 'Merge Conflict',
}

export type TaskBadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function getTaskStateBadgeVariant(state: TaskState): TaskBadgeVariant {
  if (state === 'active' || state === 'agent-done') return 'success'
  if (state === 'needs-input' || state === 'unaddressed-comments') return 'warning'
  if (['ci-failed', 'failed', 'changes-requested', 'merge-conflict'].includes(state)) return 'danger'
  if (state === 'ready-to-merge' || state === 'ready-to-enqueue' || state === 'pr-queued') return 'info'
  return 'neutral'
}

export interface TaskListItemPresentation {
  badgeVariant: TaskBadgeVariant
  stateLabel: string
  reasonText: string
}

export function getTaskListItemPresentation(
  state: TaskState,
  reasonText: string,
  isMerging: boolean,
): TaskListItemPresentation {
  if (isMerging) {
    return {
      badgeVariant: getTaskStateBadgeVariant(state),
      stateLabel: 'Merging...',
      reasonText: 'Pull request merge is in progress.',
    }
  }

  return {
    badgeVariant: getTaskStateBadgeVariant(state),
    stateLabel: TASK_STATE_COMPACT_LABELS[state] ?? state,
    reasonText,
  }
}

export function getTaskStateBadgeClass(state: TaskState): string {
  if (state === 'backlog') return 'badge-ghost'

  switch (getTaskStateBadgeVariant(state)) {
    case 'success': return 'badge-success'
    case 'warning': return 'badge-warning'
    case 'danger': return 'badge-error'
    case 'info': return 'badge-info'
    case 'neutral': return ''
  }
}

const STATE_REASONS: Record<TaskState, string> = {
  'backlog': 'In backlog — not started yet.',
  'idle': 'No agent running. Start when ready.',
  'active': 'Agent is running — no action needed right now.',
  'needs-input': 'Agent needs your input to continue.',
  'paused': 'Agent paused.',
  'agent-done': 'Agent completed — review the changes.',
  'failed': 'Agent failed — check the error log.',
  'interrupted': 'Agent was interrupted.',
  'done': 'Completed.',
  'pr-draft': 'Pull request is a draft.',
  'pr-open': 'Pull request is open — awaiting review.',
  'ci-running': 'CI pipeline is running.',
  'review-pending': 'Waiting on code review.',
  'ci-failed': 'CI pipeline failed — check the logs.',
  'changes-requested': 'Changes requested on the pull request.',
  'unaddressed-comments': 'Unaddressed comments on the pull request.',
  'ready-to-merge': 'Ready to merge — all checks passed.',
  'ready-to-enqueue': 'Ready to enqueue — all requirements passed.',
  'pr-queued': 'Pull request is queued for merge.',
  'pr-merged': 'Pull request merged.',
  'pr-closed': 'Pull request closed without merge.',
  'merge-conflict': 'Pull request has merge conflicts that must be resolved.',
}

export function getTaskReasonText(
  state: TaskState,
  prs: PullRequestInfo[]
): string {
  const baseReason = STATE_REASONS[state] ?? `Status: ${state}`

  const drivingPr = getStateDrivingPr(prs)
  const drivingPrUnaddressed = drivingPr?.unaddressed_comment_count ?? 0

  if (state === 'unaddressed-comments' && drivingPrUnaddressed > 0) {
    return `${drivingPrUnaddressed} unaddressed comment(s) on the pull request.`
  }

  return baseReason
}
