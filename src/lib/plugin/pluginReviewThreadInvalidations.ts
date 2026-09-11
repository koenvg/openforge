import type { Disposable, ReviewThreadChangeEvent, ReviewThreadScope } from '@openforge-app/plugin-sdk'
import { createDisposable } from './runtimeContributionSupport'

type ReviewThreadInvalidationSubscription = {
  scopeKey: string
  handler: (event: ReviewThreadChangeEvent) => void
}

function scopeKey(scope: ReviewThreadScope): string {
  return JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
}

const subscriptionsByPlugin = new Map<string, Set<ReviewThreadInvalidationSubscription>>()

export function subscribeToReviewThreadInvalidations(
  pluginId: string,
  scope: ReviewThreadScope,
  handler: (event: ReviewThreadChangeEvent) => void,
): Disposable {
  const subscriptions = subscriptionsByPlugin.get(pluginId)
    ?? new Set<ReviewThreadInvalidationSubscription>()
  const subscription = { scopeKey: scopeKey(scope), handler }
  subscriptions.add(subscription)
  subscriptionsByPlugin.set(pluginId, subscriptions)

  return createDisposable(() => {
    subscriptions.delete(subscription)
    if (subscriptions.size === 0) subscriptionsByPlugin.delete(pluginId)
  })
}

export function publishReviewThreadInvalidation(event: ReviewThreadChangeEvent): void {
  const key = scopeKey(event)
  for (const [pluginId, subscriptions] of subscriptionsByPlugin) {
    for (const subscription of [...subscriptions]) {
      if (subscription.scopeKey !== key) continue
      try {
        subscription.handler(event)
      } catch (error) {
        console.error(`[pluginReviewThreadInvalidations] Plugin ${pluginId} Review Thread invalidation handler failed:`, error)
      }
    }
  }
}

export function clearPluginReviewThreadInvalidationSubscriptions(pluginId: string): void {
  subscriptionsByPlugin.delete(pluginId)
}

export function _resetPluginReviewThreadInvalidationsForTests(): void {
  subscriptionsByPlugin.clear()
}
