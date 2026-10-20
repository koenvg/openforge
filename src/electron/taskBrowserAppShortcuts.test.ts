import { beforeEach, describe, expect, it } from 'vitest'

import {
  electronFakes,
  preventableEvent,
} from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'

function attachedSurface() {
  const appWindow = electronFakes.registerWindow(10)
  const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
    windowId: 10,
    partition: 'persist:test-browser-app-shortcuts',
    webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
    popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
  })
  surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
  return { appWindow, contents: electronFakes.views[0].webContents }
}

describe('Task Browser app shortcuts', () => {
  beforeEach(() => electronFakes.reset())

  it('hands ⌘N to the app window so New Task opens while the page has focus', () => {
    const { appWindow, contents } = attachedSurface()

    const event = preventableEvent()
    contents.emit('before-input-event', event, { type: 'keyDown', key: 'n', meta: true })

    expect(event.prevented).toBe(true)
    expect(appWindow.webContents.focusCalls).toBe(1)
    expect(appWindow.webContents.inputEvents).toEqual([
      { type: 'keyDown', keyCode: 'N', modifiers: ['meta'] },
      { type: 'keyUp', keyCode: 'N', modifiers: ['meta'] },
    ])
  })

  it('hands ⌘N over from a Task Browser popup too', () => {
    const { appWindow, contents } = attachedSurface()
    const popup = electronFakes.openPopup(contents, 'https://popup.example').child!

    const event = preventableEvent()
    popup.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'N', meta: true })

    expect(event.prevented).toBe(true)
    expect(appWindow.webContents.inputEvents).toHaveLength(2)
  })

  it.each([
    { label: 'plain N', input: { type: 'keyDown', key: 'n' } },
    { label: '⌘⇧N', input: { type: 'keyDown', key: 'n', meta: true, shift: true } },
    { label: '⌃N', input: { type: 'keyDown', key: 'n', control: true } },
    { label: 'key repeat', input: { type: 'keyDown', key: 'n', meta: true, isAutoRepeat: true } },
    { label: 'key release', input: { type: 'keyUp', key: 'n', meta: true } },
  ])('leaves $label to the page', ({ input }) => {
    const { appWindow, contents } = attachedSurface()

    const event = preventableEvent()
    contents.emit('before-input-event', event, input)

    expect(event.prevented).toBe(false)
    expect(appWindow.webContents.inputEvents).toEqual([])
  })
})
