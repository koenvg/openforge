import { describe, expect, it, vi } from 'vitest'
import { createAppDesktopEventListenerRegistrations, registerAppDesktopEventListeners } from './appDesktopEventListeners'
import { createAppDesktopEventHarness } from './appDesktopEventListeners/testUtils'
import type { DesktopUnlistenFn } from './desktopIpc'

describe('registerAppDesktopEventListeners', () => {
  it('registers every listener in contract order and returns its unlistener in the same order', async () => {
    const { deps, closeUnlistener, eventUnlisteners, listen, onCloseRequested } = createAppDesktopEventHarness()

    const unlisteners = await registerAppDesktopEventListeners(deps)

    expect(onCloseRequested).toHaveBeenCalledWith(deps.onCloseRequested)
    expect(listen.mock.calls.map(([eventName]) => eventName)).toEqual(
      createAppDesktopEventListenerRegistrations(deps).map(registration => registration.eventName),
    )
    expect(unlisteners).toEqual([closeUnlistener, ...eventUnlisteners])
  })

  it('rolls back registered listeners when a later registration fails and preserves the error', async () => {
    const { deps, closeUnlistener, listen } = createAppDesktopEventHarness()
    const precedingUnlisteners: DesktopUnlistenFn[] = [vi.fn(), vi.fn()]
    const registrationError = new Error('desktop event registration failed')
    listen
      .mockResolvedValueOnce(precedingUnlisteners[0])
      .mockResolvedValueOnce(precedingUnlisteners[1])
      .mockRejectedValueOnce(registrationError)

    await expect(registerAppDesktopEventListeners(deps)).rejects.toBe(registrationError)

    expect(closeUnlistener).toHaveBeenCalledOnce()
    expect(precedingUnlisteners[0]).toHaveBeenCalledOnce()
    expect(precedingUnlisteners[1]).toHaveBeenCalledOnce()
  })
})
