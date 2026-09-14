import type { ReviewThread, ReviewThreadScope, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
import { listReviewThreads, replyToReviewThread, setReviewThreadStatus } from '../../lib/ipc'

/** Self review reads the working tree, so there is no commit to pin anchors to. */
const SELF_REVIEW_REVISION = 'working-tree'

export interface SelfReviewThreadControllerOptions {
  getTaskId: () => string
}

export function createSelfReviewThreadController(options: SelfReviewThreadControllerOptions) {
  let threads = $state<ReviewThread[]>([])
  let loadedTaskId: string | null = null
  let loadSequence = 0

  function scopeFor(taskId: string): ReviewThreadScope {
    return { namespace: 'task', targetKey: taskId, revision: SELF_REVIEW_REVISION }
  }

  async function load(taskId: string): Promise<void> {
    const sequence = ++loadSequence
    try {
      const loaded = await listReviewThreads(scopeFor(taskId))
      if (sequence !== loadSequence) return
      threads = loaded
    } catch (error) {
      console.error('Failed to load review threads:', error)
    }
  }

  function synchronize(): Promise<void> {
    const taskId = options.getTaskId()
    if (loadedTaskId === taskId) return Promise.resolve()
    loadedTaskId = taskId
    threads = []
    return load(taskId)
  }

  function applyWrite(taskId: string, updated: ReviewThread): void {
    if (loadedTaskId !== taskId) return
    threads = threads.map(thread => (thread.id === updated.id ? updated : thread))
  }

  async function replyToThread(threadId: string, body: string): Promise<void> {
    const taskId = loadedTaskId
    if (taskId === null) return
    try {
      applyWrite(taskId, await replyToReviewThread({ threadId, role: 'human', body }))
    } catch (error) {
      console.error('Failed to reply to review thread:', error)
    }
  }

  async function setThreadStatus(threadId: string, status: ReviewThreadStatus): Promise<void> {
    const taskId = loadedTaskId
    if (taskId === null) return
    try {
      applyWrite(taskId, await setReviewThreadStatus({ threadId, status }))
    } catch (error) {
      console.error('Failed to set review thread status:', error)
    }
  }

  return {
    get threads() { return threads },
    synchronize,
    replyToThread,
    setThreadStatus,
  }
}

export type SelfReviewThreadController = ReturnType<typeof createSelfReviewThreadController>
