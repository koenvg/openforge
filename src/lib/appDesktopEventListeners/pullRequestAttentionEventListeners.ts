import { get } from 'svelte/store'
import { activeSessions, ciFailureNotification, rateLimitNotification } from '../stores'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type PullRequestAttentionEventDeps = Pick<
  AppDesktopEventDeps,
  | 'loadTasks'
  | 'loadPullRequests'
  | 'loadProjectAttention'
  | 'refreshPrCounts'
  | 'getActiveProjectId'
  | 'publishTaskInvalidation'
>

export function createPullRequestAttentionEventListeners(deps: PullRequestAttentionEventDeps) {
  return {
    githubSyncComplete: defineDesktopEventListener('github-sync-complete', async () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      void deps.refreshPrCounts()
      const projectId = deps.getActiveProjectId?.()
      if (projectId) {
        await deps.publishTaskInvalidation?.({ projectId, taskId: null, reason: 'attention' })
      }
    }),

    taskPullRequestUpdated: defineDesktopEventListener('task-pull-request-updated', async (event) => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      void deps.refreshPrCounts()
      await deps.publishTaskInvalidation?.({
        taskId: event.payload.task_id,
        reason: 'attention',
      })
    }),

    reviewStatusChanged: defineDesktopEventListener('review-status-changed', async (event) => {
      void deps.loadPullRequests()
      await deps.publishTaskInvalidation?.({
        projectId: event.payload.project_id,
        taskId: event.payload.task_id,
        reason: 'attention',
      })
    }),

    newPrComment: defineDesktopEventListener('new-pr-comment', async (event) => {
      void deps.loadTasks()
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      await deps.publishTaskInvalidation?.({
        taskId: event.payload.ticket_id,
        reason: 'attention',
      })
    }),

    commentAddressed: defineDesktopEventListener('comment-addressed', async () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
      const projectId = deps.getActiveProjectId?.()
      if (projectId) {
        await deps.publishTaskInvalidation?.({ projectId, taskId: null, reason: 'attention' })
      }
    }),

    ciStatusChanged: defineDesktopEventListener('ci-status-changed', async (event) => {
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
      await deps.publishTaskInvalidation?.({
        projectId: event.payload.project_id,
        taskId: event.payload.task_id,
        reason: 'attention',
      })
    }),

    reviewPrCountChanged: defineDesktopEventListener('review-pr-count-changed', () => {
      void deps.refreshPrCounts()
    }),

    authoredPrsUpdated: defineDesktopEventListener('authored-prs-updated', () => {
      void deps.refreshPrCounts()
    }),

    githubRateLimited: defineDesktopEventListener('github-rate-limited', (event) => {
      rateLimitNotification.set({
        reset_at: event.payload.reset_at,
        timestamp: Date.now(),
      })
    }),
  }
}
