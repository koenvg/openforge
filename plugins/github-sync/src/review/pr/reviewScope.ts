import type { SessionScope } from '@openforge-app/plugin-sdk'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

export function reviewScopeForPullRequest(
  pr: Pick<ReviewPullRequest, 'repo_owner' | 'repo_name' | 'number' | 'head_sha'>,
): SessionScope {
  return {
    namespace: 'github',
    targetKey: `gh:${pr.repo_owner}/${pr.repo_name}#${pr.number}`,
    revision: pr.head_sha,
  }
}
