import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { ResolvedMarkdownMedia } from '../markdown'
import type { AgentReviewComment, AuthoredPullRequest, PollResult, PrComment, PrFileDiff, PrOverviewComment, PullRequestInfo, PullRequestMergeMethod, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '../types'

export async function forceGithubSync(): Promise<PollResult> {
  return invoke<PollResult>("force_github_sync");
}

export async function refreshTaskGithubStatus(taskId: string): Promise<PollResult> {
  return invoke<PollResult>("refresh_task_github_status", { taskId });
}

/**
 * Report the renderer's poll context to the sidecar so the GitHub poller can focus-gate and
 * scope its calls: pause when the app is unfocused, poll only the active project's repo unless
 * the global PR view is open.
 */
export async function setPollContext(context: {
  focused: boolean;
  activeProjectId: string | null;
  globalViewOpen: boolean;
}): Promise<void> {
  return invoke("set_poll_context", {
    focused: context.focused,
    activeProjectId: context.activeProjectId,
    globalViewOpen: context.globalViewOpen,
  });
}

/**
 * Resolve and cache a project's GitHub repo from its git origin remote.
 * Returns null when the project has no parseable GitHub origin.
 */
export async function getProjectRepo(projectId: string): Promise<{ owner: string; name: string } | null> {
  return invoke<{ owner: string; name: string } | null>("get_project_repo", { projectId });
}

export async function getPullRequests(taskId?: string): Promise<PullRequestInfo[]> {
  return invoke<PullRequestInfo[]>("get_pull_requests", { taskId });
}

export async function linkPullRequest(taskId: string, prUrl: string): Promise<PullRequestInfo> {
  return invoke<PullRequestInfo>("link_pull_request", { taskId, prUrl });
}

export async function getPrComments(prId: number): Promise<PrComment[]> {
  return invoke<PrComment[]>("get_pr_comments", { prId });
}

export async function markCommentAddressed(commentId: number): Promise<void> {
  return invoke("mark_comment_addressed", { commentId });
}

export async function mergePullRequest(
  taskId: string,
  prId: number,
  expectedHeadSha: string,
  mergeMethod: PullRequestMergeMethod,
 ): Promise<void> {
  return invoke<void>("merge_task_pull_request", { taskId, prId, expectedHeadSha, mergeMethod });
}

export async function enqueuePullRequest(taskId: string, prId: number, expectedHeadSha: string): Promise<void> {
  return invoke<void>("enqueue_task_pull_request", { taskId, prId, expectedHeadSha });
}

export async function getGithubUsername(): Promise<string> {
  return invoke<string>("get_github_username");
}

export async function fetchReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("fetch_review_prs");
}

export async function getReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("get_review_prs");
}

export async function markReviewPrViewed(prId: number, headSha: string): Promise<void> {
  return invoke('mark_review_pr_viewed', { prId, headSha });
}

export async function markReviewPrUnviewed(prId: number): Promise<void> {
  return invoke('mark_review_pr_unviewed', { prId });
}

export async function getPrFileDiffs(owner: string, repo: string, prNumber: number): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_pr_file_diffs", { owner, repo, prNumber });
}

export async function getFileContent(owner: string, repo: string, sha: string): Promise<string> {
  return invoke<string>("get_file_content", { owner, repo, sha });
}

export async function getFileContentBase64(owner: string, repo: string, sha: string): Promise<string> {
  return invoke<string>("get_file_content_base64", { owner, repo, sha });
}

export async function getFileAtRef(owner: string, repo: string, path: string, refSha: string): Promise<string> {
  return invoke<string>("get_file_at_ref", { owner, repo, path, refSha });
}

export async function getFileAtRefBase64(owner: string, repo: string, path: string, refSha: string): Promise<string> {
  return invoke<string>("get_file_at_ref_base64", { owner, repo, path, refSha });
}

/**
 * Trade a GitHub upload URL from PR Markdown for one the renderer can load.
 * Resolves to null when GitHub will not resolve the URL for us.
 */
export async function resolveGithubAsset(owner: string, repo: string, url: string): Promise<ResolvedMarkdownMedia | null> {
  return invoke<ResolvedMarkdownMedia | null>("resolve_github_asset", { owner, repo, url });
}

export async function getReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> {
  return invoke<ReviewComment[]>("get_review_comments", { owner, repo, prNumber });
}

export async function getPrOverviewComments(owner: string, repo: string, prNumber: number): Promise<PrOverviewComment[]> {
  return invoke<PrOverviewComment[]>("get_pr_overview_comments", { owner, repo, prNumber });
}

export async function submitPrReview(owner: string, repo: string, prNumber: number, event: string, body: string, comments: ReviewSubmissionComment[], commitId: string): Promise<void> {
  return invoke<void>("submit_pr_review", { owner, repo, prNumber, event, body, comments, commitId });
}

export async function getAgentReviewComments(reviewPrId: number): Promise<AgentReviewComment[]> {
  return invoke<AgentReviewComment[]>("get_agent_review_comments", { reviewPrId });
}

export async function updateAgentReviewCommentStatus(commentId: number, status: string): Promise<void> {
  return invoke<void>("update_agent_review_comment_status", { commentId, status });
}

export async function fetchAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("fetch_authored_prs");
}

export async function getAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("get_authored_prs");
}
