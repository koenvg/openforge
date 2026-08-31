import type { PollResult, PullRequestInfo, TaskDetail, TaskLabel } from '../../lib/types'

const baseTask: TaskDetail = {
  id: 'T-42',
  prompt: 'Build the auth middleware implementation with JWT support',
  promptPreview: 'Build the auth middleware implementation with JWT support',
  status: 'backlog',
  title: 'Implement auth middleware',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  projectId: 'proj-1',
  createdAt: 1000,
  updatedAt: 2000,
  labels: [],
}

const bugLabel: TaskLabel = { id: 1, projectId: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, projectId: 'proj-1', name: 'ui' }

function taskWithLabels(labels: TaskLabel[]): TaskDetail {
  return { ...baseTask, labels }
}

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
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
    ...overrides,
  }
}

function createEmptyGithubSyncResult(): PollResult {
  return {
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
    outcome: 'completed',
  }
}

export { baseTask, bugLabel, createEmptyGithubSyncResult, createPullRequest, taskWithLabels, uiLabel }
export type { TaskDetail }
