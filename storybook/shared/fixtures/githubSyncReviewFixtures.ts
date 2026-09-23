import type { AuthoredPullRequest, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

const FIXED_CREATED_AT = Date.UTC(2026, 0, 2, 8) / 1000
const FIXED_UPDATED_AT = Date.UTC(2026, 0, 2, 9, 20) / 1000
const DEFAULT_LABELS = [
  { name: 'frontend', color: '1d76db' },
  { name: 'accessibility', color: '7057ff' },
]

export function createReviewPullRequest(
  overrides: Partial<ReviewPullRequest> = {},
): ReviewPullRequest {
  return {
    id: 42,
    number: 42,
    title: 'Keep review requests easy to scan',
    body: 'Separates active review requests from finished pull requests.',
    state: 'open',
    draft: false,
    html_url: 'https://github.com/openforge/openforge/pull/42',
    user_login: 'octocat',
    user_avatar_url: null,
    repo_owner: 'openforge',
    repo_name: 'openforge',
    head_ref: 'openforge/review-request-layout',
    base_ref: 'main',
    head_sha: 'abc123',
    additions: 84,
    deletions: 21,
    changed_files: 7,
    ci_status: 'success',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: FIXED_CREATED_AT,
    updated_at: FIXED_UPDATED_AT,
    viewed_at: null,
    viewed_head_sha: null,
    reviewed_head_sha: null,
    ...overrides,
    labels: [...(overrides.labels ?? DEFAULT_LABELS)],
  }
}

export const activeReviewRequest = createReviewPullRequest()

export const viewedReviewRequest = createReviewPullRequest({
  id: 43,
  number: 43,
  title: 'Preserve keyboard focus in the review queue',
  head_ref: 'openforge/review-keyboard-focus',
  head_sha: 'def456',
  additions: 31,
  deletions: 8,
  changed_files: 4,
  viewed_at: FIXED_UPDATED_AT,
  viewed_head_sha: 'def456',
  labels: [{ name: 'keyboard', color: '0e8a16' }],
})

export const updatedSinceReviewRequest = createReviewPullRequest({
  id: 44,
  number: 44,
  title: 'Re-check the refreshed navigation changes',
  head_ref: 'openforge/review-navigation-update',
  head_sha: 'new-head-456',
  reviewed_head_sha: 'old-head-123',
  additions: 58,
  deletions: 12,
  changed_files: 6,
  viewed_at: FIXED_UPDATED_AT,
  viewed_head_sha: 'old-head-123',
  labels: [{ name: 'follow-up', color: 'fbca04' }],
})

export const reviewedReviewRequest = createReviewPullRequest({
  id: 45,
  number: 45,
  title: 'Polish the review completion controls',
  head_ref: 'openforge/review-completion',
  head_sha: 'reviewed-head-789',
  reviewed_head_sha: 'reviewed-head-789',
  additions: 22,
  deletions: 7,
  changed_files: 3,
  viewed_at: FIXED_UPDATED_AT,
  viewed_head_sha: 'reviewed-head-789',
  labels: [{ name: 'reviewed', color: '0e8a16' }],
})

export const mergedReviewRequest = createReviewPullRequest({
  id: 40,
  number: 40,
  title: 'Use shared status presentation for review cards',
  state: 'merged',
  head_ref: 'openforge/shared-pr-status',
  head_sha: '789abc',
  merged_at: FIXED_UPDATED_AT,
  ci_status: 'failure',
  mergeable: null,
  mergeable_state: null,
  additions: 46,
  deletions: 18,
  changed_files: 5,
  labels: [{ name: 'design-system', color: '5319e7' }],
})
export const authoredReviewRequest: AuthoredPullRequest = {
  id: 82, number: 82, title: 'Polish the release checklist',
  body: 'Make releases easier to verify.', state: 'open', draft: false,
  html_url: 'https://github.com/openforge/openforge/pull/82',
  user_login: 'catalog-author', user_avatar_url: null,
  repo_owner: 'openforge', repo_name: 'openforge',
  head_ref: 'openforge/release-checklist', base_ref: 'main', head_sha: 'author123',
  additions: 42, deletions: 8, changed_files: 3,
  ci_status: 'success', ci_check_runs: null, review_status: null,
  mergeable: true, mergeable_state: 'clean', is_queued: false, task_id: null,
  created_at: FIXED_CREATED_AT, updated_at: FIXED_UPDATED_AT,
  labels: [{ name: 'documentation', color: '1d76db' }],
}

export const closedReviewRequest = createReviewPullRequest({
  id: 39,
  number: 39,
  title: 'Remove the old review queue treatment',
  state: 'closed',
  head_ref: 'openforge/old-review-queue',
  head_sha: '012def',
  ci_status: 'pending',
  mergeable: false,
  mergeable_state: 'dirty',
  additions: 12,
  deletions: 64,
  changed_files: 9,
  labels: [{ name: 'superseded', color: 'cfd3d7' }],
})
