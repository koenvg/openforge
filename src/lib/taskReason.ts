import type { Task, AgentSession, PullRequestInfo } from './types'
import type { TaskState } from './taskState'
import { getStateDrivingPr } from './taskState'

const STATE_REASONS: Record<TaskState, string> = {
  'egg': 'In backlog — not started yet.',
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
  'pr-queued': 'Pull request is queued for merge.',
  'pr-merged': 'Pull request merged.',
  'merge-conflict': 'Pull request has merge conflicts that must be resolved.',
}

export function getTaskReasonText(
  _task: Task,
  state: TaskState,
  _session: AgentSession | null,
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
