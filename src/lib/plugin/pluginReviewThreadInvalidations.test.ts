import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPluginReviewThreadInvalidationSubscriptions,
  publishReviewThreadInvalidation,
  subscribeToReviewThreadInvalidations,
  _resetPluginReviewThreadInvalidationsForTests,
} from './pluginReviewThreadInvalidations'

const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }

afterEach(() => {
  _resetPluginReviewThreadInvalidationsForTests()
})

describe('plugin Review Thread invalidations', () => {
  it('notifies the subscribers of the written scope only', () => {
    const subscribed = vi.fn()
    const otherRevision = vi.fn()
    const otherTarget = vi.fn()
    subscribeToReviewThreadInvalidations('plugin-a', scope, subscribed)
    subscribeToReviewThreadInvalidations('plugin-b', { ...scope, revision: 'sha-2' }, otherRevision)
    subscribeToReviewThreadInvalidations('plugin-c', { ...scope, targetKey: 'gh:acme/web#9999' }, otherTarget)

    publishReviewThreadInvalidation(scope)

    expect(subscribed).toHaveBeenCalledWith(scope)
    expect(otherRevision).not.toHaveBeenCalled()
    expect(otherTarget).not.toHaveBeenCalled()
  })

  it('stops delivery after explicit disposal', async () => {
    const handler = vi.fn()
    const subscription = subscribeToReviewThreadInvalidations('plugin-a', scope, handler)

    publishReviewThreadInvalidation(scope)
    await subscription.dispose()
    publishReviewThreadInvalidation(scope)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('clears every subscription owned by a deactivated plugin', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeToReviewThreadInvalidations('plugin-a', scope, first)
    subscribeToReviewThreadInvalidations('plugin-a', { ...scope, revision: 'sha-2' }, second)

    clearPluginReviewThreadInvalidationSubscriptions('plugin-a')
    publishReviewThreadInvalidation(scope)
    publishReviewThreadInvalidation({ ...scope, revision: 'sha-2' })

    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('isolates plugin handler failures from other subscribers', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const nextHandler = vi.fn()
    subscribeToReviewThreadInvalidations('plugin-a', scope, () => {
      throw new Error('broken handler')
    })
    subscribeToReviewThreadInvalidations('plugin-b', scope, nextHandler)

    publishReviewThreadInvalidation(scope)

    expect(nextHandler).toHaveBeenCalledWith(scope)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
