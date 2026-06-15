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
  getFileContentBase64(request: FileContentRequest): Promise<string>
  getFileAtRef(request: FileAtRefRequest): Promise<string>
  getFileAtRefBase64(request: FileAtRefRequest): Promise<string>
  listReviewComments(request: PullRequestRepositoryRequest): Promise<ReviewComment[]>
  listPullRequestOverviewComments(request: PullRequestRepositoryRequest): Promise<PrOverviewComment[]>
  submitPullRequestReview(request: SubmitPullRequestReviewRequest): Promise<void>
  listAgentReviewComments(request: { reviewPrId: number }): Promise<AgentReviewComment[]>
  updateAgentReviewCommentStatus(request: { commentId: number; status: string }): Promise<void>
  onAuthoredPullRequestsUpdated(handler: () => void): Disposable
  onReviewPullRequestCountChanged(handler: () => void): Disposable
}

const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

function hostEventId(event: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${event}`
}

async function invokeBackend<TOutput>(api: Pick<FrontendOpenForgeAPI, 'backend'>, method: string, payload?: unknown): Promise<TOutput> {
  await api.backend.whenReady()
  return api.backend.invoke<TOutput>(method, payload)
}

export function createGithubSyncPrReviewClient(api: Pick<FrontendOpenForgeAPI, 'backend' | 'events'>): GithubSyncPrReviewClient {
  return {
    syncPullRequests: () => invokeBackend<PollResult>(api, 'forceGithubSync'),
    listReviewPullRequests: () => invokeBackend<ReviewPullRequest[]>(api, 'getReviewPrs'),
    refreshReviewPullRequests: () => invokeBackend<ReviewPullRequest[]>(api, 'fetchReviewPrs'),
    listAuthoredPullRequests: () => invokeBackend<AuthoredPullRequest[]>(api, 'getAuthoredPrs'),
    refreshAuthoredPullRequests: () => invokeBackend<AuthoredPullRequest[]>(api, 'fetchAuthoredPrs'),
    markReviewPullRequestViewed: ({ prId, headSha }) => invokeBackend<void>(api, 'markReviewPrViewed', { prId, headSha }),
    listPullRequestFileDiffs: ({ owner, repo, prNumber }) => invokeBackend<PrFileDiff[]>(api, 'getPrFileDiffs', { owner, repo, prNumber }),
    getFileContent: ({ owner, repo, sha }) => invokeBackend<string>(api, 'getFileContent', { owner, repo, sha }),
    getFileContentBase64: ({ owner, repo, sha }) => invokeBackend<string>(api, 'getFileContentBase64', { owner, repo, sha }),
    getFileAtRef: ({ owner, repo, path, refSha }) => invokeBackend<string>(api, 'getFileAtRef', { owner, repo, path, refSha }),
    getFileAtRefBase64: ({ owner, repo, path, refSha }) => invokeBackend<string>(api, 'getFileAtRefBase64', { owner, repo, path, refSha }),
    listReviewComments: ({ owner, repo, prNumber }) => invokeBackend<ReviewComment[]>(api, 'getReviewComments', { owner, repo, prNumber }),
    listPullRequestOverviewComments: ({ owner, repo, prNumber }) => invokeBackend<PrOverviewComment[]>(api, 'getPrOverviewComments', { owner, repo, prNumber }),
    submitPullRequestReview: ({ owner, repo, prNumber, event, body, comments, commitId }) => invokeBackend<void>(api, 'submitPrReview', {
      owner,
      repo,
      prNumber,
      event,
      body,
      comments,
      commitId,
    }),
    listAgentReviewComments: ({ reviewPrId }) => invokeBackend<AgentReviewComment[]>(api, 'getAgentReviewComments', { reviewPrId }),
    updateAgentReviewCommentStatus: ({ commentId, status }) => invokeBackend<void>(api, 'updateAgentReviewCommentStatus', { commentId, status }),
    onAuthoredPullRequestsUpdated: (handler) => api.events.onGlobal(hostEventId('authored-prs-updated'), handler),
    onReviewPullRequestCountChanged: (handler) => api.events.onGlobal(hostEventId('review-pr-count-changed'), handler),
  }
}
