import { createHash } from 'node:crypto'

import {
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceContract.js'
import type {
  GetOrCreateTaskBrowserSurfaceRequest,
  PluginBrowserSessionPartition,
  TaskBrowserBounds,
  TaskBrowserPopupPolicy,
  TaskBrowserPopupRequest,
  TaskBrowserWebPreferences,
} from './taskBrowserSurfaceContract.js'

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const NON_CONFIGURABLE_POPUP_PREFERENCES = new Set([
  'allowrunninginsecurecontent',
  'contextisolation',
  'devtools',
  'javascript',
  'navigateondragdrop',
  'nodeintegration',
  'nodeintegrationinsubframes',
  'nodeintegrationinworker',
  'partition',
  'preload',
  'safedialogs',
  'sandbox',
  'session',
  'webpreferences',
  'websecurity',
  'webviewtag',
  'zoomfactor',
])

export const SECURE_TASK_BROWSER_WEB_PREFERENCES: TaskBrowserWebPreferences = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  safeDialogs: true,
  navigateOnDragDrop: false,
})

/**
 * One durable partition per plugin, spanning every Task and project, so a login performed in one
 * Task is available in all of them.
 */
export function pluginBrowserSessionPartition(pluginId: string): PluginBrowserSessionPartition {
  const digest = createHash('sha256').update(pluginId, 'utf8').digest('hex')
  return `persist:openforge-plugin-browser-${digest}`
}

const LEGACY_TASK_PARTITION = /^persist:openforge-task-browser-[a-f0-9]{64}$/

/**
 * Identifies legacy partitions that were scoped per Task. No surface can bind to one and no session
 * reset can reach one, so first launch purges them instead of leaving credentials on disk.
 */
export function isSupersededTaskBrowserPartition(partition: string): boolean {
  return LEGACY_TASK_PARTITION.test(partition)
}

export function isTaskBrowserUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function requestsPopupPreferenceOverride(features: string): boolean {
  return features.split(',').some(feature => {
    const [name] = feature.split('=', 1)
    return NON_CONFIGURABLE_POPUP_PREFERENCES.has(name.trim().toLowerCase())
  })
}

export const SECURE_TASK_BROWSER_POPUP_POLICY: TaskBrowserPopupPolicy = Object.freeze({
  isAllowed: ({ url, features }: TaskBrowserPopupRequest) => (
    isTaskBrowserUrlAllowed(url) && !requestsPopupPreferenceOverride(features)
  ),
})

export function isValidTaskBrowserBounds(bounds: TaskBrowserBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height]
    .every(Number.isFinite)
    && bounds.width >= 0
    && bounds.height >= 0
}

function clampTaskBrowserBounds(bounds: TaskBrowserBounds, content: TaskBrowserBounds): TaskBrowserBounds {
  const contentRight = content.x + content.width
  const contentBottom = content.y + content.height
  const left = Math.min(Math.max(bounds.x, content.x), contentRight)
  const top = Math.min(Math.max(bounds.y, content.y), contentBottom)
  const right = Math.min(Math.max(bounds.x + bounds.width, content.x), contentRight)
  const bottom = Math.min(Math.max(bounds.y + bounds.height, content.y), contentBottom)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/**
 * Renderers measure attachment bounds in CSS pixels, while the owning window positions native
 * views in device-independent pixels. The two spaces differ by the renderer zoom factor, so
 * bounds must be scaled before they are compared against the window content bounds.
 */
export function scaleTaskBrowserBounds(bounds: TaskBrowserBounds, rendererZoomFactor: number): TaskBrowserBounds {
  if (!Number.isFinite(rendererZoomFactor) || rendererZoomFactor <= 0 || rendererZoomFactor === 1) return { ...bounds }
  return {
    x: bounds.x * rendererZoomFactor,
    y: bounds.y * rendererZoomFactor,
    width: bounds.width * rendererZoomFactor,
    height: bounds.height * rendererZoomFactor,
  }
}

export function integerTaskBrowserBounds(bounds: TaskBrowserBounds): TaskBrowserBounds {
  const x = Math.round(bounds.x)
  const y = Math.round(bounds.y)
  const right = Math.round(bounds.x + bounds.width)
  const bottom = Math.round(bounds.y + bounds.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

export function constrainTaskBrowserBounds(
  bounds: TaskBrowserBounds,
  contentBounds: TaskBrowserBounds,
): TaskBrowserBounds | null {
  const constrained = integerTaskBrowserBounds(clampTaskBrowserBounds(bounds, contentBounds))
  return constrained.width === 0 || constrained.height === 0 ? null : constrained
}

export function validateTaskBrowserSurfaceIdentity(
  request: Pick<GetOrCreateTaskBrowserSurfaceRequest, 'windowId' | 'pluginId' | 'taskId' | 'id'>,
): void {
  if (!Number.isInteger(request.windowId)) {
    throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is invalid')
  }
  if (!request.taskId.trim()) {
    throw new TaskBrowserSurfaceError('INVALID_TASK', 'Task Browser Surface requires a non-empty Task ID')
  }
  if (!LOCAL_ID.test(request.pluginId) || !LOCAL_ID.test(request.id)) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Surface plugin and local ids must be valid stable identifiers')
  }
}
