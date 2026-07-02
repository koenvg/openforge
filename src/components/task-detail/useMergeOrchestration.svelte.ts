import { enqueuePullRequest, getPullRequests, mergePullRequest, forceGithubSync } from '../../lib/ipc'
import { updateTaskPullRequestsInMap } from '../../lib/pullRequestStore'
import { setTaskMerging, ticketPrs } from '../../lib/stores'
import type { PullRequestInfo } from '../../lib/types'

type PullRequestUpdater = (currentTaskPrs: PullRequestInfo[]) => PullRequestInfo[]

export interface MergeFeedback {
  kind: 'success' | 'warning' | 'error'
  message: string
}

export type MergeSmokeOutcome = 'success' | 'warning' | 'error'

export function useMergeOrchestration() {
  let mergeFeedbackByPr = $state<Map<number, MergeFeedback>>(new Map())
  let mergingPrId = $state<number | null>(null)

  function setMergeFeedback(prId: number, feedback: MergeFeedback | null) {
    const nextFeedback = new Map(mergeFeedbackByPr)
    if (feedback) {
      nextFeedback.set(prId, feedback)
    } else {
      nextFeedback.delete(prId)
    }
    mergeFeedbackByPr = nextFeedback
  }

  function updateTaskPullRequests(taskId: string, updater: PullRequestUpdater) {
    ticketPrs.update((map) => {
      const nextMap = new Map(map)
      nextMap.set(taskId, updater(map.get(taskId) || []))
      return nextMap
    })
  }

  async function refreshTaskPullRequests(taskId: string) {
    const prs = await getPullRequests()
    ticketPrs.update((map) => updateTaskPullRequestsInMap(map, taskId, prs))
  }

  async function handleMerge(taskId: string, pr: PullRequestInfo) {
    mergingPrId = pr.id
    setTaskMerging(taskId, true)
    setMergeFeedback(pr.id, null)

    try {
      await mergePullRequest(pr.repo_owner, pr.repo_name, pr.pr_number ?? pr.id)

      updateTaskPullRequests(taskId, (currentTaskPrs) =>
        currentTaskPrs.map((taskPr) =>
          taskPr.id === pr.id
            ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
            : taskPr
        )
      )

      setMergeFeedback(pr.id, { kind: 'success', message: 'Pull request merged successfully.' })

      try {
        const result = await forceGithubSync()

        if (result.errors > 0 || result.rate_limited) {
          const reason = result.rate_limited
            ? 'GitHub sync was rate limited after merge.'
            : 'GitHub sync reported errors after merge.'
          setMergeFeedback(pr.id, {
            kind: 'warning',
            message: `${reason} Pull request state may take a moment to fully refresh.`,
          })
        } else {
          await refreshTaskPullRequests(taskId)
        }
      } catch (e) {
        setMergeFeedback(pr.id, {
          kind: 'warning',
          message: `Pull request merged, but refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    } catch (e) {
      setMergeFeedback(pr.id, {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      mergingPrId = null
      setTaskMerging(taskId, false)
    }
  }
  async function handleEnqueue(taskId: string, pr: PullRequestInfo) {
    mergingPrId = pr.id
    setTaskMerging(taskId, true)
    setMergeFeedback(pr.id, null)

    try {
      await enqueuePullRequest(pr.repo_owner, pr.repo_name, pr.pr_number ?? pr.id)

      updateTaskPullRequests(taskId, (currentTaskPrs) =>
        currentTaskPrs.map((taskPr) =>
          taskPr.id === pr.id
            ? {
                ...taskPr,
                is_queued: true,
                merge_readiness_status: 'queued_pull_request',
                merge_readiness_action: 'wait_for_queue',
                merge_queue_state: 'QUEUED',
              }
            : taskPr
        )
      )

      try {
        const result = await forceGithubSync()

        if (result.errors > 0 || result.rate_limited) {
          const reason = result.rate_limited
            ? 'GitHub sync was rate limited after enqueue.'
            : 'GitHub sync reported errors after enqueue.'
          setMergeFeedback(pr.id, {
            kind: 'warning',
            message: `${reason} Pull request queue state may take a moment to fully refresh.`,
          })
        } else {
          await refreshTaskPullRequests(taskId)
        }
      } catch (e) {
        setMergeFeedback(pr.id, {
          kind: 'warning',
          message: `Pull request enqueued, but refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    } catch (e) {
      setMergeFeedback(pr.id, {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      mergingPrId = null
      setTaskMerging(taskId, false)
    }
  }

  function runMergeSmokeTest(taskId: string, pr: PullRequestInfo, outcome: MergeSmokeOutcome) {
    if (outcome === 'success') {
      updateTaskPullRequests(taskId, (currentTaskPrs) =>
        currentTaskPrs.map((taskPr) =>
          taskPr.id === pr.id
            ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
            : taskPr
        )
      )
      setMergeFeedback(pr.id, { kind: 'success', message: 'Smoke test: merge success message.' })
      return
    }

    if (outcome === 'warning') {
      updateTaskPullRequests(taskId, (currentTaskPrs) =>
        currentTaskPrs.map((taskPr) =>
          taskPr.id === pr.id
            ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
            : taskPr
        )
      )
      setMergeFeedback(pr.id, { kind: 'warning', message: 'Smoke test: merged, but refresh warning.' })
      return
    }

    setMergeFeedback(pr.id, { kind: 'error', message: 'Smoke test: merge failure message.' })
  }

  return {
    get mergeFeedbackByPr() { return mergeFeedbackByPr },
    get mergingPrId() { return mergingPrId },
    handleMerge,
    handleEnqueue,
    runMergeSmokeTest,
    setMergeFeedback
  }
}
