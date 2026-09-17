import { describe, expect, it } from 'vitest'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { reviewScopeForPullRequest } from './reviewScope'

const pullRequest = {
  repo_owner: 'acme',
  repo_name: 'web',
  number: 42,
  head_sha: 'abc123',
} as ReviewPullRequest

describe('reviewScopeForPullRequest', () => {
  it('uses the GitHub review address and rotates only the revision for a new head', () => {
    expect(reviewScopeForPullRequest(pullRequest)).toEqual({
      namespace: 'github',
      targetKey: 'gh:acme/web#42',
      revision: 'abc123',
    })

    expect(reviewScopeForPullRequest({ ...pullRequest, head_sha: 'def456' })).toEqual({
      namespace: 'github',
      targetKey: 'gh:acme/web#42',
      revision: 'def456',
    })
  })
})
