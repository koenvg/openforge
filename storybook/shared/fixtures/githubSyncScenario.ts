import type { BackendMethodRegistration } from '@openforge-app/plugin-sdk/backend'
import type { PollResult, PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import type { JiraConfig } from '../../../plugins/github-sync/src/lib/jiraStore'
import type { WalkthroughRecordV1 } from '../../../plugins/github-sync/src/lib/walkthroughRecord'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { createPullRequest } from './appFixtures'

export type GitHubSyncScenario =
  | 'connected'
  | 'disconnected'
  | 'populated'
  | 'empty'
  | 'loading'
  | 'failure'
  | 'save-failure'
  | 'test-failure'
  | 'row-generating'
  | 'row-unavailable'

const EMPTY_POLL_RESULT: PollResult = {
  new_comments: 0,
  ci_changes: 0,
  review_changes: 0,
  pr_changes: 0,
  errors: 0,
  rate_limited: false,
  rate_limit_reset_at: null,
  outcome: 'completed',
}

const CONNECTED_JIRA: JiraConfig = {
  baseUrl: 'https://openforge.atlassian.net',
  email: 'catalog@openforge.dev',
  projectKeys: 'KVG',
  acFieldId: 'customfield_12100',
}

const EMPTY_JIRA: JiraConfig = { baseUrl: '', email: '', projectKeys: '', acFieldId: '' }

const REVIEW_COMMENT: PrComment = {
  id: 101,
  pr_id: 42,
  author: 'reviewer',
  body: 'Please keep the local integration response deterministic.',
  comment_type: 'review_comment',
  file_path: 'storybook/shared/fixtures/githubSyncScenario.ts',
  line_number: 42,
  in_reply_to_id: null,
  addressed: 0,
  outdated: 0,
  created_at: Date.UTC(2026, 0, 2, 9) / 1000,
}

const READY_PR = createPullRequest({
  unaddressed_comment_count: 1,
  ci_status: 'success',
  review_status: 'approved',
  mergeable: true,
  mergeable_state: 'clean',
  merge_readiness_status: 'ready_to_merge',
  merge_readiness_action: 'merge',
  default_merge_method: 'squash',
  allowed_merge_methods: ['merge', 'squash'],
  merge_methods_policy_known: true,
})

const BLOCKED_PR = createPullRequest({
  id: 73,
  pr_number: 73,
  title: 'Handle a pull request title that overflows the Task status panel without hiding its state',
  url: 'https://github.com/openforge/openforge/pull/73',
  head_sha: 'def456',
  ci_status: 'failure',
  review_status: 'changes_requested',
  mergeable: false,
  mergeable_state: 'dirty',
  unaddressed_comment_count: 0,
  merge_readiness_status: 'blocked',
  merge_readiness_action: null,
  merge_readiness_blockers: JSON.stringify(['Required checks failed']),
  default_merge_method: null,
  allowed_merge_methods: [],
  merge_methods_policy_known: true,
})

const GENERATING_WALKTHROUGH: WalkthroughRecordV1 = {
  version: 1,
  prId: 42,
  scope: { namespace: 'github', targetKey: 'gh:openforge/openforge#42', revision: 'abc123' },
  attemptId: 'catalog-attempt-1',
  state: 'generating',
  steps: [],
  error: null,
  createdAt: Date.UTC(2026, 0, 2, 9) / 1000,
  updatedAt: Date.UTC(2026, 0, 2, 9, 25) / 1000,
}

function pendingForever(): Promise<never> {
  return new Promise(() => undefined)
}

function localBackendMethods(state: GitHubSyncScenario): Readonly<Record<string, BackendMethodRegistration>> {
  let jiraConfig = structuredClone(state === 'disconnected' ? EMPTY_JIRA : CONNECTED_JIRA)
  let tokenConfigured = state !== 'disconnected'
  let pullRequests: PullRequestInfo[] = state === 'empty' ? [] : [structuredClone(READY_PR), structuredClone(BLOCKED_PR)]
  let comments = new Map<number, PrComment[]>([[READY_PR.id, [structuredClone(REVIEW_COMMENT)]], [BLOCKED_PR.id, []]])
  let walkthrough: WalkthroughRecordV1 | null = state === 'row-generating' ? structuredClone(GENERATING_WALKTHROUGH) : null
  const fail = state === 'failure'
  const load = state === 'loading'

  function jiraSettings() {
    if (fail) throw new Error('Jira settings are unavailable.')
    if (load) return pendingForever()
    return { config: structuredClone(jiraConfig), tokenConfigured }
  }

  function taskPullRequests() {
    if (fail) throw new Error('GitHub status is unavailable.')
    if (load) return pendingForever()
    return structuredClone(pullRequests)
  }

  return {
    getJiraSettings: { handler: jiraSettings },
    saveJiraSettings: { handler: async (payload) => {
      if (state === 'save-failure') throw new Error('Jira settings could not be saved.')
      const request = payload as { config: JiraConfig; token?: string; clearToken?: boolean }
      jiraConfig = structuredClone(request.config)
      if (request.clearToken) tokenConfigured = false
      else if (request.token?.trim()) tokenConfigured = true
      return { config: structuredClone(jiraConfig), tokenConfigured }
    } },
    testJiraConnection: { handler: async () => state === 'test-failure'
      ? { ok: false, error: 'Jira rejected the catalog credentials (401).' }
      : { ok: true, displayName: 'OpenForge Catalog' } },
    listTaskPullRequests: { handler: taskPullRequests },
    getTaskPrComments: { handler: async (payload) => structuredClone(comments.get((payload as { prId: number }).prId) ?? []) },
    markTaskPrCommentAddressed: { handler: async (payload) => {
      const commentId = (payload as { commentId: number }).commentId
      comments = new Map([...comments].map(([prId, values]) => [prId, values.filter(comment => comment.id !== commentId)]))
      pullRequests = pullRequests.map(pr => pr.id === REVIEW_COMMENT.pr_id ? { ...pr, unaddressed_comment_count: 0 } : pr)
    } },
    refreshTaskGithubStatus: { handler: async () => structuredClone(EMPTY_POLL_RESULT) },
    linkTaskPullRequest: { handler: async (payload) => {
      const { taskId, prUrl } = payload as { taskId: string; prUrl: string }
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(prUrl)) throw new Error('Enter a valid GitHub pull request URL.')
      const linked = createPullRequest({ id: 99, pr_number: 99, ticket_id: taskId, title: 'Newly linked catalog pull request', url: prUrl })
      pullRequests = [...pullRequests, linked]
      comments.set(linked.id, [])
      return structuredClone(linked)
    } },
    mergeTaskPullRequest: { handler: async () => undefined },
    enqueueTaskPullRequest: { handler: async () => undefined },
    resolveGithubAsset: { handler: async () => null },
    resolveProjectIdsByRepo: { handler: async () => state === 'row-unavailable' ? {} : { 'openforge/openforge': 'project-1' } },
    getPrWalkthrough: { handler: async () => structuredClone(walkthrough) },
    startAgentWalkthrough: { handler: async () => {
      walkthrough = structuredClone(GENERATING_WALKTHROUGH)
      return { attemptId: GENERATING_WALKTHROUGH.attemptId }
    } },
    abortAgentWalkthrough: { handler: async () => { walkthrough = { ...GENERATING_WALKTHROUGH, state: 'aborted' } } },
  }
}

export function githubSyncScenario(state: GitHubSyncScenario = 'connected'): StoryScenarioDefinition {
  return {
    expectedConsoleErrors: state === 'failure' ? ['Jira settings are unavailable.'] : [],
    plugin: {
      pluginId: 'com.openforge.github-sync',
      projectId: 'project-1',
      taskId: 'T-42',
      backendMethods: () => localBackendMethods(state),
    },
  }
}
