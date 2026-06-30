import type { PluginViewKey } from './types'
export type { PluginViewKey } from './types'

export type BoardStatus = 'backlog' | 'doing' | 'done'
export type WorktreeSource = 'newBranchFromMain' | 'existingBranch' | 'disabled'

export interface Task {
  id: string;
  initial_prompt: string;
  status: BoardStatus;
  prompt: string | null;
  /** Explicit display title; null means fall back to the prompt-derived title. */
  title: string | null;
  summary: string | null;
  agent: string | null;
  permission_mode: string | null;
  worktree_source: WorktreeSource | null;
  worktree_branch: string | null;
  /**
   * Whether the task's start prompt includes the OpenForge handoff-notes
   * (task management) block. Defaults to true; false opts the task out so the
   * agent is not instructed to maintain Handoff Notes.
   */
  handoff_notes_enabled: boolean;
  depends_on: string[];
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

export interface AgentSession {
  id: string;
  ticket_id: string;
  opencode_session_id: string | null;
  stage: string;
  status: string;
  checkpoint_data: string | null;
  pty_instance_id: number | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  provider: string;
  claude_session_id: string | null;
  pi_session_id: string | null;
}

export interface ClaudeInstallStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  authenticated: boolean;
}

export interface CheckpointNotification {
  ticketId: string;
  ticketKey: string | null;
  sessionId: string;
  stage: string;
  message: string;
  timestamp: number;
}

export interface PrComment {
  id: number;
  pr_id: number;
  author: string;
  body: string;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  addressed: number;
  created_at: number;
}

export interface PullRequestInfo {
  id: number;
  pr_number: number;
  ticket_id: string;
  repo_owner: string;
  repo_name: string;
  title: string;
  url: string;
  state: string;
  head_sha: string;
  ci_status: string | null;
  ci_check_runs: string | null;
  review_status: string | null;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged_at: number | null;
  created_at: number;
  updated_at: number;
  draft: boolean;
  is_queued: boolean;
  unaddressed_comment_count: number;
}

export interface PollResult {
  new_comments: number;
  ci_changes: number;
  review_changes: number;
  pr_changes: number;
  errors: number;
  rate_limited: boolean;
  rate_limit_reset_at: number | null;
}

export interface MergeStatusInfo {
  state: string;
  mergeable: boolean | null;
  mergeable_state: string | null;
}

export interface PullRequestTerminalStateInfo {
  state: string;
  merged_at?: number | null;
}

export interface MergeReadinessInfo extends MergeStatusInfo {
  ci_status?: string | null;
  review_status?: string | null;
  draft?: boolean;
  is_queued?: boolean;
  unaddressed_comment_count?: number;
  head_sha?: string | null;
  updated_at?: number | null;
}

export interface MergeReadinessOptions {
  requireBranchUpToDate?: boolean;
  requireConversationResolution?: boolean;
  requireMergeQueue?: boolean;
}

export type MergeReadinessStatus =
  | 'ready_to_merge'
  | 'ready_to_enqueue'
  | 'queued_pull_request'
  | 'readiness_unknown'
  | 'blocked';

export type MergeReadinessAction =
  | 'merge'
  | 'enqueue'
  | 'wait_for_queue'
  | 'wait_for_github'
  | 'resolve_blockers';

export interface MergeReadinessDetail {
  code: string;
  message: string;
}

export interface MergeReadinessFreshness {
  sourceSha: string | null;
  checkedAt: number | null;
}

export interface MergeReadinessResult {
  status: MergeReadinessStatus;
  action: MergeReadinessAction;
  blockers: MergeReadinessDetail[];
  warnings: MergeReadinessDetail[];
  freshness: MergeReadinessFreshness;
}

export function isClosedOrMergedPullRequest(state: string): boolean {
  return state === 'closed' || state === 'merged'
}

export function isMergedPullRequest(pr: PullRequestTerminalStateInfo): boolean {
  return pr.state === 'merged' || pr.merged_at != null
}

export function isClosedUnmergedPullRequest(pr: PullRequestTerminalStateInfo): boolean {
  return pr.state === 'closed' && pr.merged_at == null
}

export function hasMergeConflicts(pr: MergeStatusInfo): boolean {
  if (pr.state !== 'open') return false

  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null
  return mergeableState === 'dirty' || mergeableState === 'conflicting'
}

function mergeReadinessDetail(code: string, message: string): MergeReadinessDetail {
  return { code, message };
}

function mergeReadinessResult(
  pr: MergeReadinessInfo,
  status: MergeReadinessStatus,
  action: MergeReadinessAction,
  blockers: MergeReadinessDetail[],
  warnings: MergeReadinessDetail[],
): MergeReadinessResult {
  return {
    status,
    action,
    blockers,
    warnings,
    freshness: {
      sourceSha: pr.head_sha ?? null,
      checkedAt: pr.updated_at ?? null,
    },
  };
}

