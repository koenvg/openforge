import type { Disposable } from './types'

export type BrowserSurfaceErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'HOST_UNAVAILABLE'
  | 'INVALID_TASK'
  | 'PLUGIN_NOT_ENABLED'
  | 'INVALID_ID'
  | 'INVALID_URL'
  | 'INVALID_BOUNDS'
  | 'SURFACE_DESTROYED'

export class BrowserSurfaceError extends Error {
  readonly code: BrowserSurfaceErrorCode

  constructor(code: BrowserSurfaceErrorCode, message: string) {
    super(message)
    this.name = 'BrowserSurfaceError'
    this.code = code
  }
}

export interface BrowserSurfaceNavigationError {
  code: string
  message: string
  url: string
}

export interface TaskBrowserSurfaceState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: BrowserSurfaceNavigationError | null
}

export interface GetOrCreateBrowserSurfaceRequest {
  taskId: string
  id: string
  initialUrl?: string
}

export interface TaskBrowserSurfaceController {
  attach(element: HTMLElement): Promise<Disposable>
  detach(): Promise<void>
  destroy(): Promise<void>
  getState(): Promise<TaskBrowserSurfaceState>
  onStateChanged(handler: (state: TaskBrowserSurfaceState) => void): Disposable
  navigate(url: string): Promise<TaskBrowserSurfaceState>
  goBack(): Promise<TaskBrowserSurfaceState>
  goForward(): Promise<TaskBrowserSurfaceState>
  reload(): Promise<TaskBrowserSurfaceState>
  stop(): Promise<TaskBrowserSurfaceState>
}

export interface BrowserSurfacesAPI {
  getOrCreate(request: GetOrCreateBrowserSurfaceRequest): Promise<TaskBrowserSurfaceController>
  resetSession(taskId: string): Promise<void>
}

export function isAllowedBrowserSurfaceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
