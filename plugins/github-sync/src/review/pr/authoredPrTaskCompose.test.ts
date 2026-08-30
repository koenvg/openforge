import { describe, expect, it } from 'vitest'
import type { AuthoredPullRequest } from '@openforge-app/plugin-sdk/domain'
import { composeRequestForAuthoredPr } from './authoredPrTaskCompose'

const pr: AuthoredPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: 'This PR fixes the auth middleware',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 50,
  deletions: 10,
  changed_files: 3,
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  is_queued: false,
  task_id: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  labels: [],
}

describe('composeRequestForAuthoredPr', () => {
  it('seeds compose onto the pull request branch and URL', () => {
    expect(composeRequestForAuthoredPr('project-1', pr)).toEqual({
      projectId: 'project-1',
      initialPrompt: 'Continue work on PR #42: Fix authentication middleware',
      title: 'Fix authentication middleware',
      sourceTicketUrl: 'https://github.com/acme/repo/pull/42',
      worktreeSource: 'existingBranch',
      worktreeBranch: 'fix/auth',
    })
  })
})