/**
 * Explains whether a pull request is ready for a direct merge, queue enqueueing,
 * waiting on GitHub/merge queue, or blocked by hard requirements.
 */
export function getMergeReadiness(pr: MergeReadinessInfo, options: MergeReadinessOptions = {}): MergeReadinessResult {
  const warnings: MergeReadinessDetail[] = [];
  const blockers: MergeReadinessDetail[] = [];
  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
  const ciStatus = pr.ci_status?.toLowerCase() ?? null;
  const reviewStatus = pr.review_status?.toLowerCase() ?? null;
  const unaddressedCommentCount = pr.unaddressed_comment_count ?? 0;

  if (pr.state !== 'open') {
    blockers.push(mergeReadinessDetail(
      pr.state === 'merged' ? 'already_merged' : 'pull_request_closed',
      pr.state === 'merged' ? 'Pull request is already merged.' : 'Pull request is closed.',
    ));
    return mergeReadinessResult(pr, 'blocked', 'resolve_blockers', blockers, warnings);
  }

  if (pr.draft === true) {
    blockers.push(mergeReadinessDetail('draft', 'Pull request is still marked as draft.'));
  }

  if (reviewStatus === 'changes_requested') {
    blockers.push(mergeReadinessDetail('changes_requested', 'Review changes have been requested.'));
  }

  if (ciStatus === 'pending' || ciStatus === 'queued' || ciStatus === 'in_progress') {
    blockers.push(mergeReadinessDetail('checks_pending', 'Required checks are still running.'));
  } else if (ciStatus === 'failure' || ciStatus === 'error' || ciStatus === 'cancelled' || ciStatus === 'timed_out' || ciStatus === 'action_required') {
    blockers.push(mergeReadinessDetail('checks_failed', 'Required checks are failing.'));
  }

  if (mergeableState === 'unstable' && !blockers.some((blocker) => blocker.code === 'checks_failed')) {
    blockers.push(mergeReadinessDetail('checks_failed', 'GitHub reports failing or unstable required checks.'));
  }

  if (mergeableState === 'dirty' || mergeableState === 'conflicting') {
    blockers.push(mergeReadinessDetail('merge_conflict', 'Pull request has merge conflicts.'));
  } else if (mergeableState === 'blocked') {
    blockers.push(mergeReadinessDetail('mergeability_blocked', 'GitHub reports that mergeability is blocked.'));
  } else if (mergeableState === 'behind') {
    if (options.requireBranchUpToDate === true) {
      blockers.push(mergeReadinessDetail('branch_out_of_date', 'Branch must be updated before merging.'));
    } else {
      warnings.push(mergeReadinessDetail('branch_behind', 'Branch is behind the base branch.'));
    }
  }

  if (unaddressedCommentCount > 0) {
    const detail = mergeReadinessDetail('unresolved_conversations', 'Pull request has unresolved conversations.');
    if (options.requireConversationResolution === true) {
      blockers.push(detail);
    } else {
      warnings.push(detail);
    }
  }

  if (blockers.length > 0) {
    return mergeReadinessResult(pr, 'blocked', 'resolve_blockers', blockers, warnings);
  }

  if (pr.is_queued === true) {
    return mergeReadinessResult(pr, 'queued_pull_request', 'wait_for_queue', blockers, warnings);
  }

  const hasDirectMergeability = mergeableState === 'clean' || mergeableState === 'behind';
  const hasNoCiStatus = ciStatus === null || ciStatus === 'none';
  const hasNoReviewStatus = reviewStatus === null || reviewStatus === 'none';
  const isUnprotectedFallback = mergeableState === null && pr.mergeable === true && hasNoCiStatus && hasNoReviewStatus;

  if (isUnprotectedFallback) {
    warnings.push(mergeReadinessDetail('unprotected_fallback', 'Using simple mergeability because no protected-branch checks or review state are available.'));
  }

  if (hasDirectMergeability || isUnprotectedFallback) {
    return mergeReadinessResult(
      pr,
      options.requireMergeQueue === true ? 'ready_to_enqueue' : 'ready_to_merge',
      options.requireMergeQueue === true ? 'enqueue' : 'merge',
      blockers,
      warnings,
    );
  }

  if (mergeableState === 'unknown' || pr.mergeable === null || (mergeableState === null && pr.mergeable !== false)) {
    warnings.push(mergeReadinessDetail('mergeability_unknown', 'GitHub has not reported definitive mergeability yet.'));
    return mergeReadinessResult(pr, 'readiness_unknown', 'wait_for_github', blockers, warnings);
  }

  blockers.push(mergeReadinessDetail('mergeability_blocked', 'Pull request is not mergeable.'));
  return mergeReadinessResult(pr, 'blocked', 'resolve_blockers', blockers, warnings);
}

