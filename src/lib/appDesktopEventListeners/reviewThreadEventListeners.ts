import { publishReviewThreadInvalidation } from '../plugin/pluginReviewThreadInvalidations'
import { defineDesktopEventListener } from './types'

export function createReviewThreadEventListeners() {
  return {
    reviewThreadsChanged: defineDesktopEventListener(
      'review-threads-changed',
      async (event) => {
        publishReviewThreadInvalidation({
          namespace: event.payload.namespace,
          targetKey: event.payload.targetKey,
          revision: event.payload.revision,
        })
      },
    ),
  }
}
