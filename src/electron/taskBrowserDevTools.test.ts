import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  electronFakes,
  preventableEvent,
} from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import type { TaskBrowserNativeState } from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'

type PlatformDevToolsShortcut = 'toggle' | 'elements' | 'console'

const platformDevToolsModifiers = (shortcut: PlatformDevToolsShortcut = 'toggle') => process.platform === 'darwin'
  ? shortcut === 'elements'
    ? { meta: true, shift: true }
    : { meta: true, alt: true }
  : { control: true, shift: true }

const platformDevToolsInputModifiers = (shortcut: PlatformDevToolsShortcut = 'toggle') => process.platform === 'darwin'
  ? shortcut === 'elements'
    ? ['meta', 'shift']
    : ['meta', 'alt']
  : ['control', 'shift']

describe('Task Browser DevTools integration', () => {
  beforeEach(() => electronFakes.reset())

  it('opens packaged Task Browser DevTools and publishes their live surface state', async () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const states: TaskBrowserNativeState[] = []
    surface.onStateChanged(state => states.push(state))

    expect((view.options as { webPreferences: { devTools: boolean } }).webPreferences.devTools).toBe(true)
    expect(surface.getState().devToolsOpen).toBe(false)

    await surface.openDevTools()
    expect(view.webContents.openDevToolsCalls).toEqual([undefined])
    expect(surface.getState().devToolsOpen).toBe(true)
    expect(states.at(-1)?.devToolsOpen).toBe(true)

    surface.detach()
    expect(surface.getState().devToolsOpen).toBe(true)

    await surface.closeDevTools()
    expect(view.webContents.closeDevToolsCalls).toBe(1)
    expect(surface.getState().devToolsOpen).toBe(false)
    expect(states.at(-1)?.devToolsOpen).toBe(false)
  })

  it('rejects when Chromium does not open Task Browser DevTools', async () => {
    vi.useFakeTimers()
    try {
      const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
        windowId: 10,
        partition: 'persist:test-browser-devtools-failure',
        webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
        popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
      })
      const contents = electronFakes.views[0].webContents
      contents.emitDevToolsEvents = false

      const opening = surface.openDevTools()
      const rejection = expect(opening).rejects.toMatchObject({
        code: 'HOST_UNAVAILABLE',
        message: 'Chromium Developer Tools did not open',
      })
      await vi.advanceTimersByTimeAsync(2_000)
      await rejection
      expect(surface.getState().devToolsOpen).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels active visual-feedback selection before opening Task Browser DevTools', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-selection',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const contents = electronFakes.views[0].webContents
    let finishSelection!: (value: null) => void
    const pendingSelection = new Promise<null>(resolve => { finishSelection = resolve })
    contents.executeJavaScriptResults = [undefined, pendingSelection, undefined]
    let selectionFinished = false
    const selection = surface.selectVisibleRegion().then(result => {
      selectionFinished = true
      return result
    })
    while (contents.executeJavaScriptCalls.length < 2) await Promise.resolve()

    await surface.openDevTools()
    await Promise.resolve()

    expect(selectionFinished).toBe(true)
    await expect(selection).resolves.toBeNull()
    expect(contents.executeJavaScriptCalls.at(-1)).toContain('__openforge_visual_feedback_selector__')
    expect(contents.openDevToolsCalls).toEqual([undefined])
    finishSelection(null)
  })

  it('toggles Task Browser DevTools with standard shortcuts in the page and focused popups', async () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-shortcuts',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents

    const openEvent = preventableEvent()
    contents.emit('before-input-event', openEvent, { type: 'keyDown', key: 'F12' })
    expect(openEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(contents.openDevToolsCalls).toEqual([undefined]))

    const closeEvent = preventableEvent()
    contents.emit('before-input-event', closeEvent, {
      type: 'keyDown',
      key: 'i',
      ...platformDevToolsModifiers(),
    })
    expect(closeEvent.prevented).toBe(true)
    expect(contents.closeDevToolsCalls).toBe(1)

    const ignoredEvent = preventableEvent()
    contents.emit('before-input-event', ignoredEvent, { type: 'keyDown', key: 'r', control: true })
    expect(ignoredEvent.prevented).toBe(false)

    const wrongPlatformEvent = preventableEvent()
    contents.emit('before-input-event', wrongPlatformEvent, {
      type: 'keyDown',
      key: 'i',
      ...(process.platform === 'darwin'
        ? { control: true, shift: true }
        : { meta: true, alt: true }),
    })
    expect(wrongPlatformEvent.prevented).toBe(false)

    const popup = electronFakes.openPopup(contents, 'https://popup.example').child!
    const popupEvent = preventableEvent()
    popup.webContents.emit('before-input-event', popupEvent, {
      type: 'keyDown',
      key: 'i',
      ...platformDevToolsModifiers(),
    })
    expect(popupEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(popup.webContents.openDevToolsCalls).toEqual([undefined]))

    surface.destroy()
  })

  it('forwards Elements and Console shortcuts to Chromium DevTools', async () => {
    new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-panels',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents
    const elementsInput = { type: 'keyDown', key: 'c', ...platformDevToolsModifiers('elements') }
    const elementsEvent = preventableEvent()

    contents.emit('before-input-event', elementsEvent, elementsInput)
    expect(elementsEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(contents.openDevToolsCalls).toEqual([undefined]))
    expect(contents.devToolsInputEvents).toEqual([
      { type: 'keyDown', keyCode: 'C', modifiers: platformDevToolsInputModifiers('elements') },
    ])

    const consoleInput = { type: 'keyDown', key: 'j', ...platformDevToolsModifiers() }
    const consoleEvent = preventableEvent()
    contents.emit('before-input-event', consoleEvent, consoleInput)
    expect(consoleEvent.prevented).toBe(true)
    expect(contents.openDevToolsCalls).toHaveLength(1)
    await vi.waitFor(() => expect(contents.devToolsInputEvents).toEqual([
      { type: 'keyDown', keyCode: 'C', modifiers: platformDevToolsInputModifiers('elements') },
      { type: 'keyDown', keyCode: 'J', modifiers: platformDevToolsInputModifiers() },
    ]))
  })

  it('offers Inspect element for the page and host-owned popups', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-inspect',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const contents = electronFakes.views[0].webContents

    contents.emit('context-menu', {}, { x: 24, y: 36 })
    expect(electronFakes.menuPopups).toHaveLength(1)
    expect(electronFakes.menuPopups[0].template.map(item => item.label)).toEqual(['Inspect element'])
    electronFakes.menuPopups[0].template[0].click?.()
    await vi.waitFor(() => expect(contents.inspectElementCalls).toEqual([{ x: 24, y: 36 }]))

    const popup = electronFakes.openPopup(contents, 'https://popup.example').child!
    popup.webContents.emit('context-menu', {}, { x: 8, y: 12 })
    electronFakes.menuPopups[1].template[0].click?.()
    await vi.waitFor(() => expect(popup.webContents.inspectElementCalls).toEqual([{ x: 8, y: 12 }]))
  })

})
