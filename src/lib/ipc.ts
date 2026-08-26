import { invokeDesktopCommand as invoke } from "./desktopIpc";
import { normalizeTask } from "./boardStatus"
import type { ConfigureStartPromptContributionRequest, JsonValue, StartPromptContribution, TaskFollowUpReceipt } from '@openforge-app/plugin-sdk'
import type {
  PtyBufferState,
  TerminalImageProtocol,
  TerminalQueryResponseWrite,
} from '@openforge-app/terminal-runtime'
import type { AgentReviewComment, AgentSession, AuthoredPullRequest, AutocompleteAgentInfo, BoardStatus, CommandInfo, CommitInfo, CompanionGatewayStatus, DeveloperLogEntry, DeveloperLogSnapshot, DivergenceResolution, ExistingBranchPlan, FileContent, FileEntry, GitBranchInfo, GitStatusSummary, ImplementationStatus, PollResult, PrComment, PrFileDiff, PrOverviewComment, Project, ProjectAttention, ProviderModelInfo, PullRequestInfo, ReviewComment, ReviewPullRequest, ReviewSubmissionComment, Task, TaskAttentionRow, TaskLabel, TaskWorkspaceInfo, TranscriptionResult, WhisperModelSizeId, WhisperModelStatus, WorktreeInfo, WorktreeSource, WritableBoardStatus } from "./types";
import type { CompanionPairedDevice, CompanionPairingSession } from './types'
import type { PullRequestMergeMethod } from './types'
import type { ResolvedMarkdownMedia } from './markdown'

type RawTask = Omit<Task, 'status'> & { status: string }

export interface CreateTaskOptions {
  dependsOn?: string[]
  labelNames?: string[]
  worktreeSource?: WorktreeSource | null
  worktreeBranch?: string | null
  /** Explicit display title; null/empty falls back to the prompt-derived title. */
  title?: string | null
  /** Optional link to the source ticket (e.g. GitHub issue / Jira URL); null/empty stores nothing. */
  sourceTicketUrl?: string | null
  /** Task-level cleanup override; omit to inherit the project/global default. */
  codeCleanupEnabled?: boolean
  /** Task-level title-auto-update override; omit to inherit the project/global default. */
  taskDisplayTitleUpdatesEnabled?: boolean
  /** Task-level AI provider override; null/omit to inherit the project/global default. */
  aiProvider?: string | null
}

export async function createTask(initialPrompt: string, status: BoardStatus, projectId: string | null, permissionMode: string | null, options: CreateTaskOptions = {}): Promise<Task> {
  const {
    dependsOn = [],
    labelNames = [],
    worktreeSource = null,
    worktreeBranch = null,
    title = null,
    sourceTicketUrl = null,
    codeCleanupEnabled,
    taskDisplayTitleUpdatesEnabled,
    aiProvider = null,
  } = options
  const task = await invoke<RawTask>("create_task", { initialPrompt, status, projectId, permissionMode, dependsOn, labelNames, worktreeSource, worktreeBranch, title, sourceTicketUrl, codeCleanupEnabled, taskDisplayTitleUpdatesEnabled, aiProvider });
  return normalizeTask(task)
}

export async function updateTaskInitialPrompt(id: string, initialPrompt: string): Promise<void> {
  return invoke("update_task", { id, initialPrompt });
}

export async function updateTaskTitle(id: string, title: string): Promise<void> {
  return invoke("update_task_title", { id, title });
}


export async function updateTaskSourceTicketUrl(id: string, sourceTicketUrl: string | null): Promise<void> {
  return invoke("update_task_source_ticket_url", { id, sourceTicketUrl });
}

