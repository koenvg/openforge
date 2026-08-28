import type { PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import type { GithubTaskClient } from './githubTaskClient'

export interface MergeFeedback {
  kind: 'success' | 'warning' | 'error'
  message: string
}

export function useMergeOrchestration(client: GithubTaskClient, onActionCompleted: (pr: PullRequestInfo) => Promise<void>) {
  let feedbackByPr = $state<Map<number, MergeFeedback>>(new Map())
  let pendingPrId = $state<number | null>(null)

  function setFeedback(prId: number, feedback: MergeFeedback | null) {
    const next = new Map(feedbackByPr)
    if (feedback) next.set(prId, feedback)
    else next.delete(prId)
    feedbackByPr = next
  }

  async function mutate(pr: PullRequestInfo, action: 'merge' | 'enqueue') {
    if (pendingPrId !== null) return
    pendingPrId = pr.id
    setFeedback(pr.id, null)

    let actionSucceeded = false
    try {
      if (action === 'merge') {
        const mergeMethod = pr.default_merge_method
        if (!mergeMethod) throw new Error('GitHub merge method is unavailable. Refresh GitHub status and try again.')
        await client.mergePullRequest(pr, mergeMethod)
      } else {
        await client.enqueuePullRequest(pr)
      }
      actionSucceeded = true
      await onActionCompleted(pr)
      setFeedback(pr.id, {
        kind: 'success',
        message: action === 'merge'
          ? 'Pull request merged successfully.'
          : 'Pull request enqueued successfully.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const remoteStatePrefix = action === 'merge'
        ? 'Pull request merged on GitHub, but local state could not be updated'
        : 'Pull request enqueued on GitHub, but local state could not be updated'
      const legacyPersistencePrefix = action === 'merge'
        ? 'Failed to persist merged pull request'
        : 'Failed to persist queued pull request'
      const remotePersistenceFailed = message.startsWith(remoteStatePrefix)
        || message.startsWith(legacyPersistencePrefix)
      setFeedback(pr.id, remotePersistenceFailed
        ? {
            kind: 'warning',
            message: message.startsWith(remoteStatePrefix)
              ? message
              : `${remoteStatePrefix}: ${message}`,
          }
        : actionSucceeded
          ? { kind: 'warning', message: `Action succeeded, but local refresh failed: ${message}` }
          : { kind: 'error', message })
    } finally {
      pendingPrId = null
    }
  }

  return {
    get feedbackByPr() { return feedbackByPr },
    get pendingPrId() { return pendingPrId },
    merge: (pr: PullRequestInfo) => mutate(pr, 'merge'),
    enqueue: (pr: PullRequestInfo) => mutate(pr, 'enqueue'),
  }
}
