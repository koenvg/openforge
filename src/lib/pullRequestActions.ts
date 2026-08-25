import { get } from 'svelte/store'
import {
  enqueuePullRequest,
  mergePullRequest,
  refreshTaskGithubStatus,
} from './ipc'
import { error, setTaskMerging, ticketPrs } from './stores'
import { getMergeReadiness } from './types'
import type { PullRequestMergeMethod, Task } from './types'

export interface PullRequestActionOptions {
  logError(message: string, error: unknown): void
}

function setError(errorValue: unknown): void {
  error.set(String(errorValue))
}

export function createPullRequestActions(options: PullRequestActionOptions) {
  async function mergeReadyPullRequest(
    task: Task,
    mergeMethod: PullRequestMergeMethod,
  ): Promise<void> {
    const prs = get(ticketPrs).get(task.id) || []
    const readyPrs = prs.filter((pr) => {
      const readiness = getMergeReadiness(pr)
      return readiness.status === 'ready_to_merge' && readiness.action === 'merge'
    })

    if (readyPrs.length === 1) {
      const pr = readyPrs[0]
      try {
        setTaskMerging(task.id, true)
        await mergePullRequest(task.id, pr.id, pr.head_sha, mergeMethod)
        const nextMap = new Map(get(ticketPrs))
        const taskPrs = nextMap.get(task.id) || []
        nextMap.set(task.id, taskPrs.map((candidate) =>
          candidate.id === pr.id
            ? { ...candidate, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
            : candidate,
        ))
        ticketPrs.set(nextMap)
      } catch (errorValue) {
        options.logError('Failed to merge PR:', errorValue)
        try {
          await refreshTaskGithubStatus(task.id)
        } catch (refreshError) {
          options.logError('Failed to refresh GitHub status after rejected merge:', refreshError)
        }
        setError(errorValue)
      } finally {
        setTaskMerging(task.id, false)
      }
    } else if (readyPrs.length > 1) {
      error.set('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
    }
  }

  async function enqueueReadyPullRequest(task: Task): Promise<void> {
    const prs = get(ticketPrs).get(task.id) || []
    const readyPrs = prs.filter((pr) => {
      const readiness = getMergeReadiness(pr)
      return readiness.status === 'ready_to_enqueue' && readiness.action === 'enqueue'
    })

    if (readyPrs.length === 1) {
      const pr = readyPrs[0]
      try {
        setTaskMerging(task.id, true)
        await enqueuePullRequest(task.id, pr.id, pr.head_sha)
        const nextMap = new Map(get(ticketPrs))
        const taskPrs = nextMap.get(task.id) || []
        nextMap.set(task.id, taskPrs.map((candidate) =>
          candidate.id === pr.id
            ? {
                ...candidate,
                is_queued: true,
                merge_readiness_status: 'queued_pull_request',
                merge_readiness_action: 'wait_for_queue',
                merge_queue_state: 'QUEUED',
              }
            : candidate,
        ))
        ticketPrs.set(nextMap)
      } catch (errorValue) {
        options.logError('Failed to enqueue PR:', errorValue)
        setError(errorValue)
      } finally {
        setTaskMerging(task.id, false)
      }
    } else if (readyPrs.length > 1) {
      error.set('Multiple pull requests are ready to enqueue. Open the task details to choose the correct PR.')
    }
  }

  return {
    mergeReadyPullRequest,
    enqueueReadyPullRequest,
  }
}
