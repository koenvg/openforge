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

describe('Task Browser security policy integration', () => {
  beforeEach(() => electronFakes.reset())

  it('keeps secure browser preferences fixed and only permits HTTP(S) top-level destinations', () => {
    const factory = new ElectronTaskBrowserSurfaceFactory()
    factory.createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const contents = view.webContents

    expect(view.options).toEqual({
      webPreferences: {
        ...SECURE_TASK_BROWSER_WEB_PREFERENCES,
        partition: 'persist:test-browser',
        devTools: true,
      },
    })

    for (const url of ['https://example.com', 'http://localhost:3000/path']) {
      const event = preventableEvent()
      contents.emit('will-navigate', event, url)
      expect(event.prevented).toBe(false)
    }

    for (const url of [
      'about:blank',
      'file:///tmp/secret',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'plugin://browser/page',
      'openforge://internal',
      'mailto:user@example.com',
      'malformed',
    ]) {
      const event = preventableEvent()
      contents.emit('will-navigate', event, url)
      expect(event.prevented, url).toBe(true)
    }

    const unsafeRedirect = preventableEvent()
    contents.emit('will-redirect', unsafeRedirect, 'file:///tmp/redirected')
    expect(unsafeRedirect.prevented).toBe(true)
    expect(electronFakes.openPopup(contents, 'https://popup.example').response?.action).toBe('allow')
    expect(electronFakes.openPopup(contents, 'file:///tmp/popup').response).toEqual({ action: 'deny' })
    expect(electronFakes.openPopup(contents, 'https://popup.example', 'sandbox=no').response)
      .toEqual({ action: 'deny' })
  })

  it('creates host-owned HTTP(S) children with the parent session and complete browser policy', () => {
    const window = electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-popup',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const parentContents = electronFakes.views[0].webContents

    const { response, child } = electronFakes.openPopup(
      parentContents,
      'https://auth.example/authorize',
      'width=640,height=720',
    )

    expect(response).toMatchObject({
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        parent: window,
        webPreferences: {
          ...SECURE_TASK_BROWSER_WEB_PREFERENCES,
          partition: 'persist:test-browser-popup',
          devTools: true,
        },
      },
    })
    expect(child).not.toBeNull()
    expect(child!.webContents.session).toBe(parentContents.session)
    expect(child!.webContents.session.handlers.get('permission-request'))
      .toBe(parentContents.session.handlers.get('permission-request'))
    expect(child!.webContents.session.handlers.get('will-download'))
      .toBe(parentContents.session.handlers.get('will-download'))

    const childDownload = new electronFakes.FakeDownloadItem('oauth-token.json')
    parentContents.session.emit('will-download', {}, childDownload, child!.webContents)
    expect(childDownload.saveDialogOptions).toEqual([expect.objectContaining({
      defaultPath: '/downloads/oauth-token.json',
    })])
    childDownload.emit('done', {}, 'completed')

    const unsafeNavigation = preventableEvent()
    child!.webContents.emit('will-navigate', unsafeNavigation, 'file:///tmp/secret')
    expect(unsafeNavigation.prevented).toBe(true)
    expect(electronFakes.openPopup(child!.webContents, 'https://nested.example').response?.action).toBe('allow')
    expect(electronFakes.openPopup(child!.webContents, 'https://nested.example', 'nodeIntegration=yes').response)
      .toEqual({ action: 'deny' })
  })

  it('supports a deterministic OAuth-style handoff through one shared Plugin Browser Session', () => {
    const factory = new ElectronTaskBrowserSurfaceFactory()
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-a',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-a',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-b',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const firstParent = electronFakes.views[0].webContents
    const sameSessionParent = electronFakes.views[1].webContents
    const isolatedParent = electronFakes.views[2].webContents

    firstParent.session.siteData.set('oauth-state', 'deterministic-nonce')
    const { child } = electronFakes.openPopup(firstParent, 'http://127.0.0.1:4173/oauth/authorize')
    expect(child!.webContents.session.siteData.get('oauth-state')).toBe('deterministic-nonce')

    child!.webContents.session.siteData.set('auth-cookie', 'credential-free-test-token')
    expect(sameSessionParent.session.siteData.get('auth-cookie')).toBe('credential-free-test-token')
    expect(isolatedParent.session.siteData.has('oauth-state')).toBe(false)
    expect(isolatedParent.session.siteData.has('auth-cookie')).toBe(false)
  })

  it('closes all popup descendants when the parent live surface is destroyed', () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-cleanup',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const parentContents = electronFakes.views[0].webContents
    const first = electronFakes.openPopup(parentContents, 'https://auth.example/first').child!
    const nested = electronFakes.openPopup(first.webContents, 'https://auth.example/nested').child!
    const second = electronFakes.openPopup(parentContents, 'https://auth.example/second').child!

    surface.destroy()

    expect([first, nested, second].every(child => child.isDestroyed())).toBe(true)
    expect(parentContents.destroyed).toBe(true)
  })

})
