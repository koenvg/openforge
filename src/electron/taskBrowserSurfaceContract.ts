import type { TaskBrowserCaptureArtifactStore } from './taskBrowserCaptureArtifactStore.js'
import type { TaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry.js'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'

export type TaskBrowserSurfaceErrorCode =
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

export type TaskBrowserDevToolsPanel = 'elements' | 'console'

export interface TaskBrowserNativeState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  devToolsOpen: boolean
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

export type PluginBrowserSessionPartition = `persist:${string}`

export interface TaskBrowserPopupRequest {
  url: string
  features: string
}

export interface TaskBrowserPopupPolicy {
  isAllowed(request: TaskBrowserPopupRequest): boolean
}

export interface TaskBrowserSurfaceCreateOptions {
  windowId: number
  partition: PluginBrowserSessionPartition
  webPreferences: TaskBrowserWebPreferences
  popupPolicy: TaskBrowserPopupPolicy
  permissionHandler?: TaskBrowserPermissionSessionHandler
}

export interface TaskBrowserSurfaceRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface TaskBrowserSurfaceVisualFeedback {
  annotationNumber: number
  url: string
  region: TaskBrowserSurfaceRegion
  comment: string
}

export type TaskBrowserVisualFeedbackAppearance = 'light' | 'dark'

export interface TaskBrowserVisualFeedbackPresentation {
  appearance: TaskBrowserVisualFeedbackAppearance
}
export interface TaskBrowserDeleteAnnotationAction {
  type: 'delete-annotation'
  annotationNumber: number
}

export type TaskBrowserVisualFeedbackAction = TaskBrowserDeleteAnnotationAction


export interface TaskBrowserSurfaceFeedbackSelection {
  region: TaskBrowserSurfaceRegion
  comment: string
  annotationNumber: number
}
export interface TaskBrowserNativeCapture {
  png: Uint8Array
  width: number
  height: number
}

export interface NativeTaskBrowserSurface {
  getState(): TaskBrowserNativeState
  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void
  onVisualFeedbackAction(listener: (action: TaskBrowserVisualFeedbackAction) => void): () => void
  loadURL(url: string): Promise<void>
  attach(windowId: number, bounds: TaskBrowserBounds): void
  detach(): void
  destroy(): void
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  stop(): void
  openDevTools(panel?: TaskBrowserDevToolsPanel): Promise<void>
  closeDevTools(): Promise<void>
  selectVisibleRegion(): Promise<TaskBrowserSurfaceFeedbackSelection | null>
  cancelVisibleRegionSelection(): Promise<void>
  clearVisualFeedback(): Promise<void>
  replaceVisualFeedback(
    feedback: readonly TaskBrowserSurfaceVisualFeedback[],
    presentation?: TaskBrowserVisualFeedbackPresentation,
  ): Promise<void>
  captureVisibleViewport(): Promise<TaskBrowserNativeCapture>
}

export interface NativeTaskBrowserSurfaceFactory {
  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface
  clearSession(partition: PluginBrowserSessionPartition): Promise<void>
}

export interface TaskBrowserSurfaceStateEvent {
  windowId: number
  surfaceId: string
  generation: number
  state: TaskBrowserNativeState
}

export interface TaskBrowserSurfaceVisualFeedbackActionEvent {
  windowId: number
  surfaceId: string
  generation: number
  action: TaskBrowserVisualFeedbackAction
}

export interface TaskBrowserPermissionController {
  createSessionHandler(pluginId: string): Promise<TaskBrowserPermissionSessionHandler>
  clearSession(pluginId: string): Promise<void>
}

export interface TaskBrowserSurfaceManagerOptions {
  factory: NativeTaskBrowserSurfaceFactory
  registry: TaskBrowserPartitionRegistry
  permissions: TaskBrowserPermissionController
  artifacts: TaskBrowserCaptureArtifactStore
  authorize(pluginId: string, taskId: string): Promise<void>
  /** Authorizes a plugin-wide operation that names no Task, such as a session reset. */
  authorizePlugin(pluginId: string): Promise<void>
  onStateChanged?(event: TaskBrowserSurfaceStateEvent): void
  onVisualFeedbackAction?(event: TaskBrowserSurfaceVisualFeedbackActionEvent): void
  /**
   * Current zoom factor of the window's renderer, used to convert the CSS pixel attachment bounds
   * it reports into the device-independent pixels the window positions native views with.
   * Defaults to an unzoomed renderer.
   */
  rendererZoomFactor?(windowId: number): number
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

export interface TaskBrowserSurfaceCaptureRequest {
  windowId: number
  pluginId: string
  taskId: string
  surfaceId: string
  generation: number
}

export interface TaskBrowserSurfaceCapture {
  artifactId: string
  absolutePath: string
  mediaType: 'image/png'
  width: number
  height: number
  url: string
  title: string
  capturedAt: string
  dataUrl: string
}