export async function updateTaskStatus(id: string, status: WritableBoardStatus): Promise<void> {
  return invoke("update_task_status", { id, status });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export async function getAppMode(): Promise<string> {
  return invoke<string>("get_app_mode");
}

export async function getGitBranch(): Promise<string> {
  return invoke<string>("get_git_branch");
}


export async function createProject(name: string, path: string): Promise<Project> {
  return invoke<Project>("create_project", { name, path });
}

export async function createProjectFromGit(args: {
  url: string
  parentDir: string
  name: string
}): Promise<Project> {
  return invoke<Project>("create_project_from_git", { url: args.url, parentDir: args.parentDir, name: args.name });
}

export async function createProjectFromNewRepo(args: {
  name: string
  parentDir: string
  private: boolean
}): Promise<Project> {
  return invoke<Project>("create_project_from_new_repo", { name: args.name, parentDir: args.parentDir, private: args.private });
}

export async function getProjects(): Promise<Project[]> {
  return invoke<Project[]>("get_projects");
}

export async function updateProject(id: string, name: string, path: string): Promise<void> {
  return invoke("update_project", { id, name, path });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export async function getProjectAttention(): Promise<ProjectAttention[]> {
  return invoke<ProjectAttention[]>("get_project_attention");
}

export async function getTaskAttention(): Promise<TaskAttentionRow[]> {
  return invoke<TaskAttentionRow[]>("get_task_attention");
}

export async function getProjectConfig(projectId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_project_config", { projectId, key });
}

export async function getResolvedAiProvider(projectId: string): Promise<string> {
  return invoke<string>("resolve_ai_provider", { projectId });
}

export async function setProjectConfig(projectId: string, key: string, value: string): Promise<void> {
  return invoke("set_project_config", { projectId, key, value });
}

export async function configureStartPromptContribution(
  ownerPluginId: string | undefined,
  request: ConfigureStartPromptContributionRequest,
): Promise<StartPromptContribution[]> {
  const order = request.order ?? 0;
  if (!Number.isSafeInteger(order)) {
    throw new Error('start prompt contribution order must be a safe integer');
  }
  return invoke<StartPromptContribution[]>("configure_start_prompt_contribution", {
    ownerPluginId: ownerPluginId ?? null,
    projectId: request.projectId,
    id: request.id,
    enabled: request.enabled !== false,
    content: request.content,
    order,
  });
}

export async function clearProjectConfig(projectId: string, key: string): Promise<void> {
  return invoke("clear_project_config", { projectId, key });
}

export async function getTaskConfig(taskId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_task_config", { taskId, key });
}

export async function setTaskConfig(taskId: string, key: string, value: string): Promise<void> {
  return invoke("set_task_config", { taskId, key, value });
}

export async function resetProjectSettingsToGlobal(projectId: string): Promise<void> {
  return invoke("reset_project_settings_to_global", { projectId });
}

export async function getAllTasks(): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks");
  return tasks.map(normalizeTask)
}

export async function getTasksForProject(projectId: string, includeDone = false): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks_for_project", { projectId, includeDone });
  return tasks.map(normalizeTask)
}

export async function getProjectTaskLabels(projectId: string): Promise<TaskLabel[]> {
  return invoke<TaskLabel[]>("get_project_task_labels", { projectId })
}

export async function createTaskLabel(projectId: string, name: string): Promise<TaskLabel> {
  return invoke<TaskLabel>("create_task_label", { projectId, name })
}

export async function addTaskLabel(taskId: string, name: string): Promise<TaskLabel> {
  return invoke<TaskLabel>("add_task_label", { taskId, name })
}

export async function removeTaskLabel(taskId: string, labelId: number): Promise<void> {
  return invoke("remove_task_label", { taskId, labelId })
}

export async function deleteTaskLabel(labelId: number): Promise<void> {
  return invoke("delete_task_label", { labelId })
}

export async function startImplementation(
  taskId: string,
  repoPath: string,
  divergenceResolution: DivergenceResolution | null = null,
  terminalImageProtocol: TerminalImageProtocol | null = null,
  promptPrefix: string | null = null,
): Promise<ImplementationStatus> {
  return invoke<ImplementationStatus>("start_implementation", {
    taskId,
    repoPath,
    divergenceResolution,
    terminalImageProtocol,
    promptPrefix,
  });
}


export async function getWorktreeForTask(taskId: string): Promise<WorktreeInfo | null> {
  return invoke<WorktreeInfo | null>("get_worktree_for_task", { taskId });
}

export async function listGitBranches(repoPath: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("list_git_branches", { repoPath });
}

