import type { TaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry.js'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'

export type TaskBrowserSurfaceErrorCode =
  | 'HOST_UNAVAILABLE'
  | 'INVALID_TASK'
  | 'PLUGIN_NOT_ENABLED'
  | 'INVALID_ID'
  | 'INVALID_URL'
  | 'INVALID_BOUNDS'
  | 'SURFACE_DESTROYED'

export class TaskBrowserSurfaceError extends Error {
  readonly code: TaskBrowserSurfaceErrorCode

  constructor(code: TaskBrowserSurfaceErrorCode, message: string) {
    super(message)
    this.name = 'TaskBrowserSurfaceError'
    this.code = code
  }
}

export interface TaskBrowserNavigationError {
  code: string
  message: string
  url: string
}

export interface TaskBrowserNativeState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: TaskBrowserNavigationError | null
}

export interface TaskBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TaskBrowserWebPreferences {
  nodeIntegration: false
  contextIsolation: true
  sandbox: true
  webSecurity: true
  allowRunningInsecureContent: false
  webviewTag: false
  safeDialogs: true
  navigateOnDragDrop: false
}

export type TaskBrowserSessionPartition = `persist:${string}`

export interface TaskBrowserPopupRequest {
  url: string
  features: string
}

export interface TaskBrowserPopupPolicy {
  isAllowed(request: TaskBrowserPopupRequest): boolean
}

export interface TaskBrowserSurfaceCreateOptions {
  windowId: number
  partition: TaskBrowserSessionPartition
  webPreferences: TaskBrowserWebPreferences
  popupPolicy: TaskBrowserPopupPolicy
  permissionHandler?: TaskBrowserPermissionSessionHandler
}

export interface NativeTaskBrowserSurface {
  getState(): TaskBrowserNativeState
  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void
  loadURL(url: string): Promise<void>
  attach(windowId: number, bounds: TaskBrowserBounds): void
  detach(): void
  destroy(): void
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  stop(): void
}

export interface NativeTaskBrowserSurfaceFactory {
  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface
  clearSession(partition: TaskBrowserSessionPartition): Promise<void>
}

export interface TaskBrowserSurfaceStateEvent {
  windowId: number
  surfaceId: string
  generation: number
  state: TaskBrowserNativeState
}

export interface TaskBrowserPermissionController {
  createSessionHandler(pluginId: string, taskId: string): Promise<TaskBrowserPermissionSessionHandler>
  clearSession(pluginId: string, taskId: string): Promise<void>
}

export interface TaskBrowserSurfaceManagerOptions {
  factory: NativeTaskBrowserSurfaceFactory
  registry: TaskBrowserPartitionRegistry
  permissions: TaskBrowserPermissionController
  authorize(pluginId: string, taskId: string): Promise<void>
  onStateChanged?(event: TaskBrowserSurfaceStateEvent): void
}

export interface GetOrCreateTaskBrowserSurfaceRequest {
  windowId: number
  pluginId: string
  taskId: string
  id: string
  initialUrl?: string
}

export interface TaskBrowserSurfaceReference {
  surfaceId: string
  generation: number
  state: TaskBrowserNativeState
}
