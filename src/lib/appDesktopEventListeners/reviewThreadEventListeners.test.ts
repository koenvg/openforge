import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  subscribeToReviewThreadInvalidations,
  _resetPluginReviewThreadInvalidationsForTests,
} from '../plugin/pluginReviewThreadInvalidations'
import { createReviewThreadEventListeners } from './reviewThreadEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }

afterEach(() => {
  _resetPluginReviewThreadInvalidationsForTests()
})

describe('createReviewThreadEventListeners', () => {
  it('invalidates only the written scope and carries no thread snapshot', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createReviewThreadEventListeners(), deps.listen!)
    const subscribed = vi.fn()
    const otherScope = vi.fn()
    subscribeToReviewThreadInvalidations('plugin-a', scope, subscribed)
    subscribeToReviewThreadInvalidations('plugin-b', { ...scope, revision: 'sha-2' }, otherScope)

    await handlers.get('review-threads-changed')?.({ payload: scope })

    expect(subscribed).toHaveBeenCalledWith(scope)
    expect(otherScope).not.toHaveBeenCalled()
  })
})
