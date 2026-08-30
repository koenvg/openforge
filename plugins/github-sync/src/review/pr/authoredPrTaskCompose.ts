import type { AuthoredPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { ComposeTaskRequest } from '@openforge-app/plugin-sdk'

export function composeRequestForAuthoredPr(
  projectId: string,
  pr: AuthoredPullRequest,
): ComposeTaskRequest {
  return {
    projectId,
    initialPrompt: `Continue work on PR #${pr.number}: ${pr.title}`,
    title: pr.title,
    sourceTicketUrl: pr.html_url,
    worktreeSource: 'existingBranch',
    worktreeBranch: pr.head_ref,
  }
}
