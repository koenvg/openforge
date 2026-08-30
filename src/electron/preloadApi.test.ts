import { describe, expect, it, vi } from 'vitest'
import { createOpenForgePreloadApi } from './preloadApi'

describe('Electron preload API skeleton', () => {
  it('exposes a narrow bridge without raw Node or HTTP capabilities', () => {
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const api = createOpenForgePreloadApi(ipc)

    expect(Object.keys(api).sort()).toEqual(['invoke', 'onEvent', 'version'])
    expect(api).not.toHaveProperty('require')
    expect(api).not.toHaveProperty('fetch')
    expect(api).not.toHaveProperty('process')
  })

  it('routes command requests through one Electron IPC channel', async () => {
    const ipc = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn(),
      off: vi.fn(),
    }

    const api = createOpenForgePreloadApi(ipc)
    await expect(api.invoke('get_projects')).resolves.toEqual({ ok: true })

    expect(ipc.invoke).toHaveBeenCalledWith('openforge:invoke', {
      command: 'get_projects',
      payload: null,
    })
  })

  it('subscribes and unsubscribes to filtered app event payloads', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      off: vi.fn(),
    }
    const handler = vi.fn()

    const api = createOpenForgePreloadApi(ipc)
    const unsubscribe = api.onEvent('task-changed', handler)

    listeners.get('openforge:event')?.({}, { eventName: 'github-sync-complete', payload: {} })
    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { action: 'updated', task_id: 'T-1' } })
    unsubscribe()

    expect(handler).toHaveBeenCalledWith({ action: 'updated', task_id: 'T-1' })
    expect(ipc.off).toHaveBeenCalledWith('openforge:event', expect.any(Function))
  })

  it('reports first and last logical event subscriptions to Electron main', () => {
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
    }
    const api = createOpenForgePreloadApi(ipc)

    const unsubscribeFirst = api.onEvent('pty-model-output-T-1', vi.fn())
    const unsubscribeSecond = api.onEvent('pty-model-output-T-1', vi.fn())

    expect(ipc.send).toHaveBeenCalledTimes(1)
    expect(ipc.send).toHaveBeenCalledWith('openforge:event-subscription', {
      action: 'subscribe',
      eventName: 'pty-model-output-T-1',
    })

    unsubscribeFirst()
    expect(ipc.send).toHaveBeenCalledTimes(1)

    unsubscribeSecond()
    expect(ipc.send).toHaveBeenLastCalledWith('openforge:event-subscription', {
      action: 'unsubscribe',
      eventName: 'pty-model-output-T-1',
    })
  })

  it('multiplexes logical app event subscriptions through one Electron listener', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      off: vi.fn((channel: string) => {
        listeners.delete(channel)
      }),
    }
    const taskChangedHandler = vi.fn()
    const ciStatusHandler = vi.fn()
    const secondTaskChangedHandler = vi.fn()

    const api = createOpenForgePreloadApi(ipc)
    const unsubscribeTaskChanged = api.onEvent('task-changed', taskChangedHandler)
    const unsubscribeCiStatus = api.onEvent('ci-status-changed', ciStatusHandler)
    const unsubscribeSecondTaskChanged = api.onEvent('task-changed', secondTaskChangedHandler)

    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { task_id: 'T-1' } })
    listeners.get('openforge:event')?.({}, { eventName: 'ci-status-changed', payload: { status: 'passed' } })

    unsubscribeTaskChanged()
    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { task_id: 'T-2' } })

    unsubscribeSecondTaskChanged()
    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { task_id: 'T-3' } })

    unsubscribeCiStatus()

    expect(ipc.on).toHaveBeenCalledTimes(1)
    expect(ipc.on).toHaveBeenCalledWith('openforge:event', expect.any(Function))
    expect(taskChangedHandler).toHaveBeenCalledTimes(1)
    expect(secondTaskChangedHandler).toHaveBeenCalledTimes(2)
    expect(ciStatusHandler).toHaveBeenCalledWith({ status: 'passed' })
    expect(ipc.off).toHaveBeenCalledTimes(1)
    expect(ipc.off).toHaveBeenCalledWith('openforge:event', expect.any(Function))
  })

  it('preserves duplicate handler registrations for the same event', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      off: vi.fn(),
    }
    const handler = vi.fn()

    const api = createOpenForgePreloadApi(ipc)
    const unsubscribeFirst = api.onEvent('task-changed', handler)
    const unsubscribeSecond = api.onEvent('task-changed', handler)

    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { task_id: 'T-1' } })
    unsubscribeFirst()
    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { task_id: 'T-2' } })
    unsubscribeSecond()

    expect(ipc.on).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler).toHaveBeenNthCalledWith(1, { task_id: 'T-1' })
    expect(handler).toHaveBeenNthCalledWith(2, { task_id: 'T-1' })
    expect(handler).toHaveBeenNthCalledWith(3, { task_id: 'T-2' })
    expect(ipc.off).toHaveBeenCalledTimes(1)
    expect(ipc.off).toHaveBeenCalledWith('openforge:event', expect.any(Function))
  })
})
