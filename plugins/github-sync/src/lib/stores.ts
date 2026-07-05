import { writable } from 'svelte/store'
import type { AgentReviewComment, AuthoredPullRequest, PrOverviewComment, ReviewComment, ReviewPullRequest, ReviewSubmissionComment, PrFileDiff } from '@openforge-app/plugin-sdk/domain'

export const activeProjectId = writable<string | null>(null)
export const reviewPrs = writable<ReviewPullRequest[]>([])
export const authoredPrs = writable<AuthoredPullRequest[]>([])
export const selectedReviewPr = writable<ReviewPullRequest | null>(null)
// A PR the host asked to open in the review detail (e.g. from the cross-project
// "Needs your attention" dialog). The active PrReviewView consumes and clears it,
// then loads that PR's diffs/comments. Module-level so it survives the brief gap
// between navigating to the view and the component mounting.
export const pendingReviewPrOpen = writable<ReviewPullRequest | null>(null)
export const prFileDiffs = writable<PrFileDiff[]>([])
export const reviewComments = writable<ReviewComment[]>([])
export const pendingManualComments = writable<ReviewSubmissionComment[]>([])
export const prOverviewComments = writable<PrOverviewComment[]>([])
export const agentReviewComments = writable<AgentReviewComment[]>([])
