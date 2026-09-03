import { beforeEach, describe, expect, it } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import { forwardTaskBrowserSurfaceRendererEvent } from './electronBootAdapter'

describe('Electron boot Task Browser Surface event forwarding', () => {
  beforeEach(() => electronFakes.reset())

  it('forwards typed visual-feedback actions to the owning renderer window', () => {
    const window = electronFakes.registerWindow(10)
    const event = {
      windowId: 10,
      surfaceId: 'surface-1',
      generation: 4,
      action: { type: 'delete-annotation' as const, annotationNumber: 3 },
    }

    forwardTaskBrowserSurfaceRendererEvent('task-browser-visual-feedback-action', event)

    expect(window.webContents.sentMessages).toEqual([[
      'openforge:event',
      { eventName: 'task-browser-visual-feedback-action', payload: event },
    ]])
  })

  it('does not forward events after the owning window is destroyed', () => {
    const window = electronFakes.registerWindow(10)
    window.destroy()

    forwardTaskBrowserSurfaceRendererEvent('task-browser-visual-feedback-action', {
      windowId: 10,
      surfaceId: 'surface-1',
      generation: 4,
      action: { type: 'delete-annotation', annotationNumber: 3 },
    })

    expect(window.webContents.sentMessages).toEqual([])
  })
})
