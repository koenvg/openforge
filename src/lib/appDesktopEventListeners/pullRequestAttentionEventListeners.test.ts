import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPullRequestAttentionEventListeners } from './pullRequestAttentionEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

describe('createPullRequestAttentionEventListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes PR badge counts when GitHub sync completes', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPullRequestAttentionEventListeners(deps), deps.listen!)

    await handlers.get('github-sync-complete')?.({ payload: undefined })

    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
    expect(deps.refreshPrCounts).toHaveBeenCalledOnce()
  })

  it('invalidates pull request and Focus surfaces after a local PR action', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPullRequestAttentionEventListeners(deps), deps.listen!)

    await handlers.get('task-pull-request-updated')?.({
      payload: { task_id: 'T-42', pr_id: 42, action: 'merged' },
    })

    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
    expect(deps.refreshPrCounts).toHaveBeenCalledOnce()
  })

  it('reloads pull request counts and attention after a comment is addressed', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPullRequestAttentionEventListeners(deps), deps.listen!)

    await handlers.get('comment-addressed')?.({ payload: undefined })

    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })
})
