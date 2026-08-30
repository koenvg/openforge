import { beforeEach, describe, expect, it } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import { sanitizeTaskBrowserDownloadFilename } from './taskBrowserDownloads'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'

describe('Task Browser downloads integration', () => {
  beforeEach(() => electronFakes.reset())

  it.each([
    ['../../report.txt', 'report.txt'],
    ['..\\..\\unsafe<name>.txt', 'unsafe_name_.txt'],
    ['CON.txt', '_CON.txt'],
    ['photo.jpg. ', 'photo.jpg'],
    ['   ...   ', 'download'],
  ])('sanitizes suggested download filenames before presentation: %s', (suggested, expected) => {
    expect(sanitizeTaskBrowserDownloadFilename(suggested)).toBe(expected)
  })

  it('bounds multibyte suggested filenames while preserving a short extension', () => {
    const sanitized = sanitizeTaskBrowserDownloadFilename(`${'😀'.repeat(100)}.txt`)

    expect(Buffer.byteLength(sanitized, 'utf8')).toBeLessThanOrEqual(200)
    expect(sanitized).toMatch(/\.txt$/)
  })

  it('configures one host-owned Save dialog with a sanitized filename without supplying a destination', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('../../unsafe<name>.txt')

    view.webContents.session.emit('will-download', {}, item, view.webContents)

    expect(item.saveDialogOptions).toEqual([{
      title: 'Save download',
      defaultPath: '/downloads/unsafe_name_.txt',
      buttonLabel: 'Save',
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    }])
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(0)

    item.emit('done', {}, 'completed')
    surface.destroy()
    expect(item.cancelCalls).toBe(0)
  })

  it('releases a download after Electron reports native Save dialog cancellation', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('report.txt')

    view.webContents.session.emit('will-download', {}, item, view.webContents)
    item.emit('done', {}, 'cancelled')
    surface.destroy()

    expect(item.saveDialogOptions).toHaveLength(1)
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(0)
  })

  it('fails closed when the host cannot configure the native Save dialog', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('report.txt')
    item.saveDialogError = new Error('dialog unavailable')

    view.webContents.session.emit('will-download', {}, item, view.webContents)
    surface.destroy()

    expect(item.saveDialogOptions).toEqual([])
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(1)
  })

  it('ignores foreign native download handles and cancels owned in-flight downloads during cleanup', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const foreignItem = new electronFakes.FakeDownloadItem('foreign.txt')

    view.webContents.session.emit('will-download', {}, foreignItem, {})
    expect(foreignItem.saveDialogOptions).toEqual([])
    expect(foreignItem.cancelCalls).toBe(0)

    const ownedItem = new electronFakes.FakeDownloadItem('owned.txt')
    view.webContents.session.emit('will-download', {}, ownedItem, view.webContents)
    surface.destroy()

    expect(ownedItem.cancelCalls).toBe(1)
    expect(view.webContents.session.handlers.get('will-download')).toEqual([])
  })

})
