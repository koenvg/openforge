import { describe, expect, it } from 'vitest'

import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  constrainTaskBrowserBounds,
  isTaskBrowserUrlAllowed,
  isSupersededTaskBrowserPartition,
  pluginBrowserSessionPartition,
  scaleTaskBrowserBounds,
  validateTaskBrowserSurfaceIdentity,
} from './taskBrowserSurfacePolicy'
import { TaskBrowserSurfaceError } from './taskBrowserSurfaceContract'

describe('Task Browser Surface policy', () => {
  it('derives one stable partition per plugin so every Task shares its login', () => {
    expect(pluginBrowserSessionPartition('browser')).toBe(
      'persist:openforge-plugin-browser-d4c3e8a11256ab82a4fc72560eb4a2b0e87bad820c290dd9b03616de240aa6db',
    )
    expect(pluginBrowserSessionPartition('notes')).toBe(
      'persist:openforge-plugin-browser-ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309',
    )
  })

  it('isolates partitions between plugins but never between Tasks', () => {
    expect(pluginBrowserSessionPartition('browser')).not.toBe(pluginBrowserSessionPartition('notes'))
  })

  it('recognizes superseded per-Task partitions so first launch can purge them', () => {
    const legacy = 'persist:openforge-task-browser-f3c7a3c60de8e74b261b9e88aeaf2593e6ff954e58b3a1c5b3849f6731f97ba0'
    expect(isSupersededTaskBrowserPartition(legacy)).toBe(true)
    expect(isSupersededTaskBrowserPartition(pluginBrowserSessionPartition('browser'))).toBe(false)
  })

  it('allows HTTP(S) navigation and popups without privileged preference overrides', () => {
    for (const url of ['https://auth.example/start', 'http://127.0.0.1:4173/oauth/start']) {
      expect(isTaskBrowserUrlAllowed(url), url).toBe(true)
      expect(SECURE_TASK_BROWSER_POPUP_POLICY.isAllowed({ url, features: '' }), url).toBe(true)
      expect(SECURE_TASK_BROWSER_POPUP_POLICY.isAllowed({
        url,
        features: 'width=640,height=720,resizable=yes',
      }), url).toBe(true)
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
      expect(isTaskBrowserUrlAllowed(url), url).toBe(false)
      expect(SECURE_TASK_BROWSER_POPUP_POLICY.isAllowed({ url, features: '' }), url).toBe(false)
    }

    for (const features of [
      'nodeIntegration=yes',
      'contextIsolation=no',
      'sandbox=no',
      'webSecurity=no',
      'allowRunningInsecureContent=yes',
      'webviewTag=yes',
      'preload=/tmp/unsafe.cjs',
      'devTools=yes',
      'partition=persist:other',
      'javascript=no',
      'zoomFactor=2',
      'NODEINTEGRATION=yes',
      ' nodeIntegration = yes ',
    ]) {
      expect(SECURE_TASK_BROWSER_POPUP_POLICY.isAllowed({
        url: 'https://auth.example/start',
        features,
      }), features).toBe(false)
    }
  })

  it('validates stable identities and constrains native bounds to the owning window', () => {
    expect(() => validateTaskBrowserSurfaceIdentity({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
    })).not.toThrow()
    expect(() => validateTaskBrowserSurfaceIdentity({
      windowId: 10,
      pluginId: 'bad/plugin',
      taskId: 'T-1',
      id: 'main',
    })).toThrow(TaskBrowserSurfaceError)

    expect(constrainTaskBrowserBounds(
      { x: -20.4, y: 10.2, width: 900.8, height: 700.1 },
      { x: 0, y: 0, width: 800, height: 600 },
    )).toEqual({ x: 0, y: 10, width: 800, height: 590 })
    expect(constrainTaskBrowserBounds(
      { x: 900, y: 700, width: 10, height: 10 },
      { x: 0, y: 0, width: 800, height: 600 },
    )).toBeNull()
  })

  it('scales renderer CSS pixel bounds into the window device-independent pixel space', () => {
    expect(scaleTaskBrowserBounds({ x: 250, y: 200, width: 1000, height: 800 }, 1)).toEqual({
      x: 250,
      y: 200,
      width: 1000,
      height: 800,
    })
    expect(scaleTaskBrowserBounds({ x: 250, y: 200, width: 1000, height: 800 }, 1.25)).toEqual({
      x: 312.5,
      y: 250,
      width: 1250,
      height: 1000,
    })
    expect(scaleTaskBrowserBounds({ x: 400, y: 320, width: 1600, height: 1280 }, 0.5)).toEqual({
      x: 200,
      y: 160,
      width: 800,
      height: 640,
    })

    for (const unusable of [0, -1.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleTaskBrowserBounds({ x: 10, y: 20, width: 30, height: 40 }, unusable), String(unusable)).toEqual({
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      })
    }
  })
})
