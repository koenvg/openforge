import { createHost } from './terminalRuntimeHost.testSupport'
import {
  createTrackedThemeMode,
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'


describe('terminal runtime disposal', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('releases terminal resources and unsubscribes from theme updates', async () => {
    const trackedThemeMode = createTrackedThemeMode()
    const host = createHost()
    host.themeMode = trackedThemeMode.store
    const runtime = createTerminalRuntime(host)

    await runtime.acquire('T-1-shell-0')
    expect(trackedThemeMode.getSubscriberCount()).toBe(1)
    runtime.dispose()

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal('T-1-shell-0')).toBe(false)
    expect(trackedThemeMode.getSubscriberCount()).toBe(0)
    expect(host.getListenerCount('pty-model-output-T-1-shell-0')).toBe(0)
    expect(host.getListenerCount('pty-exit-T-1-shell-0')).toBe(0)
    expect(host.getListenerCount('openforge-app-events-reconnected')).toBe(0)
    expect(host.transport.dispose).toHaveBeenCalledOnce()
  })

  it('disposes view subscriptions before the renderer-neutral view', async () => {
    const host = createHost()
    const disposalOrder: string[] = []
    const view = createFakeTerminalView({
      onUserInput: vi.fn(() => ({
        dispose: () => disposalOrder.push('input subscription'),
      })),
    })
    vi.mocked(view.dispose).mockImplementation(() => disposalOrder.push('view'))
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    await runtime.acquire('T-1')
    runtime.release('T-1')

    expect(disposalOrder).toEqual(['input subscription', 'view'])
    expect(view.setKeyEventHandler).toHaveBeenCalledOnce()
    expect(view.onUserInput).toHaveBeenCalledOnce()
  })

  it('releases only the selected Terminal Session subscription', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    await Promise.all([runtime.acquire('T-1-shell-0'), runtime.acquire('T-1-shell-1')])

    runtime.release('T-1-shell-0')

    expect(host.getListenerCount('pty-model-output-T-1-shell-0')).toBe(0)
    expect(host.getListenerCount('pty-exit-T-1-shell-0')).toBe(0)
    expect(host.getListenerCount('pty-model-output-T-1-shell-1')).toBe(0)
    expect(host.getListenerCount('pty-exit-T-1-shell-1')).toBe(1)
    expect(host.getListenerCount('openforge-app-events-reconnected')).toBe(1)
    expect(host.transport.dispose).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('keeps releaseAll reusable while disposing only the owning theme subscription', () => {
    const trackedThemeMode = createTrackedThemeMode()
    const firstHost = createHost()
    firstHost.themeMode = trackedThemeMode.store
    const secondHost = createHost()
    secondHost.themeMode = trackedThemeMode.store
    const firstRuntime = createTerminalRuntime(firstHost)
    const secondRuntime = createTerminalRuntime(secondHost)

    expect(trackedThemeMode.getSubscriberCount()).toBe(2)
    firstRuntime.releaseAll()
    expect(trackedThemeMode.getSubscriberCount()).toBe(2)

    firstRuntime.dispose()
    expect(trackedThemeMode.getSubscriberCount()).toBe(1)

    secondRuntime.dispose()
    expect(trackedThemeMode.getSubscriberCount()).toBe(0)
  })

  it('continues disposing other Terminal Sessions after one view teardown fails', async () => {
    const host = createHost()
    const cleanupError = new Error('first view cleanup failed')
    const firstView = createFakeTerminalView({
      dispose: vi.fn(() => { throw cleanupError }),
    })
    const secondView = createFakeTerminalView()
    const views = [firstView, secondView]
    const runtime = createTerminalRuntime({
      ...host,
      createTerminalView: () => views.shift() ?? createFakeTerminalView(),
    })
    await Promise.all([runtime.acquire('T-1-shell-0'), runtime.acquire('T-1-shell-1')])

    expect(() => runtime.dispose()).toThrow(cleanupError)

    expect(firstView.dispose).toHaveBeenCalledOnce()
    expect(secondView.dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal('T-1-shell-0')).toBe(false)
    expect(runtime.hasTerminal('T-1-shell-1')).toBe(false)
    expect(host.transport.dispose).toHaveBeenCalledOnce()
  })

  it('unsubscribes from theme updates when terminal cleanup throws', async () => {
    const trackedThemeMode = createTrackedThemeMode()
    const host = createHost()
    host.themeMode = trackedThemeMode.store
    const runtime = createTerminalRuntime(host)
    const cleanupError = new Error('terminal cleanup failed')

    await runtime.acquire('T-1-shell-0')
    terminalMocks.instances[0].dispose.mockImplementationOnce(() => {
      throw cleanupError
    })

    expect(() => runtime.dispose()).toThrow(cleanupError)
    expect(trackedThemeMode.getSubscriberCount()).toBe(0)
    expect(host.transport.dispose).toHaveBeenCalledOnce()
  })
})
