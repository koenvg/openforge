import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppLifecycleController } from './appLifecycleController'

const controllers: Array<{ dispose(): void }> = []

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose())
})

describe('App lifecycle controller', () => {
  it('registers input and desktop events before startup, then tears them down', async () => {
    const calls: string[] = []
    const shortcuts = {
      register: vi.fn(),
      unregister: vi.fn(),
      handleKeydown: vi.fn(() => { calls.push('keydown') }),
    }
    const desktopUnlisten = vi.fn(() => { calls.push('desktop-unlisten') })
    const controller = createAppLifecycleController({
      createWindow: vi.fn(() => ({ destroy: vi.fn() } as never)),
      createShortcuts: vi.fn(() => shortcuts),
      registerShortcuts: vi.fn(() => { calls.push('shortcuts') }),
      registerDesktopEvents: vi.fn(async () => {
        calls.push('desktop-events')
        return [desktopUnlisten]
      }),
      loadRendererStartupData: vi.fn(async () => { calls.push('renderer-startup') }),
      onWindowFocusChange: vi.fn(),
    })
    controllers.push(controller)

    await controller.start()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

    expect(calls).toEqual(['shortcuts', 'desktop-events', 'renderer-startup', 'keydown'])

    controller.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

    expect(desktopUnlisten).toHaveBeenCalledOnce()
    expect(shortcuts.handleKeydown).toHaveBeenCalledOnce()
  })

  it('releases late desktop registrations when the app unmounts during startup', async () => {
    let finishRegistration: (unlisteners: Array<() => void>) => void = () => {}
    const registration = new Promise<Array<() => void>>((resolve) => {
      finishRegistration = resolve
    })
    const desktopUnlisten = vi.fn()
    const loadRendererStartupData = vi.fn()
    const controller = createAppLifecycleController({
      createWindow: vi.fn(() => ({ destroy: vi.fn() } as never)),
      createShortcuts: vi.fn(() => ({
        register: vi.fn(),
        unregister: vi.fn(),
        handleKeydown: vi.fn(),
      })),
      registerShortcuts: vi.fn(),
      registerDesktopEvents: vi.fn(() => registration),
      loadRendererStartupData,
      onWindowFocusChange: vi.fn(),
    })
    controllers.push(controller)

    const starting = controller.start()
    controller.dispose()
    finishRegistration([desktopUnlisten])
    await starting

    expect(desktopUnlisten).toHaveBeenCalledOnce()
    expect(loadRendererStartupData).not.toHaveBeenCalled()
  })


  it('reports desktop event registration failures and continues startup', async () => {
    const registrationError = new Error('desktop bridge unavailable')
    const loadRendererStartupData = vi.fn(async () => undefined)
    const logError = vi.fn()
    const controller = createAppLifecycleController({
      createWindow: vi.fn(() => ({ destroy: vi.fn() } as never)),
      createShortcuts: vi.fn(() => ({
        register: vi.fn(),
        unregister: vi.fn(),
        handleKeydown: vi.fn(),
      })),
      registerShortcuts: vi.fn(),
      registerDesktopEvents: vi.fn(async () => { throw registrationError }),
      loadRendererStartupData,
      onWindowFocusChange: vi.fn(),
      logError,
    })
    controllers.push(controller)

    await expect(controller.start()).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith(
      '[App] Failed to register desktop event listeners:',
      registrationError,
    )
    expect(loadRendererStartupData).toHaveBeenCalledOnce()
  })
})
