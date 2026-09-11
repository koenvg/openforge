import { createReviewThread, listReviewThreads, replyToReviewThread } from '../ipc'
import { subscribeToReviewThreadInvalidations } from './pluginReviewThreadInvalidations'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type ReviewThreadHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'listReviewThreads'
  | 'createReviewThread'
  | 'replyToReviewThread'
  | 'subscribeReviewThreadChanges'
>>

export function createPluginReviewThreadHostCapabilities(
  pluginId: string,
): ReviewThreadHostCapabilities {
  return {
    listReviewThreads: scope => listReviewThreads(scope),
    createReviewThread: request => createReviewThread(request),
    replyToReviewThread: request => replyToReviewThread(request),
    subscribeReviewThreadChanges: (scope, handler) =>
      subscribeToReviewThreadInvalidations(pluginId, scope, handler),
  }
}
