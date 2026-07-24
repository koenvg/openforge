import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostBrowserSurfaces } from './taskBrowserSurfaces'
import type { OpenForgeDesktopBridge } from '../desktopIpc'

const blankState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
}

describe('renderer Task Browser Surface host adapter', () => {
  afterEach(() => {
    delete window.openforge
  })

  it('qualifies requests, serializes DOM bounds, forwards state, and disposes attachments safely', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = []
    let stateHandler: ((payload: unknown) => void) | null = null
    const bridge: OpenForgeDesktopBridge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: 'surface-1', generation: 4, state: blankState } }
        }
        return { ok: true, value: blankState }
      },
      onEvent(eventName, handler) {
        if (eventName === 'task-browser-surface-state') stateHandler = handler
        return () => { stateHandler = null }
      },
    }
    window.openforge = bridge

    const surfaces = createHostBrowserSurfaces('browser')
    const controller = await surfaces.getOrCreate({ taskId: 'T-1', id: 'main', initialUrl: 'https://example.com' })
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 640,
      height: 480,
      top: 20,
      right: 650,
      bottom: 500,
      left: 10,
      toJSON: () => ({}),
    })

    const attachment = await controller.attach(element)
    const states: string[] = []
    const subscription = controller.onStateChanged(state => states.push(state.title))
    ;(stateHandler as ((payload: unknown) => void) | null)?.({
      surfaceId: 'surface-1',
      generation: 4,
      state: { ...blankState, title: 'Example' },
    })
    await controller.navigate('https://example.com/next')
    await attachment.dispose()
    await subscription.dispose()
    await controller.destroy()

    expect(states).toEqual(['Example'])
    expect(invocations[0]).toEqual({
      command: 'task_browser_surface_get_or_create',
      payload: { pluginId: 'browser', taskId: 'T-1', id: 'main', initialUrl: 'https://example.com' },
    })
    expect(invocations).toContainEqual({
      command: 'task_browser_surface_attach',
      payload: expect.objectContaining({
        surfaceId: 'surface-1',
        bounds: { x: 10, y: 20, width: 640, height: 480 },
      }),
    })
    expect(invocations).toContainEqual({
      command: 'task_browser_surface_navigate',
      payload: { surfaceId: 'surface-1', url: 'https://example.com/next' },
    })
    expect(invocations.some(call => call.command === 'task_browser_surface_detach')).toBe(true)
    expect(invocations.at(-1)).toEqual({
      command: 'task_browser_surface_destroy',
      payload: { surfaceId: 'surface-1' },
    })
  })

  it('ignores state events for another surface or a replaced native generation', async () => {
    let stateHandler: ((payload: unknown) => void) | null = null
    window.openforge = {
      version: 1,
      invoke: vi.fn(async command => command === 'task_browser_surface_get_or_create'
        ? { ok: true, value: { surfaceId: 'surface-current', generation: 7, state: blankState } }
        : { ok: true, value: blankState }),
      onEvent(_eventName, handler) {
        stateHandler = handler
        return () => { stateHandler = null }
      },
    }

    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'main' })
    const titles: string[] = []
    controller.onStateChanged(state => titles.push(state.title))

    for (const event of [
      { surfaceId: 'surface-other-window', generation: 7, state: { ...blankState, title: 'Other window' } },
      { surfaceId: 'surface-current', generation: 6, state: { ...blankState, title: 'Replaced native instance' } },
      { surfaceId: 'surface-current', generation: 7, state: { ...blankState, title: 'Current instance' } },
    ]) {
      ;(stateHandler as ((payload: unknown) => void) | null)?.(event)
    }

    expect(titles).toEqual(['Current instance'])
    await expect(controller.getState()).resolves.toMatchObject({ title: '' })
  })

  it('clips native bounds to overflow ancestors', async () => {
    const invoke = vi.fn(async (command: string) => command === 'task_browser_surface_get_or_create'
      ? { ok: true, value: { surfaceId: 'surface-2', generation: 1, state: blankState } }
      : { ok: true, value: undefined })
    window.openforge = { version: 1, invoke, onEvent: () => () => undefined }

    const parent = document.createElement('div')
    parent.style.overflow = 'hidden'
    const element = document.createElement('div')
    parent.append(element)
    document.body.append(parent)
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      x: 30, y: 40, width: 50, height: 50, top: 40, right: 80, bottom: 90, left: 30, toJSON: () => ({}),
    })
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, width: 100, height: 100, top: 20, right: 110, bottom: 120, left: 10, toJSON: () => ({}),
    })

    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'clipped' })
    const attachment = await controller.attach(element)

    expect(invoke).toHaveBeenCalledWith('task_browser_surface_attach', expect.objectContaining({
      bounds: { x: 30, y: 40, width: 50, height: 50 },
    }))
    await attachment.dispose()
  })

  it('turns unavailable Electron and serialized host failures into named public errors', async () => {
    const surfaces = createHostBrowserSurfaces('browser')
    await expect(surfaces.getOrCreate({ taskId: 'T-1', id: 'main' })).rejects.toMatchObject({
      name: 'BrowserSurfaceError',
      code: 'HOST_UNAVAILABLE',
    })

    window.openforge = {
      version: 1,
      invoke: vi.fn(async () => ({
        ok: false,
        error: { code: 'PLUGIN_NOT_ENABLED', message: 'Plugin is disabled for the Task project' },
      })),
      onEvent: vi.fn(() => () => undefined),
    }
    await expect(createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'main' })).rejects.toMatchObject({
      name: 'BrowserSurfaceError',
      code: 'PLUGIN_NOT_ENABLED',
    })
  })
})