/** Check if a PR is ready for a direct merge action. */
export function isReadyToMerge(pr: MergeReadinessInfo, options?: MergeReadinessOptions): boolean {
  const readiness = getMergeReadiness(pr, options);
  return readiness.status === 'ready_to_merge' && readiness.action === 'merge';
}

/** Check if a user-initiated merge affordance may be shown/executed now. */
export function canMergePullRequest(pr: MergeReadinessInfo): boolean {
  return isReadyToMerge(pr);
}

export interface QueuedStatusInfo {
  state: string;
  is_queued: boolean;
}

/** Check if GitHub reports a PR as queued in a merge queue. */
export function isQueuedForMerge(pr: QueuedStatusInfo): boolean {
  return pr.state === 'open' && pr.is_queued;
}

/** Preserves optimistic and definitive states across transient background syncs */
export function preservePullRequestState(oldPr: PullRequestInfo | undefined, newPr: PullRequestInfo): PullRequestInfo {
  if (!oldPr) return newPr;

  const result = { ...newPr };

  // Preserve irreversible merged state if new PR hasn't caught up.
  // Closed-but-unmerged PRs can be reopened, so a fresh open state must win.
  if (oldPr.state === 'merged' && result.state === 'open') {
    result.state = 'merged';
    result.merged_at = oldPr.merged_at;
  }

  // Preserve definitive mergeability if new state is transient
  const isTransient = result.mergeable === null || result.mergeable_state === 'unknown' || result.mergeable_state === null;
  const oldIsDefinitive = oldPr.mergeable_state !== 'unknown' && oldPr.mergeable_state !== null;
  
  if (isTransient && oldIsDefinitive) {
    result.mergeable = oldPr.mergeable;
    result.mergeable_state = oldPr.mergeable_state;
  }

  return result;
}

export interface CheckRunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface CiFailureNotification {
  task_id: string;
  pr_id: number;
  pr_title: string;
  ci_status: string;
  timestamp: number;
}

export interface RateLimitNotification {
  reset_at: number | null;  // Unix timestamp (seconds) when limit resets
  timestamp: number;        // When the notification was created (ms)
}

export interface AgentInfo {
  name: string;
}

// ============================================================================
// Autocomplete Types
// ============================================================================

/** Command info from provider command endpoints — used for / autocomplete */
export interface CommandInfo {
  name: string;
  description: string | null;
  source: string | null;
  agent: string | null;
}

/** Extended agent info from provider agent endpoints — used for @ autocomplete */
export interface AutocompleteAgentInfo {
  name: string;
  hidden: boolean | null;
  mode: string | null;
}

/** Model option from OpenCode GET /provider endpoint */
export interface ProviderModelInfo {
  provider_id: string;
  model_id: string;
  name: string;
}

export interface AutocompleteItem {
  label: string;
  description: string | null;
  type: 'file' | 'directory' | 'agent' | 'skill' | 'command';
  source?: string | null;
}

export interface OpenCodeEvent {
  event_type: string;
  data: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectAttention {
  project_id: string;
  needs_input: number;
  running_agents: number;
  ci_failures: number;
  unaddressed_comments: number;
  completed_agents: number;
}

export interface WorktreeInfo {
  id: number;
  task_id: string;
  project_id: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface TaskWorkspaceInfo {
  id: number;
  task_id: string;
  project_id: string;
  workspace_path: string;
  repo_path: string;
  kind: string;
  branch_name: string | null;
  provider_name: string;
  status: string;
  created_at: number;
  updated_at: number;
}



export interface AgentEvent {
  task_id: string;
  event_type: string;
  data: string;
  timestamp: number;
}

export interface ImplementationStatus {
  task_id: string;
  workspace_path: string;
  /** @deprecated Direct-TTY providers no longer expose or require an OpenCode server port. */
  port: number;
  session_id: string;
}

// ============================================================================
// PR Review Types (cross-repo, not task-linked)
// ============================================================================

/**
 * A GitHub label attached to a pull request. `color` is a 6-digit hex string
 * without a leading '#', exactly as GitHub returns it (e.g. "b60205").
 */
export interface PrLabel {
  name: string;
  color: string;
}

/** PR authored by the authenticated user — cached from GitHub Search API */
export interface AuthoredPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  html_url: string;
  user_login: string;
  user_avatar_url: string | null;
  repo_owner: string;
  repo_name: string;
  head_ref: string;
  base_ref: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  ci_status: string | null;
  ci_check_runs: string | null;
  review_status: string | null;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged_at: number | null;
  is_queued: boolean;
  task_id: string | null;
  created_at: number;
  updated_at: number;
  /** GitHub labels on the PR. Empty when the PR has no labels. */
  labels: PrLabel[];
}

/** PR from GitHub Search API — review requested for the authenticated user */
export interface ReviewPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  html_url: string;
  user_login: string;
  user_avatar_url: string | null;
  repo_owner: string;
  repo_name: string;
  head_ref: string;
  base_ref: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  mergeable_state: string | null;
  created_at: number;
  updated_at: number;
  viewed_at: number | null;
  viewed_head_sha: string | null;
  /** GitHub labels on the PR. Empty when the PR has no labels. */
  labels: PrLabel[];
}

