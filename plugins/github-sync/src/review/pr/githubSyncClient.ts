import type { Disposable, FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type {
  AgentReviewComment,
  AuthoredPullRequest,
  PollResult,
  PrFileDiff,
  PrOverviewComment,
  ReviewComment,
  ReviewPullRequest,
  ReviewSubmissionComment,
} from '@openforge/plugin-sdk/domain'

export interface PullRequestRepositoryRequest {
  owner: string
  repo: string
  prNumber: number
}

export interface FileContentRequest {
  owner: string
  repo: string
  sha: string
}

export interface FileAtRefRequest {
  owner: string
  repo: string
  path: string
  refSha: string
}

export interface SubmitPullRequestReviewRequest extends PullRequestRepositoryRequest {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  body: string
  comments: ReviewSubmissionComment[]
  commitId: string
}

export interface GithubSyncPrReviewClient {
  syncPullRequests(): Promise<PollResult>
  listReviewPullRequests(): Promise<ReviewPullRequest[]>
  refreshReviewPullRequests(): Promise<ReviewPullRequest[]>
  listAuthoredPullRequests(): Promise<AuthoredPullRequest[]>
  refreshAuthoredPullRequests(): Promise<AuthoredPullRequest[]>
  markReviewPullRequestViewed(request: { prId: number; headSha: string }): Promise<void>
  listPullRequestFileDiffs(request: PullRequestRepositoryRequest): Promise<PrFileDiff[]>
  getFileContent(request: FileContentRequest): Promise<string>
  getFileAtRef(request: FileAtRefRequest): Promise<string>
  listReviewComments(request: PullRequestRepositoryRequest): Promise<ReviewComment[]>
  listPullRequestOverviewComments(request: PullRequestRepositoryRequest): Promise<PrOverviewComment[]>
  submitPullRequestReview(request: SubmitPullRequestReviewRequest): Promise<void>
  listAgentReviewComments(request: { reviewPrId: number }): Promise<AgentReviewComment[]>
  updateAgentReviewCommentStatus(request: { commentId: number; status: string }): Promise<void>
  onAuthoredPullRequestsUpdated(handler: () => void): Disposable
  onReviewPullRequestCountChanged(handler: () => void): Disposable
}

const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

function hostCommandId(command: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${command}`
}

function hostEventId(event: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${event}`
}

export function createGithubSyncPrReviewClient(api: Pick<FrontendOpenForgeAPI, 'commands' | 'events'>): GithubSyncPrReviewClient {
  return {
    syncPullRequests: () => api.commands.invokeGlobal<PollResult>(hostCommandId('forceGithubSync')),
    listReviewPullRequests: () => api.commands.invokeGlobal<ReviewPullRequest[]>(hostCommandId('getReviewPrs')),
    refreshReviewPullRequests: () => api.commands.invokeGlobal<ReviewPullRequest[]>(hostCommandId('fetchReviewPrs')),
    listAuthoredPullRequests: () => api.commands.invokeGlobal<AuthoredPullRequest[]>(hostCommandId('getAuthoredPrs')),
    refreshAuthoredPullRequests: () => api.commands.invokeGlobal<AuthoredPullRequest[]>(hostCommandId('fetchAuthoredPrs')),
    markReviewPullRequestViewed: ({ prId, headSha }) => api.commands.invokeGlobal<void>(hostCommandId('markReviewPrViewed'), { prId, headSha }),
    listPullRequestFileDiffs: ({ owner, repo, prNumber }) => api.commands.invokeGlobal<PrFileDiff[]>(hostCommandId('getPrFileDiffs'), { owner, repo, prNumber }),
    getFileContent: ({ owner, repo, sha }) => api.commands.invokeGlobal<string>(hostCommandId('getFileContent'), { owner, repo, sha }),
    getFileAtRef: ({ owner, repo, path, refSha }) => api.commands.invokeGlobal<string>(hostCommandId('getFileAtRef'), { owner, repo, path, refSha }),
    listReviewComments: ({ owner, repo, prNumber }) => api.commands.invokeGlobal<ReviewComment[]>(hostCommandId('getReviewComments'), { owner, repo, prNumber }),
    listPullRequestOverviewComments: ({ owner, repo, prNumber }) => api.commands.invokeGlobal<PrOverviewComment[]>(hostCommandId('getPrOverviewComments'), { owner, repo, prNumber }),
    submitPullRequestReview: ({ owner, repo, prNumber, event, body, comments, commitId }) => api.commands.invokeGlobal<void>(hostCommandId('submitPrReview'), {
      owner,
      repo,
      prNumber,
      event,
      body,
      comments,
      commitId,
    }),
    listAgentReviewComments: ({ reviewPrId }) => api.commands.invokeGlobal<AgentReviewComment[]>(hostCommandId('getAgentReviewComments'), { reviewPrId }),
    updateAgentReviewCommentStatus: ({ commentId, status }) => api.commands.invokeGlobal<void>(hostCommandId('updateAgentReviewCommentStatus'), { commentId, status }),
    onAuthoredPullRequestsUpdated: (handler) => api.events.onGlobal(hostEventId('authored-prs-updated'), handler),
    onReviewPullRequestCountChanged: (handler) => api.events.onGlobal(hostEventId('review-pr-count-changed'), handler),
  }
}
