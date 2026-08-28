import type { Disposable, FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
import type {
  AgentReviewComment,
  AiThread,
  AuthoredPullRequest,
  PollResult,
  PrFileDiff,
  PrOverviewComment,
  PrWalkthrough,
  ReviewComment,
  ReviewPullRequest,
  ReviewSubmissionComment,
} from '@openforge-app/plugin-sdk/domain'
import type { TicketSnapshot } from '../../lib/ticketCoverage'

export type PullRequestRepositoryRequest = {
  owner: string
  repo: string
  prNumber: number
}

export type FileContentRequest = {
  owner: string
  repo: string
  sha: string
}

export type FileAtRefRequest = {
  owner: string
  repo: string
  path: string
  refSha: string
}

export type GithubAssetRequest = {
  owner: string
  repo: string
  url: string
}

export type SubmitPullRequestReviewRequest = PullRequestRepositoryRequest & {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  body: string
  comments: ReviewSubmissionComment[]
  commitId: string
}

export type ReplyToReviewCommentRequest = PullRequestRepositoryRequest & {
  commentId: number
  body: string
}

export type CreateReviewCommentRequest = PullRequestRepositoryRequest & {
  commitId: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
}

export interface GithubSyncPrReviewClient {
  syncPullRequests(): Promise<PollResult>
  listReviewPullRequests(): Promise<ReviewPullRequest[]>
  refreshReviewPullRequests(): Promise<ReviewPullRequest[]>
  listAuthoredPullRequests(): Promise<AuthoredPullRequest[]>
  refreshAuthoredPullRequests(): Promise<AuthoredPullRequest[]>
  markReviewPullRequestViewed(request: { prId: number; headSha: string }): Promise<void>
  markReviewPullRequestUnviewed(request: { prId: number }): Promise<void>
  listPullRequestFileDiffs(request: PullRequestRepositoryRequest): Promise<PrFileDiff[]>
  getFileContent(request: FileContentRequest): Promise<string>
  getFileContentBase64(request: FileContentRequest): Promise<string>
  getFileAtRef(request: FileAtRefRequest): Promise<string>
  getFileAtRefBase64(request: FileAtRefRequest): Promise<string>
  resolveGithubAsset(request: GithubAssetRequest): Promise<ResolvedMarkdownMedia | null>
  listReviewComments(request: PullRequestRepositoryRequest): Promise<ReviewComment[]>
  listPullRequestOverviewComments(request: PullRequestRepositoryRequest): Promise<PrOverviewComment[]>
  submitPullRequestReview(request: SubmitPullRequestReviewRequest): Promise<void>
  replyToReviewComment(request: ReplyToReviewCommentRequest): Promise<void>
  createReviewComment(request: CreateReviewCommentRequest): Promise<void>
  listAgentReviewComments(request: { reviewPrId: number }): Promise<AgentReviewComment[]>
  updateAgentReviewCommentStatus(request: { commentId: number; status: string }): Promise<void>
  getPrAiReviewComments(request: { reviewPrId: number; headSha: string }): Promise<AgentReviewComment[]>
  updatePrAiReviewCommentStatus(request: { reviewPrId: number; headSha: string; commentId: number; status: string }): Promise<void>
  getPrWalkthrough(request: { reviewPrId: number; headSha: string }): Promise<PrWalkthrough | null>
  deletePrWalkthrough(request: { reviewPrId: number; headSha: string }): Promise<void>
  /** The Jira ticket resolved for this PR, plus whether Jira is configured at all. */
  getPrTicket(request: { reviewPrId: number; headSha: string }): Promise<{
    snapshot: TicketSnapshot | null
    jiraConfigured: boolean
  }>
  /** Override which ticket this PR implements. Regenerate to pick it up. */
  setPrJiraKey(request: { reviewPrId: number; issueKey: string | null }): Promise<void>
  startAgentWalkthrough(request: {
    repoOwner: string
    repoName: string
    prNumber: number
    headRef: string
    baseRef: string
    prTitle: string
    prBody: string | null
    headSha: string
    reviewPrId: number
    projectId: string | null
    reviewGuidance: string
    walkthroughGuidance: string
  }): Promise<{ walkthrough_session_key: string }>
  abortAgentWalkthrough(request: { walkthroughSessionKey: string }): Promise<void>
  getAiThreads(request: { reviewPrId: number; headSha: string }): Promise<AiThread[]>
  saveAiThread(request: { reviewPrId: number; headSha: string; thread: AiThread }): Promise<void>
  deleteAiThread(request: { reviewPrId: number; headSha: string; threadId: string }): Promise<void>
  askAgentQuestions(request: {
    reviewPrId: number
    headSha: string
    repoOwner: string
    repoName: string
    prNumber: number
    projectId: string | null
  }): Promise<void>
  onAuthoredPullRequestsUpdated(handler: () => void): Disposable
  onReviewPullRequestCountChanged(handler: () => void): Disposable
  onViewInvoked(handler: (payload: { view: string }) => void): Disposable
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
    markReviewPullRequestUnviewed: ({ prId }) => invokeBackend<void>(api, 'markReviewPrUnviewed', { prId }),
    listPullRequestFileDiffs: ({ owner, repo, prNumber }) => invokeBackend<PrFileDiff[]>(api, 'getPrFileDiffs', { owner, repo, prNumber }),
    getFileContent: ({ owner, repo, sha }) => invokeBackend<string>(api, 'getFileContent', { owner, repo, sha }),
    getFileContentBase64: ({ owner, repo, sha }) => invokeBackend<string>(api, 'getFileContentBase64', { owner, repo, sha }),
    getFileAtRef: ({ owner, repo, path, refSha }) => invokeBackend<string>(api, 'getFileAtRef', { owner, repo, path, refSha }),
    getFileAtRefBase64: ({ owner, repo, path, refSha }) => invokeBackend<string>(api, 'getFileAtRefBase64', { owner, repo, path, refSha }),
    resolveGithubAsset: ({ owner, repo, url }) => invokeBackend<ResolvedMarkdownMedia | null>(api, 'resolveGithubAsset', { owner, repo, url }),
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
    replyToReviewComment: ({ owner, repo, prNumber, commentId, body }) => invokeBackend<void>(api, 'replyToReviewComment', {
      owner,
      repo,
      prNumber,
      commentId,
      body,
    }),
    createReviewComment: ({ owner, repo, prNumber, commitId, path, line, side, body }) => invokeBackend<void>(api, 'createReviewComment', {
      owner,
      repo,
      prNumber,
      commitId,
      path,
      line,
      side,
      body,
    }),
    listAgentReviewComments: ({ reviewPrId }) => invokeBackend<AgentReviewComment[]>(api, 'getAgentReviewComments', { reviewPrId }),
    updateAgentReviewCommentStatus: ({ commentId, status }) => invokeBackend<void>(api, 'updateAgentReviewCommentStatus', { commentId, status }),
    getPrAiReviewComments: ({ reviewPrId, headSha }) => invokeBackend<AgentReviewComment[]>(api, 'getPrAiReviewComments', { reviewPrId, headSha }),
    updatePrAiReviewCommentStatus: ({ reviewPrId, headSha, commentId, status }) => invokeBackend<void>(api, 'updatePrAiReviewCommentStatus', { reviewPrId, headSha, commentId, status }),
    getPrWalkthrough: ({ reviewPrId, headSha }) => invokeBackend<PrWalkthrough | null>(api, 'getPrWalkthrough', { reviewPrId, headSha }),
    deletePrWalkthrough: ({ reviewPrId, headSha }) => invokeBackend<void>(api, 'deletePrWalkthrough', { reviewPrId, headSha }),
    getPrTicket: ({ reviewPrId, headSha }) => invokeBackend<{ snapshot: TicketSnapshot | null; jiraConfigured: boolean }>(api, 'getPrTicket', { reviewPrId, headSha }),
    setPrJiraKey: ({ reviewPrId, issueKey }) => invokeBackend<void>(api, 'setPrJiraKey', { reviewPrId, issueKey }),
    startAgentWalkthrough: (request) => invokeBackend<{ walkthrough_session_key: string }>(api, 'startAgentWalkthrough', request),
    abortAgentWalkthrough: ({ walkthroughSessionKey }) => invokeBackend<void>(api, 'abortAgentWalkthrough', { walkthroughSessionKey }),
    getAiThreads: ({ reviewPrId, headSha }) => invokeBackend<AiThread[]>(api, 'getAiThreads', { reviewPrId, headSha }),
    saveAiThread: ({ reviewPrId, headSha, thread }) => invokeBackend<void>(api, 'saveAiThread', { reviewPrId, headSha, thread }),
    deleteAiThread: ({ reviewPrId, headSha, threadId }) => invokeBackend<void>(api, 'deleteAiThread', { reviewPrId, headSha, threadId }),
    askAgentQuestions: (request) => invokeBackend<void>(api, 'askAgentQuestions', request),
    onAuthoredPullRequestsUpdated: (handler) => api.events.onGlobal(hostEventId('authored-prs-updated'), handler),
    onReviewPullRequestCountChanged: (handler) => api.events.onGlobal(hostEventId('review-pr-count-changed'), handler),
    onViewInvoked: (handler) => api.events.onGlobal<{ view: string }>(hostEventId('view-invoked'), handler),
  }
}
