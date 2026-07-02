import { writable } from 'svelte/store'
import type { AgentReviewComment, AuthoredPullRequest, PrOverviewComment, ReviewComment, ReviewPullRequest, ReviewSubmissionComment, PrFileDiff } from '@openforge/plugin-sdk/domain'

export const activeProjectId = writable<string | null>(null)
export const reviewPrs = writable<ReviewPullRequest[]>([])
export const authoredPrs = writable<AuthoredPullRequest[]>([])
export const selectedReviewPr = writable<ReviewPullRequest | null>(null)
export const prFileDiffs = writable<PrFileDiff[]>([])
export const reviewComments = writable<ReviewComment[]>([])
export const pendingManualComments = writable<ReviewSubmissionComment[]>([])
export const prOverviewComments = writable<PrOverviewComment[]>([])
export const agentReviewComments = writable<AgentReviewComment[]>([])
