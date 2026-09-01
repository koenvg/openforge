import { getMergeReadiness, isClosedUnmergedPullRequest, isMergedPullRequest, type MergeReadinessAction, type MergeReadinessDetail, type MergeReadinessStatus, type MergeStatusInfo, type PullRequestMergeMethod } from './domain.js'

export type PrChipSurface = 'compact' | 'detail'

export type PrChipVariant = 'success' | 'error' | 'pending' | 'muted' | 'neutral' | 'done' | 'merged' | 'closed'
export type PrChipType = 'draft' | 'ci' | 'review' | 'merge'
export type PrChipIcon = 'check' | 'cross' | 'clock' | null

const PULL_REQUEST_MERGE_ACTION_LABELS: Record<PullRequestMergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
}

export function getPullRequestMergeActionLabel(method: PullRequestMergeMethod, prNumber?: number): string {
  const label = PULL_REQUEST_MERGE_ACTION_LABELS[method]
  if (prNumber === undefined) return label
  return method === 'merge' ? `${label} for PR #${prNumber}` : `${label} PR #${prNumber}`
}

export interface PrStatusChipSpec {
  type: PrChipType
  label: string
  variant: PrChipVariant
  surface: PrChipSurface
  icon?: PrChipIcon
  pulse?: boolean
}

export interface PrInput extends MergeStatusInfo {
  draft?: boolean
  is_queued?: boolean
  ci_status?: string | null
  review_status?: string | null
  merged_at?: number | null
  head_sha?: string | null
  updated_at?: number | null
  unaddressed_comment_count?: number
  merge_readiness_status?: MergeReadinessStatus | null
  merge_readiness_action?: MergeReadinessAction | null
  merge_readiness_blockers?: string | MergeReadinessDetail[] | null
  merge_readiness_warnings?: string | MergeReadinessDetail[] | null
  readiness_source_head_sha?: string | null
  readiness_updated_at?: number | null
}

export function getPrStatusChips(pr: PrInput, surface: PrChipSurface): PrStatusChipSpec[] {
  const chips: PrStatusChipSpec[] = []

  if (pr.draft && pr.state === 'open') {
    chips.push({
      type: 'draft',
      label: 'Draft',
      variant: 'muted',
      surface,
    })
  }

  if (pr.ci_status && pr.ci_status !== 'none' && pr.state === 'open') {
    if (surface === 'compact') {
      const labels: Record<string, string> = {
        success: 'CI Passed',
        failure: 'CI Failed',
        pending: 'CI Pending',
      }
      chips.push({
        type: 'ci',
        label: labels[pr.ci_status] || pr.ci_status,
        variant: pr.ci_status === 'success' ? 'success' : pr.ci_status === 'failure' ? 'error' : 'pending',
        surface,
      })
    } else {
      const labels: Record<string, string> = {
        success: 'Passing',
        failure: 'Failing',
        pending: 'Running',
      }
      const icons: Record<string, PrChipIcon> = {
        success: 'check',
        failure: 'cross',
        pending: 'clock',
      }
      chips.push({
        type: 'ci',
        label: labels[pr.ci_status] || pr.ci_status,
        variant: pr.ci_status === 'success' ? 'success' : pr.ci_status === 'failure' ? 'error' : 'pending',
        icon: icons[pr.ci_status] || null,
        surface,
      })
    }
  }

  const normalizedReviewStatus = pr.review_status === 'pending' || pr.review_status === 'review_required'
    ? 'review_required'
    : pr.review_status

  if (normalizedReviewStatus && normalizedReviewStatus !== 'none' && pr.state === 'open') {
    if (surface === 'compact') {
      const labels: Record<string, string> = {
        approved: 'Approved',
        changes_requested: 'Changes Req.',
        review_required: 'Needs Review',
      }
      chips.push({
        type: 'review',
        label: labels[normalizedReviewStatus] || normalizedReviewStatus,
        variant: normalizedReviewStatus === 'approved' ? 'success' : normalizedReviewStatus === 'changes_requested' ? 'pending' : 'neutral',
        surface,
      })
    } else {
      const labels: Record<string, string> = {
        approved: 'Approved',
        changes_requested: 'Changes Requested',
        review_required: 'Review Required',
      }
      const icons: Record<string, PrChipIcon> = {
        approved: 'check',
        changes_requested: 'cross',
        review_required: 'clock',
      }
      chips.push({
        type: 'review',
        label: labels[normalizedReviewStatus] || normalizedReviewStatus,
        variant: normalizedReviewStatus === 'approved' ? 'success' : normalizedReviewStatus === 'changes_requested' ? 'pending' : 'neutral',
        icon: icons[normalizedReviewStatus] || null,
        surface,
      })
    }
  }

  if (isMergedPullRequest(pr)) {
    chips.push({
      type: 'merge',
      label: surface === 'compact' ? 'merged' : 'Merged',
      variant: 'merged',
      icon: surface === 'detail' ? 'check' : undefined,
      surface,
    })
  } else if (isClosedUnmergedPullRequest(pr)) {
    chips.push({
      type: 'merge',
      label: surface === 'compact' ? 'closed' : 'Closed',
      variant: 'closed',
      icon: surface === 'detail' ? 'cross' : undefined,
      surface,
    })
  } else if (pr.state === 'open') {
    const readiness = getMergeReadiness(pr)
    const hasMergeConflict = readiness.blockers.some((blocker) => blocker.code === 'merge_conflict')

    if (hasMergeConflict) {
      chips.push({
        type: 'merge',
        label: 'Merge Conflict',
        variant: 'error',
        icon: surface === 'detail' ? 'cross' : undefined,
        surface,
      })
    } else if (readiness.status === 'queued_pull_request') {
      chips.push({
        type: 'merge',
        label: surface === 'compact' ? 'Queued' : 'Queued Pull Request',
        variant: 'done',
        icon: surface === 'detail' ? 'check' : undefined,
        surface,
      })
    } else if (readiness.status === 'ready_to_enqueue') {
      chips.push({
        type: 'merge',
        label: 'Ready to Enqueue',
        variant: 'done',
        icon: surface === 'detail' ? 'check' : undefined,
        surface,
      })
    } else if (readiness.status === 'ready_to_merge') {
      chips.push({
        type: 'merge',
        label: 'Ready to Merge',
        variant: 'done',
        icon: surface === 'detail' ? 'check' : undefined,
        surface,
      })
    } else if (readiness.status === 'readiness_unknown') {
      chips.push({
        type: 'merge',
        label: 'Readiness Unknown',
        variant: 'neutral',
        icon: surface === 'detail' ? 'clock' : undefined,
        surface,
      })
    }
  }

  return chips
}
