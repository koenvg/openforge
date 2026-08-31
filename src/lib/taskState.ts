import type { TaskDetail, AgentSession, PullRequestInfo } from './types'
import { getMergeReadiness, getMostAttentionWorthyPullRequest, isClosedOrMergedPullRequest, isClosedUnmergedPullRequest, isMergedPullRequest } from './types'

export type TaskState =
  | 'backlog' | 'idle' | 'active' | 'needs-input' | 'paused' | 'agent-done' | 'failed' | 'interrupted' | 'done'
  | 'pr-draft' | 'pr-open' | 'ci-failed' | 'changes-requested' | 'ready-to-merge' | 'ready-to-enqueue' | 'pr-queued' | 'pr-merged' | 'pr-closed' | 'ci-running' | 'review-pending' | 'unaddressed-comments' | 'merge-conflict'

export const ALL_TASK_STATES: TaskState[] = [
  'idle',
  'active',
  'needs-input',
  'paused',
  'agent-done',
  'failed',
  'interrupted',
  'pr-draft',
  'pr-open',
  'ci-running',
  'review-pending',
  'ci-failed',
  'changes-requested',
  'unaddressed-comments',
  'ready-to-merge',
  'ready-to-enqueue',
  'pr-queued',
  'pr-merged',
  'pr-closed',
  'merge-conflict',
]


export function getStateDrivingPr(prs: PullRequestInfo[]): PullRequestInfo | null {
  const openPr = getMostAttentionWorthyPullRequest(prs.filter(pr => pr.state === 'open'))
  const donePr = prs.find(pr => isClosedOrMergedPullRequest(pr.state))
  return openPr ?? donePr ?? null
}

function getPrState(prs: PullRequestInfo[]): TaskState | null {
  const pr = getStateDrivingPr(prs)

  if (!pr) return null

  if (isMergedPullRequest(pr)) return 'pr-merged'
  if (isClosedUnmergedPullRequest(pr)) return 'pr-closed'

  const readiness = getMergeReadiness(pr)

  if (readiness.status === 'ready_to_merge') return 'ready-to-merge'
  if (readiness.status === 'ready_to_enqueue') return 'ready-to-enqueue'
  if (readiness.status === 'queued_pull_request') return 'pr-queued'

  if (readiness.status === 'blocked') {
    const blockerCodes = new Set(readiness.blockers.map((blocker) => blocker.code))
    const warningCodes = new Set(readiness.warnings.map((warning) => warning.code))
    if (blockerCodes.has('checks_failed')) return 'ci-failed'
    if (blockerCodes.has('changes_requested')) return 'changes-requested'
    if (blockerCodes.has('merge_conflict')) return 'merge-conflict'
    if (blockerCodes.has('unresolved_conversations') || warningCodes.has('unresolved_conversations')) return 'unaddressed-comments'
    if (blockerCodes.has('draft')) return 'pr-draft'
    if (blockerCodes.has('checks_pending')) return 'ci-running'
  }

  if (readiness.warnings.some((warning) => warning.code === 'unresolved_conversations')) return 'unaddressed-comments'
  if (pr.review_status === 'review_required') return 'review-pending'
  return 'pr-open'
}

const BORDER_CLASS: Record<string, string> = {
  'active': 'running',
  'needs-input': 'needs-input',
  'paused': 'paused',
  'agent-done': 'completed',
  'failed': 'failed',
  'interrupted': 'interrupted',
  'ci-failed': 'ci-failed',
  'ci-running': 'ci-running',
  'review-pending': 'review-pending',
  'unaddressed-comments': 'unaddressed-comments',
  'ready-to-merge': 'ready-to-merge',
  'ready-to-enqueue': 'ready-to-merge',
  'pr-queued': 'ready-to-merge',
  'merge-conflict': 'ci-failed',
}

export function taskStateToBorderClass(state: TaskState): string {
  return BORDER_CLASS[state] ?? ''
}

export function computeTaskState(task: TaskDetail, session: AgentSession | null, prs: PullRequestInfo[]): TaskState {
  // Done tasks are always done
  if (task.status === 'done') {
    return 'done'
  }

  // Backlog tasks have not started
  if (task.status === 'backlog') {
    return 'backlog'
  }

  // Doing tasks map to various states based on session
  if (task.status === 'doing') {
    if (session !== null) {
      switch (session.status) {
        case 'running':
          return 'active'
        case 'paused':
          return session.checkpoint_data !== null ? 'needs-input' : 'paused'
        case 'failed':
          return 'failed'
        case 'interrupted':
          return 'interrupted'
        case 'completed':
          // Fall through to PR checks below
          break
        default:
          // Unknown session status — check PRs before falling back to idle
          break
      }
    }

    // PR-based states (after session-completed or no session)
    const prState = getPrState(prs)
    if (prState) return prState

    // Session completed with no PR context
    if (session?.status === 'completed') return 'agent-done'

    // No session, no PR
    return 'idle'
  }

  // Fallback for any other task status
  return 'idle'
}
