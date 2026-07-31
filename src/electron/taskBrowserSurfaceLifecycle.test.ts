import { describe, expect, it, vi } from 'vitest'

import {
  TaskBrowserSurfaceLifecycle,
  handleTaskBrowserSurfaceLifecycleEvent,
} from './taskBrowserSurfaceLifecycle'

const IDENTITY = {
  windowId: 10,
  pluginId: 'browser',
  taskId: 'T-1',
}

describe('Task Browser Surface lifecycle', () => {
  it('releases live surfaces when the Rust Sidecar reports Task cleanup', () => {
    const owner = { destroyTask: vi.fn() }

    handleTaskBrowserSurfaceLifecycleEvent(owner, {
      eventName: 'task-changed',
      payload: { action: 'deleted', task_id: 'T-123' },
    })

    expect(owner.destroyTask).toHaveBeenCalledWith('T-123')
  })

  it('ignores unrelated or malformed lifecycle events', () => {
    const owner = { destroyTask: vi.fn() }

    handleTaskBrowserSurfaceLifecycleEvent(owner, { eventName: 'task-created', payload: {} })
    handleTaskBrowserSurfaceLifecycleEvent(owner, { eventName: 'task-changed', payload: null })
    handleTaskBrowserSurfaceLifecycleEvent(owner, { eventName: 'task-changed', payload: { action: 'deleted' } })

    expect(owner.destroyTask).not.toHaveBeenCalled()
  })

  it('invalidates captured creation epochs at each cleanup scope', () => {
    const lifecycle = new TaskBrowserSurfaceLifecycle()

    const windowEpoch = lifecycle.capture(IDENTITY)
    lifecycle.invalidateWindow(IDENTITY.windowId)
    expect(lifecycle.isCurrent(IDENTITY, windowEpoch)).toBe(false)

    const taskEpoch = lifecycle.capture(IDENTITY)
    lifecycle.invalidateTask(IDENTITY.taskId)
    expect(lifecycle.isCurrent(IDENTITY, taskEpoch)).toBe(false)

    const pluginEpoch = lifecycle.capture(IDENTITY)
    lifecycle.invalidatePlugin(IDENTITY.pluginId)
    expect(lifecycle.isCurrent(IDENTITY, pluginEpoch)).toBe(false)

    const globalEpoch = lifecycle.capture(IDENTITY)
    lifecycle.invalidateAll()
    expect(lifecycle.isCurrent(IDENTITY, globalEpoch)).toBe(false)
  })

  it('serializes session resets and keeps acquisition behind the latest reset barrier', async () => {
    const lifecycle = new TaskBrowserSurfaceLifecycle()
    let releaseFirst: (() => void) | null = null
    let releaseSecond: (() => void) | null = null
    const order: string[] = []

    const first = lifecycle.runSessionReset('browser', async () => {
      order.push('first:start')
      await new Promise<void>(resolve => { releaseFirst = resolve })
      order.push('first:end')
    })
    const second = lifecycle.runSessionReset('browser', async () => {
      order.push('second:start')
      await new Promise<void>(resolve => { releaseSecond = resolve })
      order.push('second:end')
    })
    const resetBarrier = lifecycle.waitForSessionReset('browser').then(() => (
      lifecycle.currentSessionEpoch('browser')
    ))

    await vi.waitFor(() => expect(releaseFirst).not.toBeNull())
    expect(order).toEqual(['first:start'])
    releaseFirst!()
    await vi.waitFor(() => expect(releaseSecond).not.toBeNull())
    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
    releaseSecond!()

    await expect(Promise.all([first, second, resetBarrier])).resolves.toEqual([undefined, undefined, 2])
  })

  it('releases the reset barrier after failed cleanup', async () => {
    const lifecycle = new TaskBrowserSurfaceLifecycle()

    await expect(lifecycle.runSessionReset('browser', async () => {
      throw new Error('clear failed')
    })).rejects.toThrow('clear failed')

    await expect(lifecycle.waitForSessionReset('browser')).resolves.toBeUndefined()
    expect(lifecycle.currentSessionEpoch('browser')).toBe(1)
  })
})
