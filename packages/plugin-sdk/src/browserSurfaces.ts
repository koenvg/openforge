import type { Disposable } from './types'

export type BrowserSurfaceErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'HOST_UNAVAILABLE'
  | 'INVALID_TASK'
  | 'PLUGIN_NOT_ENABLED'
  | 'INVALID_ID'
  | 'INVALID_URL'
  | 'INVALID_BOUNDS'
  | 'CAPTURE_UNAVAILABLE'
  | 'CAPTURE_FAILED'
  | 'SURFACE_ACCESS_DENIED'
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

export interface BrowserSurfaceCapture {
  artifactId: string
  mediaType: 'image/png'
  width: number
  height: number
  dataUrl: string
}

export interface GetOrCreateBrowserSurfaceRequest {
  taskId: string
  id: string
  initialUrl?: string
}

export interface BrowserSurfaceRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserSurfaceFeedbackSelection {
  region: BrowserSurfaceRegion
  comment: string
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
  selectVisibleRegion(): Promise<BrowserSurfaceFeedbackSelection | null>
  cancelVisibleRegionSelection(): Promise<void>
  captureVisibleViewport(): Promise<BrowserSurfaceCapture>
  discardCapture(artifactId: string): Promise<void>
}

export interface BrowserSurfacesAPI {
  getOrCreate(request: GetOrCreateBrowserSurfaceRequest): Promise<TaskBrowserSurfaceController>
  resetSession(): Promise<void>
}

export function isAllowedBrowserSurfaceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
