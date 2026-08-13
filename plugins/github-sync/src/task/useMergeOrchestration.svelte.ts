import type { PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import type { GithubTaskClient } from './githubTaskClient'

export interface MergeFeedback {
  kind: 'success' | 'warning' | 'error'
  message: string
}

export function useMergeOrchestration(client: GithubTaskClient, onRefresh: () => Promise<void>) {
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

    let succeeded = false
    try {
      if (action === 'merge') await client.mergePullRequest(pr)
      else await client.enqueuePullRequest(pr)
      succeeded = true
      setFeedback(pr.id, {
        kind: 'success',
        message: action === 'merge'
          ? 'Pull request merged successfully.'
          : 'Pull request enqueued successfully.',
      })
    } catch (error) {
      setFeedback(pr.id, { kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      try {
        await onRefresh()
      } catch (error) {
        if (succeeded) {
          setFeedback(pr.id, {
            kind: 'warning',
            message: `Action succeeded, but refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      }
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
