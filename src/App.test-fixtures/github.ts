import type { PollResult, PullRequestInfo } from '../lib/types'

const defaultPullRequest: PullRequestInfo = {
  id: 42,
  pr_number: 42,
  ticket_id: 'task-merge',
  repo_owner: 'owner',
  repo_name: 'repo',
  title: 'Ready PR',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'open',
  head_sha: 'abc123',
  ci_status: 'success',
  ci_check_runs: null,
  review_status: 'approved',
  mergeable: true,
  mergeable_state: 'clean',
  merged_at: null,
  created_at: 1000,
  updated_at: 1000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: 0,
  merge_readiness_status: null,
  merge_readiness_action: null,
  merge_readiness_blockers: null,
  merge_readiness_warnings: null,
  readiness_source_head_sha: null,
  merge_group_sha: null,
  required_checks_policy_known: null,
  required_reviews_policy_known: null,
  merge_queue_required: null,
  merge_queue_state: null,
  readiness_updated_at: null,
  merge_methods_policy_known: true,
  allowed_merge_methods: '["squash"]',
  default_merge_method: 'squash',
}

const defaultGithubSyncResult: PollResult = {
  new_comments: 0,
  ci_changes: 0,
  review_changes: 0,
  pr_changes: 0,
  errors: 0,
  rate_limited: false,
  rate_limit_reset_at: null,
  outcome: 'completed',
}

export function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return { ...defaultPullRequest, ...overrides }
}

export function createGithubSyncResult(overrides: Partial<PollResult> = {}): PollResult {
  return { ...defaultGithubSyncResult, ...overrides }
}
