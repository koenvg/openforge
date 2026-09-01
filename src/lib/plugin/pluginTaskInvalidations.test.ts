import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPluginTaskInvalidationSubscriptions,
  publishTaskInvalidation,
  subscribeToTaskInvalidations,
  _resetPluginTaskInvalidationsForTests,
} from './pluginTaskInvalidations'

afterEach(() => {
  _resetPluginTaskInvalidationsForTests()
})

describe('plugin Task invalidations', () => {
  it('filters notifications by Project before invoking plugin handlers', () => {
    const firstProject = vi.fn()
    const secondProject = vi.fn()
    subscribeToTaskInvalidations('plugin-a', 'P-1', firstProject)
    subscribeToTaskInvalidations('plugin-b', 'P-2', secondProject)

    publishTaskInvalidation({ projectId: 'P-2', taskId: 'T-2', reason: 'updated' })

    expect(firstProject).not.toHaveBeenCalled()
    expect(secondProject).toHaveBeenCalledWith({
      projectId: 'P-2',
      taskId: 'T-2',
      reason: 'updated',
    })
  })

  it('stops delivery after explicit disposal', async () => {
    const handler = vi.fn()
    const subscription = subscribeToTaskInvalidations('plugin-a', 'P-1', handler)

    publishTaskInvalidation({ projectId: 'P-1', taskId: null, reason: 'attention' })
    await subscription.dispose()
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('clears every subscription owned by a deactivated plugin', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeToTaskInvalidations('plugin-a', 'P-1', first)
    subscribeToTaskInvalidations('plugin-a', 'P-1', second)

    clearPluginTaskInvalidationSubscriptions('plugin-a')
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'completed' })

    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('isolates plugin handler failures from other subscribers', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const nextHandler = vi.fn()
    subscribeToTaskInvalidations('plugin-a', 'P-1', () => {
      throw new Error('broken handler')
    })
    subscribeToTaskInvalidations('plugin-b', 'P-1', nextHandler)

    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })

    expect(nextHandler).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
