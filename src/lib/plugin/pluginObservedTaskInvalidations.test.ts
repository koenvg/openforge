import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPluginTaskInvalidationsForTests,
  publishObservedTaskInvalidation,
  subscribeToTaskInvalidations,
} from './pluginTaskInvalidations'

afterEach(() => {
  _resetPluginTaskInvalidationsForTests()
})

describe('observed Task invalidation bridge', () => {
  it('publishes an accepted change with its producer-supplied Project identity', async () => {
    const handler = vi.fn()
    const resolveProjectId = vi.fn()
    subscribeToTaskInvalidations('plugin-a', 'P-1', handler)

    await publishObservedTaskInvalidation({
      projectId: 'P-1',
      taskId: 'T-1',
      reason: 'created',
    }, resolveProjectId)

    expect(resolveProjectId).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith({ projectId: 'P-1', taskId: 'T-1', reason: 'created' })
  })

  it('resolves Project identity for observed execution changes before publishing', async () => {
    const handler = vi.fn()
    const resolveProjectId = vi.fn(async () => 'P-1')
    subscribeToTaskInvalidations('plugin-a', 'P-1', handler)

    await publishObservedTaskInvalidation({ taskId: 'T-1', reason: 'execution' }, resolveProjectId)

    expect(resolveProjectId).toHaveBeenCalledWith('T-1')
    expect(handler).toHaveBeenCalledWith({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })
  })

  it('does not misroute a change whose Project cannot be identified', async () => {
    const handler = vi.fn()
    subscribeToTaskInvalidations('plugin-a', 'P-1', handler)

    await publishObservedTaskInvalidation({ taskId: 'T-missing', reason: 'attention' }, async () => null)

    expect(handler).not.toHaveBeenCalled()
  })
})
