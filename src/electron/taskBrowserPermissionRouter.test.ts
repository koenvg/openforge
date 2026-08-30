import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'

describe('Task Browser permission routing integration', () => {
  beforeEach(() => electronFakes.reset())

  it('routes owned permission checks and requests through the host policy and fails closed otherwise', async () => {
    const permissionHandler = {
      check: vi.fn(() => true),
      request: vi.fn(async () => true),
    }
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-permissions',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
      permissionHandler,
    })
    const contents = electronFakes.views[0].webContents
    const browserSession = contents.session
    const check = browserSession.handlers.get('permission-check')![0] as unknown as (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: unknown,
    ) => boolean
    const request = browserSession.handlers.get('permission-request')![0] as unknown as (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
      details: unknown,
    ) => void
    const details = {
      requestingUrl: 'https://meet.example/room',
      securityOrigin: 'https://meet.example',
      mediaTypes: ['audio'],
      isMainFrame: true,
    }

    expect(check(contents, 'media', 'https://meet.example', {
      securityOrigin: 'https://meet.example',
      mediaType: 'audio',
      isMainFrame: true,
    })).toBe(true)
    expect(permissionHandler.check).toHaveBeenCalledWith({
      permission: 'media',
      requestingOrigin: 'https://meet.example',
      details: { securityOrigin: 'https://meet.example', mediaType: 'audio', isMainFrame: true },
    })

    const decisions: boolean[] = []
    request(contents, 'media', allowed => decisions.push(allowed), details)
    await vi.waitFor(() => expect(decisions).toEqual([true]))
    expect(permissionHandler.request).toHaveBeenCalledWith({
      windowId: 10,
      permission: 'media',
      details,
    })

    request({}, 'notifications', allowed => decisions.push(allowed), {
      requestingUrl: 'https://meet.example',
      isMainFrame: true,
    })
    expect(decisions).toEqual([true, false])

    surface.destroy()
    expect(check(contents, 'notifications', 'https://meet.example', { isMainFrame: true })).toBe(false)
  })

})
