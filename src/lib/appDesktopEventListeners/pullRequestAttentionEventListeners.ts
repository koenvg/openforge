import { get } from 'svelte/store'
import { activeSessions, ciFailureNotification, rateLimitNotification } from '../stores'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type PullRequestAttentionEventDeps = Pick<
  AppDesktopEventDeps,
  'loadTasks' | 'loadPullRequests' | 'loadProjectAttention' | 'refreshPrCounts'
>

export function createPullRequestAttentionEventListeners(deps: PullRequestAttentionEventDeps) {
  return {
    githubSyncComplete: defineDesktopEventListener('github-sync-complete', () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      void deps.refreshPrCounts()
    }),

    taskPullRequestUpdated: defineDesktopEventListener('task-pull-request-updated', () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      void deps.refreshPrCounts()
    }),

    reviewStatusChanged: defineDesktopEventListener('review-status-changed', () => {
      void deps.loadPullRequests()
    }),

    newPrComment: defineDesktopEventListener('new-pr-comment', () => {
      void deps.loadTasks()
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),

    commentAddressed: defineDesktopEventListener('comment-addressed', () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),

    ciStatusChanged: defineDesktopEventListener<{
      task_id: string
      pr_id: number
      pr_title: string
      ci_status: string
      timestamp: number
    }>('ci-status-changed', (event) => {
      if (event.payload.ci_status === 'failure') {
        const session = get(activeSessions).get(event.payload.task_id)
        if (!session || session.status !== 'running') {
          ciFailureNotification.set({
            task_id: event.payload.task_id,
            pr_id: event.payload.pr_id,
            pr_title: event.payload.pr_title,
            ci_status: event.payload.ci_status,
            timestamp: event.payload.timestamp,
          })
        }
      }
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),

    reviewPrCountChanged: defineDesktopEventListener<number>('review-pr-count-changed', () => {
      void deps.refreshPrCounts()
    }),

    authoredPrsUpdated: defineDesktopEventListener('authored-prs-updated', () => {
      void deps.refreshPrCounts()
    }),

    githubRateLimited: defineDesktopEventListener<{ reset_at: number | null }>('github-rate-limited', (event) => {
      rateLimitNotification.set({
        reset_at: event.payload.reset_at,
        timestamp: Date.now(),
      })
    }),
  }
}
