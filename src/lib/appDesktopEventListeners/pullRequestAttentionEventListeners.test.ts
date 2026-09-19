import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPullRequestAttentionEventListeners } from './pullRequestAttentionEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'
import { get } from 'svelte/store'
import { selectedTaskId } from '../stores'

describe('createPullRequestAttentionEventListeners', () => {
  it('refreshes the first verified link while another task remains selected, without a poll or remount', async () => {
    const { deps, handlers, listen } = createAppDesktopEventHarness()
    selectedTaskId.set('T-other')
    let displayed: number[] = []
    const persisted = [542]
    const loadPullRequests = vi.fn(async () => { displayed = [...persisted] })
    const publishTaskInvalidation = vi.fn(async () => undefined)
    await registerEventListenerGroup(
      createPullRequestAttentionEventListeners({ ...deps, loadPullRequests, publishTaskInvalidation }),
      deps.listen!,
    )
    const registrations = listen.mock.calls.length
    expect(displayed).toEqual([])

    await handlers.get('task-pull-request-updated')?.({
      payload: { task_id: 'T-new', pr_id: 542, action: 'linked' },
    })

    expect(displayed).toEqual([542])
    expect(loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
    expect(deps.refreshPrCounts).toHaveBeenCalledOnce()
    expect(publishTaskInvalidation).toHaveBeenCalledWith({ taskId: 'T-new', reason: 'attention' })
    expect(get(selectedTaskId)).toBe('T-other')
    expect(deps.loadTasks).not.toHaveBeenCalled()
    expect(listen).toHaveBeenCalledTimes(registrations)
    selectedTaskId.set(null)
  })

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

  it('publishes Task attention invalidations with the narrowest observed identity', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    const publishTaskInvalidation = vi.fn()
    const eventDeps = { ...deps, publishTaskInvalidation }
    await registerEventListenerGroup(createPullRequestAttentionEventListeners(eventDeps), deps.listen!)

    await handlers.get('github-sync-complete')?.({ payload: undefined })
    await handlers.get('task-pull-request-updated')?.({
      payload: { task_id: 'T-local', pr_id: 42, action: 'merged' },
    })
    await handlers.get('review-status-changed')?.({
      payload: {
        task_id: 'T-review',
        project_id: 'P-2',
        pr_id: 43,
        pr_title: 'Review',
        review_status: 'approved',
        timestamp: 1,
      },
    })
    await handlers.get('new-pr-comment')?.({ payload: { ticket_id: 'T-comment', comment_id: 44 } })
    await handlers.get('comment-addressed')?.({ payload: undefined })
    await handlers.get('ci-status-changed')?.({
      payload: {
        task_id: 'T-ci',
        project_id: 'P-3',
        pr_id: 45,
        pr_title: 'CI',
        ci_status: 'success',
        timestamp: 2,
      },
    })

    expect(publishTaskInvalidation.mock.calls).toEqual([
      [{ projectId: 'P-1', taskId: null, reason: 'attention' }],
      [{ taskId: 'T-local', reason: 'attention' }],
      [{ projectId: 'P-2', taskId: 'T-review', reason: 'attention' }],
      [{ taskId: 'T-comment', reason: 'attention' }],
      [{ projectId: 'P-1', taskId: null, reason: 'attention' }],
      [{ projectId: 'P-3', taskId: 'T-ci', reason: 'attention' }],
    ])
  })
})
