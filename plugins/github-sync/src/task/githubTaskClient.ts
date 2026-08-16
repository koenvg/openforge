import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PollResult, PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'

export interface GithubTaskClient {
  listPullRequests(taskId: string): Promise<PullRequestInfo[]>
  refreshTask(taskId: string): Promise<PollResult>
  linkPullRequest(taskId: string, prUrl: string): Promise<PullRequestInfo>
  getComments(prId: number): Promise<PrComment[]>
  markCommentAddressed(commentId: number): Promise<void>
  mergePullRequest(pr: PullRequestInfo): Promise<void>
  enqueuePullRequest(pr: PullRequestInfo): Promise<void>
}

export function createGithubTaskClient(api: FrontendOpenForgeAPI): GithubTaskClient {
  let ready: Promise<void> | null = null
  const whenReady = () => ready ??= api.backend.whenReady()
  const invoke = async <T>(method: string, payload?: unknown): Promise<T> => {
    await whenReady()
    return api.backend.invoke<T>(method, payload)
  }

  return {
    listPullRequests: (taskId) => invoke('listTaskPullRequests', { taskId }),
    refreshTask: (taskId) => invoke('refreshTaskGithubStatus', { taskId }),
    linkPullRequest: (taskId, prUrl) => invoke('linkTaskPullRequest', { taskId, prUrl }),
    getComments: (prId) => invoke('getTaskPrComments', { prId }),
    markCommentAddressed: (commentId) => invoke('markTaskPrCommentAddressed', { commentId }),
    mergePullRequest: (pr) => invoke('mergeTaskPullRequest', {
      taskId: pr.ticket_id,
      prId: pr.id,
      expectedHeadSha: pr.head_sha,
    }),
    enqueuePullRequest: (pr) => invoke('enqueueTaskPullRequest', {
      taskId: pr.ticket_id,
      prId: pr.id,
      expectedHeadSha: pr.head_sha,
    }),
  }
}