/** File diff from PR files endpoint */
export interface PrFileDiff {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
  is_truncated: boolean;
  patch_line_count: number | null;
}

/** Commit info from git log for per-commit diff viewing */
export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
}

/** PR overview comment (both review and general comments) */
export interface PrOverviewComment {
  id: number;
  body: string;
  author: string;
  avatar_url: string | null;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  created_at: string;
}

/** Inline review comment from GitHub PR */
export interface ReviewComment {
  id: number;
  pr_number: number;
  repo_owner: string;
  repo_name: string;
  path: string;
  line: number | null;
  side: string | null;
  body: string;
  author: string;
  created_at: string;
  in_reply_to_id: number | null;
}

/** Comment to include in a review submission */
export interface ReviewSubmissionComment {
  path: string;
  line: number;
  side: string;
  body: string;
}

/** Review submission payload */
export interface ReviewSubmission {
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
  comments: ReviewSubmissionComment[];
}

/** Self-review comment for task implementation review */
export interface SelfReviewComment {
  id: number;
  task_id: string;
  round: number;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  body: string;
  created_at: number;
  archived_at: number | null;
}

/** Agent review comment for AI-powered PR review */
export interface AgentReviewComment {
  id: number;
  review_pr_id: number;
  review_session_key: string;
  comment_type: string;  // 'inline' | 'summary'
  file_path: string | null;
  line_number: number | null;
  side: string | null;  // 'LEFT' | 'RIGHT'
  body: string;
  status: string;  // 'pending' | 'approved' | 'dismissed'
  opencode_session_id: string | null;
  created_at: number;
  updated_at: number;
}

/** App-level view for top-bar navigation */
export type CoreAppView = 'board' | 'settings' | 'global_settings' | 'files'

/** App-level view for top-bar navigation */
export type AppView = CoreAppView | PluginViewKey

export interface PtySpawnRequest {
  task_id: string;
  cols: number;
  rows: number;
}

export interface PtyEvent {
  task_id: string;
  data: string;
  instance_id?: number;
}

/** File entry metadata */
export interface FileEntry {
  name: string;
  path: string;          // relative to project root
  isDir: boolean;
  size: number | null;   // file size in bytes (null for dirs)
  modifiedAt: number | null; // unix timestamp ms
}

/** File content with type information */
export interface FileContent {
  type: 'text' | 'image' | 'binary' | 'document' | 'large-file';
  content: string;       // text content, base64 for images, empty for binary
  mimeType: string | null;
  size: number;
}

export function parseCheckRuns(json: string | null): CheckRunInfo[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/** Split check runs into visible (non-passing) and a count of hidden passing checks. */
export function splitCheckRuns(checks: CheckRunInfo[]): { visible: CheckRunInfo[]; passingCount: number } {
  const visible: CheckRunInfo[] = [];
  let passingCount = 0;
  for (const check of checks) {
    if (check.status === 'completed' && check.conclusion === 'success') {
      passingCount++;
    } else {
      visible.push(check);
    }
  }
  return { visible, passingCount };
}

export interface Action {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
  enabled: boolean;
}

// ============================================================================
// Voice Input / Whisper Types
// ============================================================================

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error'

export interface TranscriptionResult {
  text: string;
  duration_ms: number;
}

export type WhisperModelSizeId = 'tiny' | 'base' | 'small' | 'medium' | 'large';
export interface WhisperModelStatus {
  size: WhisperModelSizeId;
  display_name: string;
  downloaded: boolean;
  model_path: string | null;
  model_size_bytes: number | null;
  model_name: string;
  disk_size_mb: number;
  ram_usage_mb: number;
  is_active: boolean;
}

// ============================================================================
// Claude Code SDK Types
// ============================================================================

/** Permission mode for Claude Code sessions */
export type PermissionMode = 'default' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk';
