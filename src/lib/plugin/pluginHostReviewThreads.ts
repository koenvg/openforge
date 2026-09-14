import {
  createReviewThread,
  listReviewThreads,
  markReviewThreadSeen,
  replyToReviewThread,
  setReviewThreadAwaiting,
  setReviewThreadStatus,
} from '../ipc'
import { subscribeToReviewThreadInvalidations } from './pluginReviewThreadInvalidations'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type ReviewThreadHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'listReviewThreads'
  | 'createReviewThread'
  | 'replyToReviewThread'
  | 'setReviewThreadStatus'
  | 'setReviewThreadAwaiting'
  | 'markReviewThreadSeen'
  | 'subscribeReviewThreadChanges'
>>

export function createPluginReviewThreadHostCapabilities(
  pluginId: string,
): ReviewThreadHostCapabilities {
  return {
    listReviewThreads: scope => listReviewThreads(scope),
    createReviewThread: request => createReviewThread(request),
    replyToReviewThread: request => replyToReviewThread(request),
    setReviewThreadStatus: request => setReviewThreadStatus(request),
    setReviewThreadAwaiting: request => setReviewThreadAwaiting(request),
    markReviewThreadSeen: request => markReviewThreadSeen(request),
    subscribeReviewThreadChanges: (scope, handler) =>
      subscribeToReviewThreadInvalidations(pluginId, scope, handler),
  }
}
