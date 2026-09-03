import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BrowserSurfacesAPI, TaskBrowserSurfaceController } from '@openforge-app/plugin-sdk/frontend'
import type { OpenForgeDesktopBridge } from '../desktopIpc'
import { createHostBrowserSurfaces } from './taskBrowserSurfaces'

const blankState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  devToolsOpen: false,
  error: null,
}

type ExactKeys<T, Expected extends PropertyKey> =
  [Exclude<keyof T, Expected>, Exclude<Expected, keyof T>] extends [never, never] ? true : false

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  }
}

function installAnimationFrameHarness() {
  let sequence = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))

  return {
    async flush() {
      const scheduled = Array.from(callbacks.values())
      callbacks.clear()
      for (const callback of scheduled) callback(performance.now())
      for (let count = 0; count < 4; count += 1) await Promise.resolve()
    },
  }
}

function installObserverHarness() {
  const resizeCallbacks: ResizeObserverCallback[] = []
  const mutationCallbacks: MutationCallback[] = []
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
    observe(): void {}
    disconnect(): void {}
  }
  class FakeMutationObserver {
    constructor(callback: MutationCallback) { mutationCallbacks.push(callback) }
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('MutationObserver', FakeMutationObserver)

  return {
    resize() {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
    },
    mutate() {
      for (const callback of mutationCallbacks) callback([], {} as MutationObserver)
    },
  }
}
describe('renderer Task Browser Surface host adapter', () => {
  afterEach(() => {
    delete window.openforge
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('limits the public contract to serializable lifecycle and navigation controls', () => {
    const apiContractIsExact: ExactKeys<BrowserSurfacesAPI, 'getOrCreate' | 'resetSession'> = true
    const controllerContractIsExact: ExactKeys<
      TaskBrowserSurfaceController,
      | 'attach'
      | 'detach'
      | 'destroy'
      | 'getState'
      | 'onStateChanged'
      | 'navigate'
      | 'goBack'
      | 'goForward'
      | 'reload'
      | 'stop'
      | 'openDevTools'
      | 'closeDevTools'
      | 'selectVisibleRegion'
      | 'cancelVisibleRegionSelection'
      | 'clearVisualFeedback'
      | 'replaceVisualFeedback'
      | 'captureExists'
      | 'captureVisibleViewport'
      | 'discardCapture'
    > = true

    expect({ apiContractIsExact, controllerContractIsExact }).toEqual({
      apiContractIsExact: true,
      controllerContractIsExact: true,
    })
  })

  it('serializes capture ownership and generation without exposing desktop transports to the plugin', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'task_browser_surface_get_or_create') {
        return { ok: true, value: { surfaceId: 'surface-capture', generation: 9, state: blankState } }
      }
      if (command === 'task_browser_surface_select_visible_region') {
        return { ok: true, value: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }
      }
      if (command === 'task_browser_surface_capture_exists') return { ok: true, value: true }
      if (command === 'task_browser_surface_capture_visible_viewport') {
        return {
          ok: true,
          value: {
            artifactId: 'capture-1',
            mediaType: 'image/png',
            width: 640,
            height: 480,
            dataUrl: 'data:image/png;base64,cG5n',
          },
        }
      }
      return { ok: true, value: undefined }
    })
    window.openforge = { version: 1, invoke, onEvent: () => () => undefined }
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'main' })

    const selection = await controller.selectVisibleRegion()
    const capture = await controller.captureVisibleViewport()
    await controller.clearVisualFeedback()
    await controller.replaceVisualFeedback([{
      annotationNumber: 1,
      url: 'https://example.com/',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'Corrected feedback',
    }], { appearance: 'light' })
    expect(await controller.captureExists(capture.artifactId)).toBe(true)
    await controller.discardCapture(capture.artifactId)

    const owner = {
      pluginId: 'browser',
      taskId: 'T-1',
      surfaceId: 'surface-capture',
      generation: 9,
    }
    expect(selection).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_select_visible_region', owner)
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_clear_visual_feedback', owner)
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_replace_visual_feedback', {
      ...owner,
      feedback: [{
        annotationNumber: 1,
        url: 'https://example.com/',
        region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        comment: 'Corrected feedback',
      }],
      presentation: { appearance: 'light' },
    })
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_capture_exists', { ...owner, artifactId: 'capture-1' })
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_capture_visible_viewport', owner)
    expect(invoke).toHaveBeenCalledWith('task_browser_surface_discard_capture', {
      ...owner,
      artifactId: 'capture-1',
    })
  })
  it('qualifies requests, serializes DOM bounds, forwards state, and disposes attachments safely', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = []
    let stateHandler: ((payload: unknown) => void) | null = null
    let actionHandler: ((payload: unknown) => void) | null = null
    const bridge: OpenForgeDesktopBridge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: 'surface-1', generation: 4, state: blankState } }
        }
        if (command === 'task_browser_surface_open_devtools') {
          return { ok: true, value: { ...blankState, devToolsOpen: true } }
        }
        return { ok: true, value: blankState }
      },
      onEvent(eventName, handler) {
        if (eventName === 'task-browser-surface-state') stateHandler = handler
        if (eventName === 'task-browser-visual-feedback-action') actionHandler = handler
        return () => {
          if (eventName === 'task-browser-surface-state') stateHandler = null
          if (eventName === 'task-browser-visual-feedback-action') actionHandler = null
        }
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
    const actions: unknown[] = []
    const actionSubscription = controller.onVisualFeedbackAction(action => actions.push(action))
    ;(stateHandler as ((payload: unknown) => void) | null)?.({
      surfaceId: 'surface-1',
      generation: 4,
      state: { ...blankState, title: 'Example' },
    })
    ;(actionHandler as ((payload: unknown) => void) | null)?.({
      surfaceId: 'surface-1',
      generation: 4,
      action: { type: 'delete-annotation', annotationNumber: 3 },
    })
    ;(actionHandler as ((payload: unknown) => void) | null)?.({
      surfaceId: 'surface-1',
      generation: 5,
      action: { type: 'delete-annotation', annotationNumber: 4 },
    })
    ;(actionHandler as ((payload: unknown) => void) | null)?.({
      surfaceId: 'surface-1',
      generation: 4,
      action: { type: 'delete-annotation', annotationNumber: 0 },
    })
    await controller.navigate('https://example.com/next')
    await expect(controller.openDevTools('console')).resolves.toMatchObject({ devToolsOpen: true })
    await expect(controller.closeDevTools()).resolves.toMatchObject({ devToolsOpen: false })
    await attachment.dispose()
    await subscription.dispose()
    await actionSubscription.dispose()
    await controller.destroy()

    expect(states).toEqual(['Example'])
    expect(actions).toEqual([{ type: 'delete-annotation', annotationNumber: 3 }])
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
    expect(invocations).toContainEqual({
      command: 'task_browser_surface_open_devtools',
      payload: { surfaceId: 'surface-1', panel: 'console' },
    })
    expect(invocations).toContainEqual({
      command: 'task_browser_surface_close_devtools',
      payload: { surfaceId: 'surface-1' },
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

  it('keeps native bounds aligned through movement, scrolling, resizing, visibility, and disconnection', async () => {
    const raf = installAnimationFrameHarness()
    const observers = installObserverHarness()
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        return command === 'task_browser_surface_get_or_create'
          ? { ok: true, value: { surfaceId: 'surface-tracked', generation: 1, state: blankState } }
          : { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    let rect = domRect(10, 20, 300, 200)
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'tracked' })
    const attachment = await controller.attach(element)
    const attachmentCalls = () => invocations.filter(call => call.command === 'task_browser_surface_attach')

    expect(attachmentCalls().at(-1)?.payload).toMatchObject({
      surfaceId: 'surface-tracked',
      attachmentGeneration: expect.any(Number),
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    })

    rect = domRect(40, 50, 300, 200)
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: { x: 40, y: 50, width: 300, height: 200 } })

    rect = domRect(40, 30, 300, 200)
    window.dispatchEvent(new Event('scroll'))
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: { x: 40, y: 30, width: 300, height: 200 } })

    rect = domRect(40, 30, 420, 260)
    observers.resize()
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: { x: 40, y: 30, width: 420, height: 260 } })

    rect = domRect(20, 15, 420, 260)
    window.dispatchEvent(new Event('resize'))
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: { x: 20, y: 15, width: 420, height: 260 } })

    element.style.visibility = 'hidden'
    observers.mutate()
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: null })

    element.style.visibility = 'visible'
    observers.mutate()
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: { x: 20, y: 15, width: 420, height: 260 } })

    element.remove()
    observers.mutate()
    await raf.flush()
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: null })

    await attachment.dispose()
  })

  it('republishes unchanged CSS bounds when the renderer zoom factor changes', async () => {
    const raf = installAnimationFrameHarness()
    installObserverHarness()
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        return command === 'task_browser_surface_get_or_create'
          ? { ok: true, value: { surfaceId: 'surface-zoomed', generation: 1, state: blankState } }
          : { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(10, 20, 300, 200))
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'zoomed' })
    const attachment = await controller.attach(element)
    const attachmentCalls = () => invocations.filter(call => call.command === 'task_browser_surface_attach')
    const expectedBounds = { x: 10, y: 20, width: 300, height: 200 }

    expect(attachmentCalls()).toHaveLength(1)
    await raf.flush()
    expect(attachmentCalls(), 'unchanged bounds must not be republished').toHaveLength(1)

    // The host converts CSS pixels with the renderer zoom factor, which moves devicePixelRatio with it.
    // A fixed-size attachment keeps its CSS rect across a zoom change, so the host still needs a fresh push.
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2.2 })
    await raf.flush()
    expect(attachmentCalls()).toHaveLength(2)
    expect(attachmentCalls().at(-1)?.payload).toMatchObject({ bounds: expectedBounds })

    await raf.flush()
    expect(attachmentCalls()).toHaveLength(2)

    await attachment.dispose()
  })

  it('retries transient visible and hidden attachment update failures', async () => {
    const raf = installAnimationFrameHarness()
    const observers = installObserverHarness()
    const attachmentPayloads: Array<{ bounds: unknown }> = []
    let failNextAttachment = false
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: 'surface-retry', generation: 1, state: blankState } }
        }
        if (command === 'task_browser_surface_attach') {
          attachmentPayloads.push(payload as { bounds: unknown })
          if (failNextAttachment) {
            failNextAttachment = false
            return { ok: false, error: { code: 'HOST_UNAVAILABLE' as const, message: 'transient failure' } }
          }
        }
        return { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let rect = domRect(10, 20, 300, 200)
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'retry' })
    const attachment = await controller.attach(element)

    rect = domRect(30, 40, 300, 200)
    failNextAttachment = true
    await raf.flush()
    await raf.flush()
    expect(attachmentPayloads.filter(payload =>
      JSON.stringify(payload.bounds) === JSON.stringify({ x: 30, y: 40, width: 300, height: 200 }),
    )).toHaveLength(2)

    element.style.visibility = 'hidden'
    failNextAttachment = true
    observers.mutate()
    await raf.flush()
    await raf.flush()
    expect(attachmentPayloads.filter(payload => payload.bounds === null)).toHaveLength(2)

    await attachment.dispose()
  })
  it.each([
    { label: 'visible', hidden: false, expectedBounds: { x: 10, y: 20, width: 300, height: 200 } },
    { label: 'hidden', hidden: true, expectedBounds: null },
  ])('retries a transient initial $label attachment update', async ({ hidden, expectedBounds }) => {
    installAnimationFrameHarness()
    installObserverHarness()
    const attachmentPayloads: Array<{ bounds: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: `surface-initial-${hidden}`, generation: 1, state: blankState } }
        }
        if (command === 'task_browser_surface_attach') {
          attachmentPayloads.push(payload as { bounds: unknown })
          if (attachmentPayloads.length === 1) {
            return { ok: false, error: { code: 'HOST_UNAVAILABLE' as const, message: 'transient failure' } }
          }
        }
        return { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    const element = document.createElement('div')
    if (hidden) element.style.display = 'none'
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      hidden ? domRect(0, 0, 0, 0) : domRect(10, 20, 300, 200),
    )
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: `initial-${hidden}` })
    const attachment = await controller.attach(element)

    expect(attachmentPayloads).toHaveLength(2)
    expect(attachmentPayloads[0].bounds).toEqual(expectedBounds)
    expect(attachmentPayloads[1].bounds).toEqual(expectedBounds)

    await attachment.dispose()
  })

  it('gives remounted attachments increasing generations so stale disposal cannot detach the replacement', async () => {
    installAnimationFrameHarness()
    installObserverHarness()
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        return command === 'task_browser_surface_get_or_create'
          ? { ok: true, value: { surfaceId: 'surface-remounted', generation: 1, state: blankState } }
          : { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    const firstElement = document.createElement('div')
    const replacementElement = document.createElement('div')
    replacementElement.style.display = 'none'
    document.body.append(firstElement, replacementElement)
    vi.spyOn(firstElement, 'getBoundingClientRect').mockReturnValue(domRect(0, 0, 100, 100))
    vi.spyOn(replacementElement, 'getBoundingClientRect').mockReturnValue(domRect(0, 0, 0, 0))
    const controller = await createHostBrowserSurfaces('browser').getOrCreate({ taskId: 'T-1', id: 'remounted' })

    const first = await controller.attach(firstElement)
    const replacement = await controller.attach(replacementElement)
    const attachPayloads = invocations
      .filter(call => call.command === 'task_browser_surface_attach')
      .map(call => call.payload as { attachmentId: string; attachmentGeneration: number; bounds: unknown })
    expect(attachPayloads).toHaveLength(2)
    expect(attachPayloads[1].attachmentGeneration).toBeGreaterThan(attachPayloads[0].attachmentGeneration)
    expect(attachPayloads[1].bounds).toBeNull()

    await first.dispose()
    expect(invocations.at(-1)).toEqual({
      command: 'task_browser_surface_detach',
      payload: {
        surfaceId: 'surface-remounted',
        attachmentId: attachPayloads[0].attachmentId,
        attachmentGeneration: attachPayloads[0].attachmentGeneration,
      },
    })

    await replacement.dispose()
  })

  it('destroy stops attachment tracking created by any controller for the live surface', async () => {
    const raf = installAnimationFrameHarness()
    installObserverHarness()
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        return command === 'task_browser_surface_get_or_create'
          ? { ok: true, value: { surfaceId: 'surface-destroyed', generation: 1, state: blankState } }
          : { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    let rect = domRect(10, 20, 300, 200)
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    const surfaces = createHostBrowserSurfaces('browser')
    const attachingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'destroyed' })
    const destroyingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'destroyed' })
    const attachment = await attachingController.attach(element)
    const attachCountBeforeDestroy = invocations.filter(call => call.command === 'task_browser_surface_attach').length

    await destroyingController.destroy()
    rect = domRect(40, 50, 300, 200)
    window.dispatchEvent(new Event('scroll'))
    await raf.flush()

    expect(invocations.filter(call => call.command === 'task_browser_surface_attach')).toHaveLength(attachCountBeforeDestroy)
    expect(invocations.filter(call => call.command === 'task_browser_surface_detach')).toHaveLength(1)
    expect(invocations.at(-1)).toEqual({
      command: 'task_browser_surface_destroy',
      payload: { surfaceId: 'surface-destroyed' },
    })

    await attachment.dispose()
    expect(invocations.at(-1)).toEqual({
      command: 'task_browser_surface_destroy',
      payload: { surfaceId: 'surface-destroyed' },
    })
  })


  it('destroy wins against an attachment whose initial host update is pending', async () => {
    const raf = installAnimationFrameHarness()
    installObserverHarness()
    let releaseInitialAttachment: (() => void) | null = null
    const initialAttachmentGate = new Promise<void>(resolve => { releaseInitialAttachment = resolve })
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: 'surface-pending-destroy', generation: 1, state: blankState } }
        }
        if (command === 'task_browser_surface_attach') await initialAttachmentGate
        return { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    let rect = domRect(10, 20, 300, 200)
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
    const surfaces = createHostBrowserSurfaces('browser')
    const attachingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'pending-destroy' })
    const destroyingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'pending-destroy' })

    const pendingAttachment = attachingController.attach(element)
    for (let count = 0; count < 8; count += 1) {
      if (invocations.some(call => call.command === 'task_browser_surface_attach')) break
      await Promise.resolve()
    }
    const destroy = destroyingController.destroy()
    ;(releaseInitialAttachment as (() => void) | null)?.()
    const attachmentOutcome = await pendingAttachment.then(
      () => 'resolved',
      error => (error as { code?: string }).code ?? 'unexpected-error',
    )
    await destroy

    rect = domRect(40, 50, 300, 200)
    window.dispatchEvent(new Event('scroll'))
    await raf.flush()

    expect(attachmentOutcome).toBe('SURFACE_DESTROYED')
    expect(invocations.filter(call => call.command === 'task_browser_surface_attach')).toHaveLength(1)
    expect(invocations.filter(call => call.command === 'task_browser_surface_detach')).toHaveLength(1)
    expect(invocations.at(-1)).toEqual({
      command: 'task_browser_surface_destroy',
      payload: { surfaceId: 'surface-pending-destroy' },
    })
  })


  it('blocks reacquisition until in-progress destroy cleanup completes', async () => {
    installAnimationFrameHarness()
    installObserverHarness()
    let releaseDetach: (() => void) | null = null
    const detachGate = new Promise<void>(resolve => { releaseDetach = resolve })
    let hostDestroyed = false
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        if (command === 'task_browser_surface_get_or_create') {
          const surfaceId = hostDestroyed ? 'surface-after-destroy' : 'surface-before-destroy'
          return { ok: true, value: { surfaceId, generation: hostDestroyed ? 2 : 1, state: blankState } }
        }
        if (command === 'task_browser_surface_detach') await detachGate
        if (command === 'task_browser_surface_destroy') hostDestroyed = true
        if (command === 'task_browser_surface_get_state') return { ok: true, value: blankState }
        return { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(10, 20, 300, 200))
    const surfaces = createHostBrowserSurfaces('browser')
    const firstController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'reacquire-after-destroy' })
    const destroyingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'reacquire-after-destroy' })
    await firstController.attach(element)

    const destroy = destroyingController.destroy()
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    let reacquireSettled = false
    const reacquired = surfaces.getOrCreate({ taskId: 'T-1', id: 'reacquire-after-destroy' }).then(controller => {
      reacquireSettled = true
      return controller
    })
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    const settledDuringCleanup = reacquireSettled

    ;(releaseDetach as (() => void) | null)?.()
    await destroy
    const replacement = await reacquired
    await replacement.getState()

    expect(settledDuringCleanup).toBe(false)
    expect(invocations).toContainEqual({
      command: 'task_browser_surface_get_state',
      payload: { surfaceId: 'surface-after-destroy' },
    })
  })

  it('blocks attachments registered while destroy is disposing an earlier attachment', async () => {
    const raf = installAnimationFrameHarness()
    installObserverHarness()
    let releaseDetach: (() => void) | null = null
    const detachGate = new Promise<void>(resolve => { releaseDetach = resolve })
    let hostDestroyed = false
    const invocations: Array<{ command: string; payload: unknown }> = []
    window.openforge = {
      version: 1,
      async invoke(command, payload) {
        invocations.push({ command, payload })
        if (command === 'task_browser_surface_get_or_create') {
          return { ok: true, value: { surfaceId: 'surface-late-attachment', generation: 1, state: blankState } }
        }
        if (command === 'task_browser_surface_detach') await detachGate
        if (command === 'task_browser_surface_destroy') hostDestroyed = true
        if (command === 'task_browser_surface_attach' && hostDestroyed) {
          return { ok: false, error: { code: 'SURFACE_DESTROYED' as const, message: 'surface destroyed' } }
        }
        return { ok: true, value: undefined }
      },
      onEvent: () => () => undefined,
    }

    const firstElement = document.createElement('div')
    const lateElement = document.createElement('div')
    document.body.append(firstElement, lateElement)
    vi.spyOn(firstElement, 'getBoundingClientRect').mockReturnValue(domRect(10, 20, 300, 200))
    vi.spyOn(lateElement, 'getBoundingClientRect').mockReturnValue(domRect(40, 50, 300, 200))
    const surfaces = createHostBrowserSurfaces('browser')
    const firstController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'late-attachment' })
    const destroyingController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'late-attachment' })
    const lateController = await surfaces.getOrCreate({ taskId: 'T-1', id: 'late-attachment' })
    await firstController.attach(firstElement)

    const destroy = destroyingController.destroy()
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    let lateAttachmentSettled = false
    const lateAttachment = lateController.attach(lateElement).then(
      () => {
        lateAttachmentSettled = true
        return 'resolved'
      },
      error => {
        lateAttachmentSettled = true
        return (error as { code?: string }).code ?? 'unexpected-error'
      },
    )
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    const settledDuringCleanup = lateAttachmentSettled

    ;(releaseDetach as (() => void) | null)?.()
    await destroy
    const lateAttachmentOutcome = await lateAttachment
    const attachCountAfterCleanup = invocations.filter(call => call.command === 'task_browser_surface_attach').length
    window.dispatchEvent(new Event('scroll'))
    await raf.flush()

    expect(settledDuringCleanup).toBe(false)
    expect(lateAttachmentOutcome).toBe('SURFACE_DESTROYED')
    expect(invocations.filter(call => call.command === 'task_browser_surface_attach')).toHaveLength(attachCountAfterCleanup)
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