export async function repoHasCommits(repoPath: string): Promise<boolean> {
  return invoke<boolean>("repo_has_commits", { repoPath });
}

export async function inspectExistingBranch(repoPath: string, branch: string): Promise<ExistingBranchPlan> {
  return invoke<ExistingBranchPlan>("inspect_existing_branch", { repoPath, branch });
}

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null> {
  return invoke<TaskWorkspaceInfo | null>("get_task_workspace", { taskId });
}

export async function getSessionStatus(sessionId: string): Promise<AgentSession> {
  return invoke<AgentSession>("get_session_status", { sessionId });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort_session", { sessionId });
}

export async function forceGithubSync(): Promise<PollResult> {
  return invoke<PollResult>("force_github_sync");
}

export async function refreshTaskGithubStatus(taskId: string): Promise<PollResult> {
  return invoke<PollResult>("refresh_task_github_status", { taskId });
}

/**
 * Report the renderer's poll context to the sidecar so the GitHub poller can
 * focus-gate and scope its calls: pause when the app is unfocused, poll only the
 * active project's repo unless the global PR view is open.
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
 * Resolve (and cache) a project's GitHub repo (owner/name) from its git origin
 * remote. Returns null when the project has no parseable GitHub origin. Used to
 * scope the per-repo PR view to "the repo you're in".
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

export async function openInEditor(path: string): Promise<void> {
  return invoke("open_in_editor", { path });
}

export async function hasVsCodeProtocolHandler(): Promise<boolean> {
  return invoke<boolean>("has_vscode_protocol_handler");
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export async function getDeveloperLogs(limit?: number): Promise<DeveloperLogEntry[]> {
  return limit === undefined
    ? invoke<DeveloperLogEntry[]>("get_developer_logs")
    : invoke<DeveloperLogEntry[]>("get_developer_logs", { limit });
}

export async function getDeveloperLogSnapshot(limit?: number): Promise<DeveloperLogSnapshot> {
  return limit === undefined
    ? invoke<DeveloperLogSnapshot>("get_developer_log_snapshot")
    : invoke<DeveloperLogSnapshot>("get_developer_log_snapshot", { limit });
}

export async function selectDirectory(options: {
  defaultPath?: string
  buttonLabel?: string
  message?: string
} = {}): Promise<string | null> {
  const { defaultPath, buttonLabel, message } = options;
  return invoke<string | null>("select_directory", { defaultPath, buttonLabel, message });
}

export async function writeClipboardText(text: string): Promise<void> {
  return invoke("write_clipboard_text", { text });
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

export async function checkOpenCodeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_opencode_installed");
}

export async function checkPiInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_pi_installed");
}

export async function checkCodexInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_codex_installed");
}

export async function checkGrokInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }> {
  return invoke<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>("check_grok_installed");
}

export async function checkClaudeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }> {
  return invoke<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>("check_claude_installed");
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke("set_config", { key, value });
}

export async function getCompanionGatewayStatus(): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>("get_companion_gateway_status");
}

export async function setCompanionGatewayEnabled(enabled: boolean): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>("set_companion_gateway_enabled", { enabled });
}

export async function setCompanionTailscaleHostname(hostname: string): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>('set_companion_tailscale_hostname', { hostname })
}

export async function startCompanionPairing(): Promise<CompanionPairingSession> {
  return invoke<CompanionPairingSession>('start_companion_pairing')
}

export async function getCompanionPairingStatus(): Promise<CompanionPairingSession | null> {
  return invoke<CompanionPairingSession | null>('get_companion_pairing_status')
}

export async function cancelCompanionPairing(sessionId: string): Promise<void> {
  return invoke('cancel_companion_pairing', { sessionId })
}

export async function approveCompanionPairing(requestId: string): Promise<void> {
  return invoke('approve_companion_pairing', { requestId })
}

export async function rejectCompanionPairing(requestId: string): Promise<void> {
  return invoke('reject_companion_pairing', { requestId })
}

export async function listCompanionDevices(): Promise<CompanionPairedDevice[]> {
  return invoke<CompanionPairedDevice[]>('list_companion_devices')
}

export async function revokeCompanionDevice(deviceId: string): Promise<void> {
  return invoke('revoke_companion_device', { deviceId })
}

export async function removeCompanionDevice(deviceId: string): Promise<void> {
  return invoke('remove_companion_device', { deviceId })
}

export async function resetCompanionHostIdentity(): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>('reset_companion_host_identity')
}

export async function getTaskDetail(taskId: string): Promise<Task> {
  const task = await invoke<RawTask>("get_task_detail", { taskId });
  return normalizeTask(task)
}

export async function getLatestSession(taskId: string): Promise<AgentSession | null> {
  return invoke<AgentSession | null>("get_latest_session", { taskId });
}

export async function sendAgentFollowUp(taskId: string, message: string): Promise<TaskFollowUpReceipt> {
  return invoke<TaskFollowUpReceipt>('send_agent_follow_up', { taskId, message })
}

export async function getLatestSessions(taskIds: string[]): Promise<AgentSession[]> {
  return invoke<AgentSession[]>("get_latest_sessions", { taskIds });
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

export async function spawnShellPty(
  taskId: string,
  cwd: string,
  cols: number,
  rows: number,
  terminalIndex: number,
  terminalImageProtocol: TerminalImageProtocol | null = null,
): Promise<number> {
  return invoke<number>("pty_spawn_shell", {
    taskId,
    cwd,
    cols,
    rows,
    terminalIndex,
    terminalImageProtocol,
  });
}

export async function writePty(shellSessionKey: string, data: string): Promise<void> {
  return invoke("pty_write", { shellSessionKey, data });
}

export async function writeTerminalQueryResponse(
  response: TerminalQueryResponseWrite,
): Promise<void> {
  return invoke('pty_write_terminal_query_response', {
    shellSessionKey: response.shellSessionKey,
    ptyInstanceId: response.ptyInstanceId,
    data: response.data,
  })
}

export async function resizePty(shellSessionKey: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { shellSessionKey, cols, rows });
}

export async function killPty(shellSessionKey: string): Promise<void> {
  return invoke("pty_kill", { shellSessionKey });
}

export async function killShellsForTask(taskId: string): Promise<void> {
  return invoke("pty_kill_shells_for_task", { taskId });
}

export async function getPtyBuffer(shellSessionKey: string): Promise<PtyBufferState> {
  return invoke<PtyBufferState>("get_pty_buffer", { shellSessionKey });
}


export async function getTaskDiff(taskId: string, includeCommitted: boolean, includeUncommitted: boolean): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_task_diff", { taskId, includeCommitted, includeUncommitted });
}

export async function getTaskGitStatus(taskId: string): Promise<GitStatusSummary> {
  return invoke<GitStatusSummary>("get_task_git_status", { taskId });
}

export async function getTaskFileContents(taskId: string, path: string, oldPath: string | null, status: string, includeCommitted: boolean, includeUncommitted: boolean): Promise<[string, string]> {
  return invoke<[string, string]>("get_task_file_contents", { taskId, path, oldPath, status, includeCommitted, includeUncommitted });
}

export interface FileContentRequest {
  path: string;
  oldPath: string | null;
  status: string;
}

export async function getTaskBatchFileContents(taskId: string, files: FileContentRequest[], includeCommitted: boolean, includeUncommitted: boolean): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_task_batch_file_contents", { taskId, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })), includeCommitted, includeUncommitted });
}


export async function getTaskCommits(taskId: string): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_task_commits", { taskId });
}

export async function getCommitDiff(taskId: string, commitSha: string): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_commit_diff", { taskId, commitSha });
}

export async function getCommitFileContents(taskId: string, commitSha: string, path: string, oldPath: string | null, status: string): Promise<[string, string]> {
  return invoke<[string, string]>("get_commit_file_contents", { taskId, commitSha, path, oldPath, status });
}

export async function getCommitBatchFileContents(taskId: string, commitSha: string, files: FileContentRequest[]): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_commit_batch_file_contents", { taskId, commitSha, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })) });
}

export async function getAgentReviewComments(reviewPrId: number): Promise<AgentReviewComment[]> {
  return invoke<AgentReviewComment[]>("get_agent_review_comments", { reviewPrId });
}

export async function updateAgentReviewCommentStatus(commentId: number, status: string): Promise<void> {
  return invoke<void>("update_agent_review_comment_status", { commentId, status });
}

export async function listOpenCodeCommands(projectId: string): Promise<CommandInfo[]> {
  return invoke<CommandInfo[]>("list_opencode_commands", { projectId });
}

export async function searchOpenCodeFiles(projectId: string, query: string): Promise<string[]> {
  return invoke<string[]>("search_opencode_files", { projectId, query });
}

export async function listOpenCodeAgents(projectId: string): Promise<AutocompleteAgentInfo[]> {
  return invoke<AutocompleteAgentInfo[]>("list_opencode_agents", { projectId });
}

export async function listOpenCodeModels(projectId: string): Promise<ProviderModelInfo[]> {
  return invoke<ProviderModelInfo[]>("list_opencode_models", { projectId });
}

function encodeFloat32PcmBase64(audioData: Float32Array): string {
  const bytes = new Uint8Array(audioData.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < audioData.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, audioData[index], true);
  }

  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let chunk = "";
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) {
      chunk += String.fromCharCode(bytes[index]);
    }
    binary += chunk;
  }

  return btoa(binary);
}

export async function transcribeAudio(audioData: Float32Array): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", { audioPcmBase64: encodeFloat32PcmBase64(audioData) });
}

export async function getWhisperModelStatus(): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("get_whisper_model_status");
}

export async function downloadWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("download_whisper_model", { modelSize });
}

export async function getAllWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return invoke<WhisperModelStatus[]>("get_all_whisper_model_statuses");
}

export async function setWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("set_whisper_model", { modelSize });
}

export async function finalizeAgentSession(taskId: string, success: boolean, ptyInstanceId: number): Promise<void> {
  return invoke<void>("finalize_agent_session", { taskId, success, ptyInstanceId });
}


export async function fetchAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("fetch_authored_prs");
}

export async function getAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("get_authored_prs");
}

export async function fsReadDir(projectId: string, dirPath: string | null): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("fs_read_dir", { projectId, dirPath });
}

export async function fsReadFile(projectId: string, filePath: string): Promise<FileContent> {
  return invoke<FileContent>("fs_read_file", { projectId, filePath });
}

export async function fsWriteFile(projectId: string, filePath: string, content: string): Promise<void> {
  return invoke<void>("fs_write_file", { projectId, filePath, content });
}

export async function fsSearchFiles(projectId: string, query: string, limit: number = 50): Promise<string[]> {
  return invoke<string[]>("fs_search_files", { projectId, query, limit });
}

type PluginRowSnake = {
  id: string;
  name: string;
  version: string;
  api_version: number;
  description: string;
  permissions: string;
  contributes: string;
  frontend_entry: string;
  backend_entry: string | null;
  install_path: string;
  source_kind: string;
  source_spec: string;
  package_metadata: string;
  installed_at: number;
  is_builtin: boolean;
}

export type NormalizedPluginRow = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  permissions: string;
  contributes: string;
  frontendEntry: string;
  backendEntry: string | null;
  installPath: string;
  sourceKind: string;
  sourceSpec: string;
  packageMetadata: string;
  installedAt: number;
  isBuiltin: boolean;
}

function normalizePluginRow(raw: PluginRowSnake): NormalizedPluginRow {
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    apiVersion: raw.api_version,
    description: raw.description,
    permissions: raw.permissions,
    contributes: raw.contributes,
    frontendEntry: raw.frontend_entry,
    backendEntry: raw.backend_entry,
    installPath: raw.install_path,
    sourceKind: raw.source_kind ?? 'legacy',
    sourceSpec: raw.source_spec ?? '',
    packageMetadata: raw.package_metadata ?? '{}',
    installedAt: raw.installed_at,
    isBuiltin: raw.is_builtin,
  };
}

export async function registerBuiltinPlugin(plugin: {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  permissions: string;
  contributes: string;
  frontendEntry: string;
  backendEntry: string | null;
  installPath: string;
  sourceKind?: string;
  sourceSpec?: string;
  packageMetadata?: string;
  installedAt: number;
  isBuiltin: boolean;
}): Promise<void> {
  return invoke("register_builtin_plugin", {
    plugin: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      apiVersion: plugin.apiVersion,
      description: plugin.description,
      permissions: plugin.permissions,
      contributes: plugin.contributes,
      frontendEntry: plugin.frontendEntry,
      backendEntry: plugin.backendEntry,
      installPath: plugin.installPath,
      sourceKind: plugin.sourceKind ?? 'legacy',
      sourceSpec: plugin.sourceSpec ?? '',
      packageMetadata: plugin.packageMetadata ?? '{}',
      installedAt: plugin.installedAt,
      isBuiltin: plugin.isBuiltin,
    },
  });
}

export async function installPluginFromLocal(sourcePath: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_local", { sourcePath })
  return normalizePluginRow(raw)
}

export async function installPluginFromNpm(packageName: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_npm", { packageName })
  return normalizePluginRow(raw)
}

export async function installPluginFromGit(gitSpec: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_git", { gitSpec })
  return normalizePluginRow(raw)
}

export async function installPluginFromSource(sourceSpec: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_source", { sourceSpec })
  return normalizePluginRow(raw)
}

/// A plugin package found inside the remembered plugin folder. The sidecar already emits
/// camelCase for this shape, so it needs no normalization.
export type DiscoveredPlugin = {
  path: string
  id: string
  name: string
  version: string
  description: string
  installable: boolean
  needsBuild: boolean
  problem: string | null
}

export async function scanPluginFolder(folderPath: string): Promise<DiscoveredPlugin[]> {
  return invoke<DiscoveredPlugin[]>("scan_plugin_folder", { folderPath })
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("uninstall_plugin", { pluginId });
}

export async function getPlugin(pluginId: string): Promise<NormalizedPluginRow | null> {
  const raw = await invoke<PluginRowSnake | null>("get_plugin", { pluginId });
  return raw ? normalizePluginRow(raw) : null;
}

export async function listPlugins(): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>("list_plugins");
  return rows.map(normalizePluginRow);
}

export async function setPluginEnabled(projectId: string, pluginId: string, enabled: boolean): Promise<void> {
  return invoke("set_plugin_enabled", { projectId, pluginId, enabled });
}

export async function getEnabledPlugins(projectId: string): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>("get_enabled_plugins", { projectId });
  return rows.map(normalizePluginRow);
}

export async function setAppPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return invoke('set_app_plugin_enabled', { pluginId, enabled })
}

export async function getEnabledAppPlugins(): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>('get_enabled_app_plugins', {})
  return rows.map(normalizePluginRow)
}

export async function setGlobalPluginDefault(pluginId: string, enabled: boolean): Promise<void> {
  return invoke("set_global_plugin_default", { pluginId, enabled });
}

export async function getGlobalPluginDefaults(): Promise<{ pluginId: string; enabled: boolean }[]> {
  return invoke<{ pluginId: string; enabled: boolean }[]>("get_global_plugin_defaults", {});
}

export type PluginStorageScopeKind = 'global' | 'project' | 'task'

export async function getPluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string): Promise<JsonValue | null> {
  return invoke<JsonValue | null>('get_plugin_storage', { pluginId, scope, scopeId, key })
}

export async function setPluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string, value: JsonValue): Promise<void> {
  return invoke('set_plugin_storage', { pluginId, scope, scopeId, key, value })
}

export async function deletePluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string): Promise<void> {
  return invoke('delete_plugin_storage', { pluginId, scope, scopeId, key })
}

export async function pluginInvoke(pluginId: string, command: string, payload: unknown): Promise<unknown> {
  return invoke("plugin_invoke", { pluginId, command, payload: payload ?? null })
}

export async function pluginBackendWhenReady(
  pluginId: string,
  projectId: string | null = null,
  preserveActivation = false,
): Promise<void> {
  await invoke('plugin_backend_when_ready', { pluginId, projectId, preserveActivation })
}

export async function pluginBackendDeactivate(pluginId: string): Promise<void> {
  await invoke('plugin_backend_deactivate', { pluginId })
}

export async function stopPluginSidecar(): Promise<void> {
  return invoke('stop_plugin_sidecar', {})
}
