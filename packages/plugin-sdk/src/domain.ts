import type { PluginViewKey } from './types.js'
export type { PluginViewKey } from './types.js'

export type BoardStatus = 'backlog' | 'doing' | 'done'

/**
 * The subset of {@link BoardStatus} a client may assign to a task.
 *
 * `'done'` is a legacy, recognized-but-unreachable status (AVIV-118 removed the
 * Done lane and its reopen path). Assigning it hides the task from every board
 * surface with no runtime cleanup, so it stays readable on existing rows but is
 * never a valid write target. The backend rejects it regardless; this type gives
 * plugin and renderer callers a compile-time signal.
 */
export type WritableBoardStatus = Exclude<BoardStatus, 'done'>
export type WorktreeSource = 'newBranchFromMain' | 'existingBranch' | 'disabled'

export interface Task {
  id: string;
  /** @deprecated Use `TaskDetail.prompt` in the bounded Task read APIs. */
  initial_prompt: string;
  status: BoardStatus;
  /** @deprecated Legacy execution override retained for API version 1 compatibility. */
  prompt: string | null;
  /** Explicit display title; null means fall back to the prompt-derived title. */
  title: string | null;
  /** Origin of the explicit display title; manual titles are never overwritten by automation. */
  title_source: 'manual' | 'generated' | null;
  /** Unix timestamp for the first generated title write; null means generation has not written yet. */
  title_generated_at: number | null;
  agent: string | null;
  permission_mode: string | null;
  worktree_source: WorktreeSource | null;
  worktree_branch: string | null;
  /**
   * Optional link to the source ticket this task originated from (e.g. a GitHub
   * issue URL or Jira browse link). `null` when no ticket was provided.
   */
  source_ticket_url: string | null;
  depends_on: string[];
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskLabel {
  id: number
  projectId: string
  name: string
}

export interface TaskReference {
  id: string
  status: BoardStatus
  projectId: string
  title: string
  dependsOn: string[]
}

export interface TaskSummary extends TaskReference {
  createdAt: number
  updatedAt: number
  promptPreview: string
  labels: TaskLabel[]
  sourceTicketUrl: string | null
}

export interface TaskDetail extends TaskSummary {
  prompt: string
  agent: string | null
  permissionMode: string | null
  worktreeSource: WorktreeSource | null
  worktreeBranch: string | null
  titleSource: 'manual' | 'generated' | null
  titleGeneratedAt: number | null
}

export interface ActiveTasks {
  tasks: TaskDetail[]
  related: TaskReference[]
}

export interface CompletedTaskQuery {
  /** At most 200 Unicode characters. ASCII case-insensitive; non-ASCII casing is exact. */
  search?: string
  /** At most 20 Task Label names; each trimmed name is at most 40 Unicode characters. */
  labels?: string[]
  cursor?: string | null
}

export interface CompletedTaskPage {
  tasks: TaskSummary[]
  nextCursor: string | null
}

export interface TaskRead {
  task: TaskDetail
  related: TaskReference[]
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

/**
 * How an existing branch relates to its `origin/<branch>` remote-tracking ref,
 * as reported by the read-only `inspectExistingBranch` pre-flight. Drives whether
 * a task can start silently or must prompt the user to resolve divergence.
 */
export type ExistingBranchRelation =
  | 'localOnly'
  | 'remoteOnly'
  | 'autoFastForward'
  | 'diverged';

/** How to resolve a diverged existing branch when creating its worktree. */
export type DivergenceResolution = 'auto' | 'keepLocal' | 'resetToRemote';

/** A compact, display-oriented description of a single commit. */
export interface CommitSummary {
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
}

/**
 * Read-only plan describing how an existing branch relates to its origin remote
 * at Start time. Produced without creating a worktree or mutating any branch.
 */
export interface ExistingBranchPlan {
  relation: ExistingBranchRelation;
  /** Local-only commits (`origin/foo..foo`), capped; lost by a reset-to-remote. */
  ahead: CommitSummary[];
  /** Remote-only commits (`foo..origin/foo`), capped; on the remote but not local. */
  behind: CommitSummary[];
  /** True when the ahead list was truncated to the cap (more commits exist). */
  aheadTruncated: boolean;
  /** True when the behind list was truncated to the cap (more commits exist). */
  behindTruncated: boolean;
  /** False when the origin fetch failed, so the comparison may be stale. */
  remoteReachable: boolean;
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
  grok_session_id: string | null;
  output_revision: number;
  viewed_output_revision: number;
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
  /** 1 when GitHub considers the comment outdated (its diff line changed). */
  outdated: number;
  created_at: number;
}

export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

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
  merge_readiness_status: MergeReadinessStatus | null;
  merge_readiness_action: MergeReadinessAction | null;
  merge_readiness_blockers: string | MergeReadinessDetail[] | null;
  merge_readiness_warnings: string | MergeReadinessDetail[] | null;
  readiness_source_head_sha: string | null;
  merge_group_sha: string | null;
  required_checks_policy_known: boolean | null;
  required_reviews_policy_known: boolean | null;
  merge_queue_required: boolean | null;
  merge_queue_state: string | null;
  readiness_updated_at: number | null;
  merge_methods_policy_known?: boolean | null;
  allowed_merge_methods?: string | PullRequestMergeMethod[] | null;
  default_merge_method?: PullRequestMergeMethod | null;
}

export type PollOutcome =
  | 'completed'
  | 'missing_github_token'
  | 'github_token_unavailable'
  | 'failed'
  | 'rate_limited';

export interface PollResult {
  new_comments: number;
  ci_changes: number;
  review_changes: number;
  pr_changes: number;
  errors: number;
  rate_limited: boolean;
  rate_limit_reset_at: number | null;
  outcome: PollOutcome;
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
  merge_queue_required?: boolean | null;
  unaddressed_comment_count?: number;
  head_sha?: string | null;
  updated_at?: number | null;
  merge_readiness_status?: MergeReadinessStatus | null;
  merge_readiness_action?: MergeReadinessAction | null;
  merge_readiness_blockers?: string | MergeReadinessDetail[] | null;
  merge_readiness_warnings?: string | MergeReadinessDetail[] | null;
  readiness_source_head_sha?: string | null;
  readiness_updated_at?: number | null;
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

const MERGE_READINESS_STATUSES: readonly MergeReadinessStatus[] = [
  'ready_to_merge',
  'ready_to_enqueue',
  'queued_pull_request',
  'readiness_unknown',
  'blocked',
];

const MERGE_READINESS_ACTIONS: readonly MergeReadinessAction[] = [
  'merge',
  'enqueue',
  'wait_for_queue',
  'wait_for_github',
  'resolve_blockers',
];

function isMergeReadinessStatus(value: string | null | undefined): value is MergeReadinessStatus {
  return MERGE_READINESS_STATUSES.includes(value as MergeReadinessStatus);
}

function isMergeReadinessAction(value: string | null | undefined): value is MergeReadinessAction {
  return MERGE_READINESS_ACTIONS.includes(value as MergeReadinessAction);
}

function parseMergeReadinessDetails(value: string | MergeReadinessDetail[] | null | undefined): MergeReadinessDetail[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((detail): detail is MergeReadinessDetail =>
          typeof detail?.code === 'string' && typeof detail?.message === 'string',
        )
      : [];
  } catch {
    return [];
  }
}
function isUnresolvedConversationDetail(detail: MergeReadinessDetail): boolean {
  return detail.code === 'unresolved_conversations';
}

function hasNoPublishedChecksForUnstableMergeability(pr: MergeReadinessInfo): boolean {
  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
  const ciStatus = pr.ci_status?.toLowerCase() ?? null;
  return mergeableState === 'unstable' && (ciStatus === null || ciStatus === 'none');
}

function downgradeNoCheckPersistedFailures(
  pr: MergeReadinessInfo,
  blockers: MergeReadinessDetail[],
): MergeReadinessDetail[] {
  if (!hasNoPublishedChecksForUnstableMergeability(pr)) return blockers;

  return blockers.map((blocker) => blocker.code === 'checks_failed'
    ? mergeReadinessDetail('checks_pending', 'Required checks are still running.')
    : blocker);
}

function removeUnresolvedConversationDetails(details: MergeReadinessDetail[]): MergeReadinessDetail[] {
  return details.filter((detail) => !isUnresolvedConversationDetail(detail));
}

function shouldIgnorePersistedUnresolvedConversationDetails(
  pr: MergeReadinessInfo,
  blockers: MergeReadinessDetail[],
  warnings: MergeReadinessDetail[],
): boolean {
  return pr.unaddressed_comment_count === 0
    && (blockers.some(isUnresolvedConversationDetail) || warnings.some(isUnresolvedConversationDetail));
}

function isPersistedMergeReadinessCurrent(pr: MergeReadinessInfo): boolean {
  const sourceSha = pr.readiness_source_head_sha ?? null;
  const headSha = pr.head_sha ?? null;
  if (!sourceSha || !headSha || sourceSha !== headSha) return false;

  const checkedAt = pr.readiness_updated_at ?? null;
  const updatedAt = pr.updated_at ?? null;
  return checkedAt !== null && (updatedAt === null || checkedAt >= updatedAt);
}

export function getPersistedMergeReadiness(pr: MergeReadinessInfo): MergeReadinessResult | null {
  const status = pr.merge_readiness_status ?? null;
  const action = pr.merge_readiness_action ?? null;
  if (!isMergeReadinessStatus(status) || !isMergeReadinessAction(action)) return null;
  if (!isPersistedMergeReadinessCurrent(pr)) return null;

  let blockers = downgradeNoCheckPersistedFailures(
    pr,
    parseMergeReadinessDetails(pr.merge_readiness_blockers),
  );
  let warnings = parseMergeReadinessDetails(pr.merge_readiness_warnings);
  if (shouldIgnorePersistedUnresolvedConversationDetails(pr, blockers, warnings)) {
    blockers = removeUnresolvedConversationDetails(blockers);
    warnings = removeUnresolvedConversationDetails(warnings);
    if (status === 'blocked' && blockers.length === 0) return null;
  }

  return {
    status,
    action,
    blockers,
    warnings,
    freshness: {
      sourceSha: pr.readiness_source_head_sha ?? null,
      checkedAt: pr.readiness_updated_at ?? null,
    },
  };
}

function hasMergeReadinessOptions(options: MergeReadinessOptions): boolean {
  return options.requireBranchUpToDate === true
    || options.requireConversationResolution === true
    || options.requireMergeQueue === true;
}

/**
 * Explains whether a pull request is ready for a direct merge, queue enqueueing,
 * waiting on GitHub/merge queue, or blocked by hard requirements.
 */
export function getMergeReadiness(pr: MergeReadinessInfo, options: MergeReadinessOptions = {}): MergeReadinessResult {
  const warnings: MergeReadinessDetail[] = [];
  const blockers: MergeReadinessDetail[] = [];

  if (pr.state !== 'open') {
    blockers.push(mergeReadinessDetail(
      pr.state === 'merged' ? 'already_merged' : 'pull_request_closed',
      pr.state === 'merged' ? 'Pull request is already merged.' : 'Pull request is closed.',
    ));
    return mergeReadinessResult(pr, 'blocked', 'resolve_blockers', blockers, warnings);
  }

  const persisted = hasMergeReadinessOptions(options) ? null : getPersistedMergeReadiness(pr);
  if (persisted) return persisted;

  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
  const ciStatus = pr.ci_status?.toLowerCase() ?? null;
  const reviewStatus = pr.review_status?.toLowerCase() ?? null;
  const unaddressedCommentCount = pr.unaddressed_comment_count ?? 0;

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
  const hasFailedChecks = blockers.some((blocker) => blocker.code === 'checks_failed')
  const hasPendingChecks = blockers.some((blocker) => blocker.code === 'checks_pending')
  if (mergeableState === 'unstable' && !hasFailedChecks && !hasPendingChecks) {
    blockers.push(hasNoPublishedChecksForUnstableMergeability(pr)
      ? mergeReadinessDetail('checks_pending', 'Required checks are still running.')
      : mergeReadinessDetail('checks_failed', 'GitHub reports failing or unstable required checks.'))
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
    const mergeQueueRequired = options.requireMergeQueue === true || pr.merge_queue_required === true;
    return mergeReadinessResult(
      pr,
      mergeQueueRequired ? 'ready_to_enqueue' : 'ready_to_merge',
      mergeQueueRequired ? 'enqueue' : 'merge',
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
  const readiness = getMergeReadiness(pr);
  return readiness.status === 'ready_to_merge' && readiness.action === 'merge';
}

/** Check if a user-initiated merge-queue enqueue affordance may be shown/executed now. */
export function canEnqueuePullRequest(pr: MergeReadinessInfo): boolean {
  const readiness = getMergeReadiness(pr);
  return readiness.status === 'ready_to_enqueue' && readiness.action === 'enqueue';
}

function mergeReadinessPriority(pr: MergeReadinessInfo): number {
  if (pr.state !== 'open') return pr.state === 'merged' ? 100 : 90;

  const readiness = getMergeReadiness(pr);
  switch (readiness.status) {
    case 'ready_to_merge': return 600;
    case 'ready_to_enqueue': return 590;
    case 'blocked': {
      const blockerCodes = new Set(readiness.blockers.map((blocker) => blocker.code));
      return blockerCodes.size === 1 && blockerCodes.has('checks_pending') ? 350 : 500;
    }
    case 'readiness_unknown': return 300;
    case 'queued_pull_request': return 250;
  }
}

export function getMostAttentionWorthyPullRequest<T extends MergeReadinessInfo>(prs: T[]): T | null {
  let best: T | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;

  for (const pr of prs) {
    const priority = mergeReadinessPriority(pr);
    if (priority > bestPriority) {
      best = pr;
      bestPriority = priority;
    }
  }

  return best;
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

  const oldReadiness = getPersistedMergeReadiness(oldPr);
  const newReadiness = getPersistedMergeReadiness(result);
  const sameReadinessSource = (oldPr.readiness_source_head_sha ?? oldPr.head_sha ?? null) === (result.readiness_source_head_sha ?? result.head_sha ?? null);
  const newReadinessIsTransient = newReadiness === null || newReadiness.status === 'readiness_unknown';
  if (sameReadinessSource && oldReadiness && oldReadiness.status !== 'readiness_unknown' && newReadinessIsTransient) {
    result.merge_readiness_status = oldPr.merge_readiness_status;
    result.merge_readiness_action = oldPr.merge_readiness_action;
    result.merge_readiness_blockers = oldPr.merge_readiness_blockers;
    result.merge_readiness_warnings = oldPr.merge_readiness_warnings;
    result.readiness_source_head_sha = oldPr.readiness_source_head_sha;
    result.readiness_updated_at = oldPr.readiness_updated_at;
    result.merge_group_sha = oldPr.merge_group_sha;
    result.required_checks_policy_known = oldPr.required_checks_policy_known;
    result.required_reviews_policy_known = oldPr.required_reviews_policy_known;
    result.merge_queue_required = oldPr.merge_queue_required;
    result.merge_queue_state = oldPr.merge_queue_state;
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

/** Command info from provider command endpoints — used for / autocomplete and injectable catalogs */
export interface CommandInfo {
  name: string;
  description: string | null;
  source: string | null;
  agent: string | null;
  /** Where it comes from: "personal" | "project" | "plugin" | "builtin". Optional enrichment — only claude-code populates it. */
  origin?: string | null;
  /** "auto+manual" | "manual-only" — derived from disable-model-invocation / command semantics */
  triggerMode?: string | null;
  /** false => hidden background skill; injectable catalogs drop it */
  userInvocable?: boolean | null;
  /** e.g. ".claude" | ".agents"; null for builtin/plugin */
  sourceDir?: string | null;
  /** stable on-disk identity under the source skills dir — for a skill, its folder name
   * (a single path component, e.g. "pr-writer"); for a command, the file name. null for builtin */
  sourcePath?: string | null;
  /** full SKILL.md body for a consumer's reading pane; null when there is no source file */
  content?: string | null;
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

export type TaskAttentionState =
  // Lanes other than Focus reuse this row shape, which brings two more states with them:
  // a running agent is 'active', and a task that has never been started is 'backlog'.
  | 'active'
  | 'backlog'
  | 'idle'
  | 'needs-input'
  | 'paused'
  | 'agent-done'
  | 'failed'
  | 'interrupted'
  | 'pr-draft'
  | 'pr-open'
  | 'ci-failed'
  | 'changes-requested'
  | 'unaddressed-comments'
  | 'ready-to-merge'
  | 'ready-to-enqueue'
  | 'pr-queued'
  | 'pr-merged'
  | 'pr-closed'
  | 'ci-running'
  | 'review-pending'
  | 'merge-conflict';

/** Backend-owned, Task-only Needs Attention read model. */
export interface TaskAttentionRow {
  task_id: string;
  project_id: string;
  project_name: string;
  title: string;
  state: TaskAttentionState;
  reason: string;
  activity_at: number;
  has_unread_agent_output: boolean;
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

/** GitHub label that suppresses a PR from review counting and grays out its card. */
export const DO_NOT_REVIEW_LABEL = 'DO NOT REVIEW';

/**
 * True when the PR carries the "DO NOT REVIEW" label (case-insensitive, trimmed).
 * Tolerates a missing or null `labels` field so a single implementation can back
 * both the plugin PR views and the app-side sort/badge helpers.
 */
export function hasDoNotReviewLabel(pr: { labels?: PrLabel[] | null }): boolean {
  return (pr.labels ?? []).some((label) => label.name.trim().toUpperCase() === DO_NOT_REVIEW_LABEL);
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


/** One file referenced by a walkthrough step. `hunk_indexes === null` means the entire file's diff belongs to the step. */
export interface PrWalkthroughStepFile {
  filename: string;
  hunk_indexes: number[] | null;
}

/** One concept-sized step in a PR walkthrough — as if the author had landed a small commit. */
export interface PrWalkthroughStep {
  id: string;
  title: string;
  summary: string;
  files: PrWalkthroughStepFile[];
}

/** A cached AI-generated walkthrough of a PR, keyed by (pr_id, head_sha).
 * `steps_json` is the agent's raw structured response. Parse + validate it
 * against the live PR diffs before rendering (see walkthroughParse). */
export interface PrWalkthrough {
  pr_id: number;
  head_sha: string;
  walkthrough_session_key: string | null;
  status: 'generating' | 'ready' | 'error';
  steps_json: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
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

/** One message in a local "Ask the AI author" Q&A thread. Never sent to GitHub. */
export interface AiThreadMessage {
  role: 'user' | 'ai';
  body: string;
  created_at: number;
}

/**
 * Where a Q&A thread is anchored: a specific diff line, a walkthrough step, or a
 * specific AI review comment (a follow-up like "why did you suggest this?"). The
 * `comment` variant carries the AI comment's id (so its suggestion can be quoted
 * as context) plus the denormalized diff location so it renders inline like a
 * line-anchored thread.
 */
export type AiThreadAnchor =
  | { type: 'line'; filename: string; line: number; side: 'LEFT' | 'RIGHT' }
  | { type: 'step'; step_id: string }
  | { type: 'comment'; comment_id: number; filename: string; line: number; side: 'LEFT' | 'RIGHT' };

/** A private, per-commit reviewer↔AI conversation, stored locally (never on GitHub). */
export interface AiThread {
  id: string;
  anchor: AiThreadAnchor;
  status: 'draft' | 'pending' | 'answered' | 'error';
  messages: AiThreadMessage[];
  created_at: number;
  updated_at: number;
  /**
   * When the reviewer last opened this thread's answer, in the same unit as
   * message `created_at`. An answer counts as read only while `seen_at` is at or
   * after the latest AI message's `created_at`; a newer answer makes it unread
   * again without clearing the field. `null`/absent means never opened.
   */
  seen_at?: number | null;
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
  type: 'text' | 'image' | 'video' | 'binary' | 'document' | 'large-file';
  content: string;       // text content, base64 for images/videos, empty for unavailable categories
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
