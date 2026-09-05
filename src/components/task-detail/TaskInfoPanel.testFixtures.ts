import {
  createPullRequest as createFixturePullRequest,
  createTask,
} from '../../../storybook/shared/fixtures/appFixtures'
import type { PollResult, PullRequestInfo, TaskDetail, TaskLabel } from '../../lib/types'

const baseTask: TaskDetail = createTask({
  prompt: 'Build the auth middleware implementation with JWT support',
  promptPreview: 'Build the auth middleware implementation with JWT support',
  status: 'backlog',
  title: 'Implement auth middleware',
  projectId: 'proj-1',
  createdAt: 1000,
  updatedAt: 2000,
})

const bugLabel: TaskLabel = { id: 1, projectId: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, projectId: 'proj-1', name: 'ui' }

function taskWithLabels(labels: TaskLabel[]): TaskDetail {
  return { ...baseTask, labels }
}

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return createFixturePullRequest({
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  })
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
