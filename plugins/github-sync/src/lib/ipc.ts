import { getPluginContext } from '../pluginContext'
import type {
  AgentReviewComment,
  AuthoredPullRequest,
  PrFileDiff,
  PrOverviewComment,
  ReviewComment,
  ReviewPullRequest,
  ReviewSubmissionComment,
} from '@openforge/plugin-sdk/domain'

function host<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return getPluginContext().invokeHost(command, payload) as Promise<T>
}

export async function fetchReviewPrs(): Promise<ReviewPullRequest[]> { return host('fetchReviewPrs') }
export async function getReviewPrs(): Promise<ReviewPullRequest[]> { return host('getReviewPrs') }
export async function fetchAuthoredPrs(): Promise<AuthoredPullRequest[]> { return host('fetchAuthoredPrs') }
export async function getAuthoredPrs(): Promise<AuthoredPullRequest[]> { return host('getAuthoredPrs') }
export async function getPrFileDiffs(owner: string, repo: string, prNumber: number): Promise<PrFileDiff[]> { return host('getPrFileDiffs', { owner, repo, prNumber }) }
export async function openUrl(url: string): Promise<void> { await host('openUrl', { url }) }
export async function getReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> { return host('getReviewComments', { owner, repo, prNumber }) }
export async function getPrOverviewComments(owner: string, repo: string, prNumber: number): Promise<PrOverviewComment[]> { return host('getPrOverviewComments', { owner, repo, prNumber }) }
export async function getFileContent(owner: string, repo: string, sha: string): Promise<string> { return host('getFileContent', { owner, repo, sha }) }
export async function getFileAtRef(owner: string, repo: string, path: string, refSha: string): Promise<string> { return host('getFileAtRef', { owner, repo, path, refSha }) }
export async function markReviewPrViewed(prId: number, headSha: string): Promise<void> { await host('markReviewPrViewed', { prId, headSha }) }
export async function startAgentReview(repoOwner: string, repoName: string, prNumber: number, headRef: string, baseRef: string, prTitle: string, prBody: string | null, reviewPrId: number): Promise<{ review_session_key: string }> { return host('startAgentReview', { repoOwner, repoName, prNumber, headRef, baseRef, prTitle, prBody, reviewPrId }) }
export async function getAgentReviewComments(reviewPrId: number): Promise<AgentReviewComment[]> { return host('getAgentReviewComments', { reviewPrId }) }
export async function updateAgentReviewCommentStatus(commentId: number, status: string): Promise<void> { await host('updateAgentReviewCommentStatus', { commentId, status }) }
export async function abortAgentReview(reviewSessionKey: string): Promise<void> { await host('abortAgentReview', { reviewSessionKey }) }
export async function getProjectConfig(projectId: string, key: string): Promise<string | null> { return host('getProjectConfig', { projectId, key }) }
export async function setProjectConfig(projectId: string, key: string, value: string): Promise<void> { await host('setProjectConfig', { projectId, key, value }) }
export async function submitPrReview(owner: string, repo: string, prNumber: number, event: string, body: string, comments: ReviewSubmissionComment[], commitId: string): Promise<void> { await host('submitPrReview', { owner, repo, prNumber, event, body, comments, commitId }) }
