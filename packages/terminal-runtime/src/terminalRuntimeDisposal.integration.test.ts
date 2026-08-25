import {
  createFakeTerminalView,
  createHost,
  createTrackedThemeMode,
  resetTerminalRuntimeIntegrationHarness,
  terminalMocks,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'


describe('terminal runtime disposal', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

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
    const runtime = createTerminalRuntime(host, { createTerminalView: () => view })

    await runtime.acquire('T-1')
    runtime.release('T-1')

    expect(disposalOrder).toEqual(['input subscription', 'view'])
    expect(view.setKeyEventHandler).toHaveBeenCalledOnce()
    expect(view.onUserInput).toHaveBeenCalledOnce()
  })

  it('keeps releaseAll reusable while disposing only the owning theme subscription', () => {
    const trackedThemeMode = createTrackedThemeMode()
    const host = createHost()
    host.themeMode = trackedThemeMode.store
    const firstRuntime = createTerminalRuntime(host)
    const secondRuntime = createTerminalRuntime(host)

    expect(trackedThemeMode.getSubscriberCount()).toBe(2)
    firstRuntime.releaseAll()
    expect(trackedThemeMode.getSubscriberCount()).toBe(2)

    firstRuntime.dispose()
    expect(trackedThemeMode.getSubscriberCount()).toBe(1)

    secondRuntime.dispose()
    expect(trackedThemeMode.getSubscriberCount()).toBe(0)
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
  })
})
