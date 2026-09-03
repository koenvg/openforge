import type { TaskBrowserPartitionRegistration } from './taskBrowserPartitionRegistry.js'
import {
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceContract.js'
import type {
  GetOrCreateTaskBrowserSurfaceRequest,
  NativeTaskBrowserSurface,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserDevToolsPanel,
  PluginBrowserSessionPartition,
  TaskBrowserSurfaceManagerOptions,
  TaskBrowserSurfaceCapture,
  TaskBrowserSurfaceCaptureRequest,
  TaskBrowserSurfaceVisualFeedback,
  TaskBrowserVisualFeedbackPresentation,
  TaskBrowserSurfaceReference,
} from './taskBrowserSurfaceContract.js'
import { TaskBrowserSurfaceLifecycle } from './taskBrowserSurfaceLifecycle.js'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  constrainTaskBrowserBounds,
  isTaskBrowserUrlAllowed,
  isValidTaskBrowserBounds,
  pluginBrowserSessionPartition,
  scaleTaskBrowserBounds,
  validateTaskBrowserSurfaceIdentity,
} from './taskBrowserSurfacePolicy.js'

export { TaskBrowserSurfaceError } from './taskBrowserSurfaceContract.js'
export type {
  GetOrCreateTaskBrowserSurfaceRequest,
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserDevToolsPanel,
  TaskBrowserNavigationError,
  TaskBrowserNativeState,
  TaskBrowserPermissionController,
  TaskBrowserPopupPolicy,
  TaskBrowserPopupRequest,
  PluginBrowserSessionPartition,
  TaskBrowserSurfaceCreateOptions,
  TaskBrowserSurfaceErrorCode,
  TaskBrowserSurfaceManagerOptions,
  TaskBrowserSurfaceReference,
  TaskBrowserSurfaceVisualFeedback,
  TaskBrowserVisualFeedbackAction,
  TaskBrowserSurfaceVisualFeedbackActionEvent,
  TaskBrowserVisualFeedbackPresentation,
  TaskBrowserSurfaceStateEvent,
  TaskBrowserWebPreferences,
} from './taskBrowserSurfaceContract.js'
export {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  integerTaskBrowserBounds,
  pluginBrowserSessionPartition,
} from './taskBrowserSurfacePolicy.js'

type SurfaceRecord = {
  key: string
  surfaceId: string
  generation: number
  windowId: number
  pluginId: string
  taskId: string
  id: string
  partition: PluginBrowserSessionPartition
  attachmentId: string | null
  attachmentGeneration: number
  /** Last bounds reported by the renderer, kept in its CSS pixel space so replays re-read the zoom factor. */
  requestedRendererBounds: TaskBrowserBounds | null
  attached: boolean
  lastDetachedAt: number
  native: NativeTaskBrowserSurface
  unsubscribe: () => void
  unsubscribeAction: () => void
}

type PendingSurfaceCreation = {
  promise: Promise<TaskBrowserSurfaceReference>
  sessionEpoch: number
}

function copyState(state: TaskBrowserNativeState): TaskBrowserNativeState {
  return { ...state, error: state.error ? { ...state.error } : null }
}

function liveKey(request: Pick<GetOrCreateTaskBrowserSurfaceRequest, 'windowId' | 'pluginId' | 'taskId' | 'id'>): string {
  return [request.windowId, request.pluginId, request.taskId, request.id].join('\u0000')
}

export class TaskBrowserSurfaceManager {
  private readonly windows = new Map<number, TaskBrowserBounds>()
  private readonly surfacesByKey = new Map<string, SurfaceRecord>()
  private readonly surfacesById = new Map<string, SurfaceRecord>()
  private readonly pending = new Map<string, PendingSurfaceCreation>()
  private readonly lifecycle = new TaskBrowserSurfaceLifecycle()
  private surfaceSequence = 0
  private generationSequence = 0
  private lruSequence = 0

  constructor(private readonly options: TaskBrowserSurfaceManagerOptions) {}

  registerWindow(windowId: number, contentBounds: TaskBrowserBounds): void {
    if (!Number.isInteger(windowId) || !isValidTaskBrowserBounds(contentBounds) || contentBounds.width <= 0 || contentBounds.height <= 0) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface requires a valid owning OpenForge window')
    }
    this.windows.set(windowId, { ...contentBounds })
  }

  updateWindowBounds(windowId: number, contentBounds: TaskBrowserBounds): void {
    if (!this.windows.has(windowId)) return
    if (!isValidTaskBrowserBounds(contentBounds) || contentBounds.width <= 0 || contentBounds.height <= 0) return
    this.windows.set(windowId, { ...contentBounds })
    for (const surface of this.surfacesById.values()) {
      if (surface.windowId === windowId && surface.attachmentId && surface.requestedRendererBounds) {
        this.attach(
          surface.surfaceId,
          surface.attachmentId,
          surface.attachmentGeneration,
          surface.requestedRendererBounds,
        )
      }
    }
  }

  unregisterWindow(windowId: number): void {
    this.lifecycle.invalidateWindow(windowId)
    this.destroyWhere(surface => surface.windowId === windowId)
    this.windows.delete(windowId)
  }

  async getOrCreate(request: GetOrCreateTaskBrowserSurfaceRequest): Promise<TaskBrowserSurfaceReference> {
    validateTaskBrowserSurfaceIdentity(request)
    let observedSessionEpoch = this.lifecycle.currentSessionEpoch(request.pluginId)
    while (true) {
      await this.lifecycle.waitForSessionReset(request.pluginId)
      const currentSessionEpoch = this.lifecycle.currentSessionEpoch(request.pluginId)
      if (currentSessionEpoch === observedSessionEpoch) break
      observedSessionEpoch = currentSessionEpoch
    }
    if (!this.windows.has(request.windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }

    const key = liveKey(request)
    const inFlight = this.pending.get(key)
    if (inFlight?.sessionEpoch === observedSessionEpoch) return inFlight.promise

    const existing = this.surfacesByKey.get(key)
    if (existing) {
      await this.options.authorize(request.pluginId, request.taskId)
      if (this.lifecycle.currentSessionEpoch(request.pluginId) !== observedSessionEpoch) {
        return this.getOrCreate(request)
      }
      if (this.surfacesByKey.get(key) !== existing) {
        throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface was superseded during authorization')
      }
      return this.reference(existing)
    }

    const creation = this.createSurface(request, key)
    this.pending.set(key, { promise: creation, sessionEpoch: observedSessionEpoch })
    try {
      return await creation
    } finally {
      if (this.pending.get(key)?.promise === creation) this.pending.delete(key)
    }
  }

  assertWindowRegistered(windowId: number): void {
    if (!this.windows.has(windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }
  }

  assertWindowOwnsSurface(surfaceId: string, windowId: number): void {
    if (this.requireSurface(surfaceId).windowId !== windowId) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface belongs to another OpenForge window')
    }
  }

  /** `rendererBounds` are CSS pixels as measured by the owning window's renderer. */
  attach(
    surfaceId: string,
    attachmentId: string,
    attachmentGeneration: number,
    rendererBounds: TaskBrowserBounds | null,
  ): void {
    const surface = this.requireSurface(surfaceId)
    if (!attachmentId.trim()) throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires an id')
    if (!Number.isSafeInteger(attachmentGeneration) || attachmentGeneration <= 0) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires a valid generation')
    }
    if (rendererBounds !== null && !isValidTaskBrowserBounds(rendererBounds)) {
      throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Attachment bounds are invalid')
    }
    const contentBounds = this.windows.get(surface.windowId)
    if (!contentBounds) throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')

    if (attachmentGeneration < surface.attachmentGeneration) return
    const replacesAttachment = attachmentGeneration > surface.attachmentGeneration
    if (!replacesAttachment && surface.attachmentId !== attachmentId) return

    if (replacesAttachment) {
      surface.attachmentId = attachmentId
      surface.attachmentGeneration = attachmentGeneration
    }
    surface.requestedRendererBounds = rendererBounds === null ? null : { ...rendererBounds }
    if (rendererBounds === null) {
      this.retainDetached(surface, replacesAttachment)
      return
    }

    const clamped = constrainTaskBrowserBounds(
      scaleTaskBrowserBounds(rendererBounds, this.options.rendererZoomFactor?.(surface.windowId) ?? 1),
      contentBounds,
    )
    if (clamped === null) {
      this.retainDetached(surface, replacesAttachment)
      return
    }
    surface.native.attach(surface.windowId, clamped)
    surface.attached = true
  }

  detach(surfaceId: string, attachmentId?: string, attachmentGeneration?: number): void {
    const surface = this.requireSurface(surfaceId)
    if (attachmentId !== undefined) {
      if (attachmentGeneration === undefined) {
        throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment disposal requires its generation')
      }
      if (surface.attachmentId !== attachmentId || surface.attachmentGeneration !== attachmentGeneration) return
    }
    surface.attachmentId = null
    surface.requestedRendererBounds = null
    this.retainDetached(surface, true)
  }

  async destroy(surfaceId: string): Promise<void> {
    const surface = this.surfacesById.get(surfaceId)
    if (!surface) return
    this.destroyRecord(surface)
  }

  async getState(surfaceId: string): Promise<TaskBrowserNativeState> {
    return copyState(this.requireSurface(surfaceId).native.getState())
  }

  async navigate(surfaceId: string, url: string): Promise<TaskBrowserNativeState> {
    if (!isTaskBrowserUrlAllowed(url)) throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) navigation')
    const surface = this.requireSurface(surfaceId)
    await surface.native.loadURL(url)
    return copyState(surface.native.getState())
  }

  async goBack(surfaceId: string): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    if (surface.native.getState().canGoBack) await surface.native.goBack()
    return copyState(surface.native.getState())
  }

  async goForward(surfaceId: string): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    if (surface.native.getState().canGoForward) await surface.native.goForward()
    return copyState(surface.native.getState())
  }

  async reload(surfaceId: string): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    await surface.native.reload()
    return copyState(surface.native.getState())
  }

  async stop(surfaceId: string): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    surface.native.stop()
    return copyState(surface.native.getState())
  }

  async openDevTools(
    surfaceId: string,
    panel?: TaskBrowserDevToolsPanel,
  ): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    await surface.native.openDevTools(panel)
    return copyState(surface.native.getState())
  }

  async closeDevTools(surfaceId: string): Promise<TaskBrowserNativeState> {
    const surface = this.requireSurface(surfaceId)
    await surface.native.closeDevTools()
    return copyState(surface.native.getState())
  }

  async selectVisibleRegion(request: TaskBrowserSurfaceCaptureRequest) {
    const surface = this.requireCaptureSurface(request)
    if (!surface.attached) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before selecting feedback')
    }
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    const selection = await surface.native.selectVisibleRegion()
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    return selection
  }

  async cancelVisibleRegionSelection(request: TaskBrowserSurfaceCaptureRequest): Promise<void> {
    const surface = this.requireCaptureSurface(request)
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    await surface.native.cancelVisibleRegionSelection()
    this.assertCaptureSurfaceCurrent(surface, request.generation)
  }

  async clearVisualFeedback(request: TaskBrowserSurfaceCaptureRequest): Promise<void> {
    const surface = this.requireCaptureSurface(request)
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    await surface.native.clearVisualFeedback()
    this.assertCaptureSurfaceCurrent(surface, request.generation)
  }

  async replaceVisualFeedback(
    request: TaskBrowserSurfaceCaptureRequest,
    feedback: readonly TaskBrowserSurfaceVisualFeedback[],
    presentation?: TaskBrowserVisualFeedbackPresentation,
  ): Promise<void> {
    const surface = this.requireCaptureSurface(request)
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    await surface.native.replaceVisualFeedback(feedback, presentation)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
  }

  async captureVisibleViewport(request: TaskBrowserSurfaceCaptureRequest): Promise<TaskBrowserSurfaceCapture> {
    const surface = this.requireCaptureSurface(request)
    if (!surface.attached) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before it can be captured')
    }

    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    const capturedAt = new Date().toISOString()
    const capturedState = surface.native.getState()
    const nativeCapture = await surface.native.captureVisibleViewport()
    this.assertCaptureSurfaceCurrent(surface, request.generation)

    const stored = await this.options.artifacts.store({
      pluginId: request.pluginId,
      taskId: request.taskId,
      png: nativeCapture.png,
    })
    try {
      this.assertCaptureSurfaceCurrent(surface, request.generation)
    } catch (error) {
      await this.options.artifacts.discard({
        pluginId: request.pluginId,
        taskId: request.taskId,
        artifactId: stored.artifactId,
      }).catch(() => undefined)
      throw error
    }

    return {
      artifactId: stored.artifactId,
      absolutePath: stored.absolutePath,
      mediaType: 'image/png',
      width: nativeCapture.width,
      height: nativeCapture.height,
      url: capturedState.url,
      title: capturedState.title,
      capturedAt,
      dataUrl: `data:image/png;base64,${Buffer.from(nativeCapture.png).toString('base64')}`,
    }
  }

  async discardCapture(request: TaskBrowserSurfaceCaptureRequest & { artifactId: string }): Promise<void> {
    const surface = this.requireCaptureSurface(request)
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    await this.options.artifacts.discard({
      pluginId: request.pluginId,
      taskId: request.taskId,
      artifactId: request.artifactId,
    })
  }
  async captureExists(request: TaskBrowserSurfaceCaptureRequest & { artifactId: string }): Promise<boolean> {
    const surface = this.requireCaptureSurface(request)
    await this.options.authorize(request.pluginId, request.taskId)
    this.assertCaptureSurfaceCurrent(surface, request.generation)
    return this.options.artifacts.exists({
      pluginId: request.pluginId,
      taskId: request.taskId,
      artifactId: request.artifactId,
    })
  }

  /**
   * Blast radius is the whole plugin: every Task loses its login because every Task shares one
   * Plugin Browser Session.
   */
  async resetSession(pluginId: string): Promise<void> {
    if (!pluginId.trim()) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Plugin Browser Session reset requires a plugin ID')
    }
    await this.clearBrowserSession(
      { pluginId, partition: pluginBrowserSessionPartition(pluginId) },
      true,
    )
  }

  async purgeRegisteredSession(record: TaskBrowserPartitionRegistration): Promise<void> {
    if (!record.pluginId.trim() || !record.partition.startsWith('persist:')) {
      throw new Error('Plugin Browser Session purge requires a valid durable partition registration')
    }
    await this.clearBrowserSession(record, false)
  }

  destroyTask(taskId: string): void {
    if (!taskId.trim()) return
    this.lifecycle.invalidateTask(taskId)
    this.destroyWhere(surface => surface.taskId === taskId)
    void this.options.artifacts.cleanupTask(taskId).catch(() => undefined)
  }

  destroyPlugin(pluginId: string): void {
    this.lifecycle.invalidatePlugin(pluginId)
    this.destroyWhere(surface => surface.pluginId === pluginId)
  }

  destroyAll(): void {
    this.lifecycle.invalidateAll()
    this.destroyWhere(() => true)
  }

  private async createSurface(request: GetOrCreateTaskBrowserSurfaceRequest, key: string): Promise<TaskBrowserSurfaceReference> {
    if (request.initialUrl !== undefined && !isTaskBrowserUrlAllowed(request.initialUrl)) {
      throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) initial URLs')
    }
    const lifecycleEpoch = this.lifecycle.capture(request)
    await this.options.authorize(request.pluginId, request.taskId)
    if (!this.lifecycle.isCurrent(request, lifecycleEpoch)) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }
    if (!this.windows.has(request.windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }

    const permissionHandler = await this.options.permissions.createSessionHandler(request.pluginId)
    if (!this.lifecycle.isCurrent(request, lifecycleEpoch)) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }

    const partition = pluginBrowserSessionPartition(request.pluginId)
    await this.options.registry.register({ pluginId: request.pluginId, partition })
    if (!this.lifecycle.isCurrent(request, lifecycleEpoch)) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }
    const native = this.options.factory.createSurface({
      windowId: request.windowId,
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
      permissionHandler,
    })
    const surfaceId = `task-browser-surface-${++this.surfaceSequence}`
    const generation = ++this.generationSequence
    const record: SurfaceRecord = {
      key,
      surfaceId,
      generation,
      windowId: request.windowId,
      pluginId: request.pluginId,
      taskId: request.taskId,
      id: request.id,
      partition,
      attachmentId: null,
      attachmentGeneration: 0,
      requestedRendererBounds: null,
      attached: false,
      lastDetachedAt: ++this.lruSequence,
      native,
      unsubscribe: () => undefined,
      unsubscribeAction: () => undefined,
    }

    record.unsubscribe = native.onStateChanged(state => {
      if (this.surfacesById.get(surfaceId)?.generation !== generation) return
      this.options.onStateChanged?.({ windowId: request.windowId, surfaceId, generation, state: copyState(state) })
    })
    record.unsubscribeAction = native.onVisualFeedbackAction(action => {
      if (this.surfacesById.get(surfaceId)?.generation !== generation) return
      this.options.onVisualFeedbackAction?.({
        windowId: request.windowId,
        surfaceId,
        generation,
        action: { ...action },
      })
    })
    this.surfacesByKey.set(key, record)
    this.surfacesById.set(surfaceId, record)
    this.enforceDetachedLimit(request.windowId)

    try {
      if (request.initialUrl !== undefined) await native.loadURL(request.initialUrl)
      if (this.surfacesById.get(surfaceId) !== record) {
        throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
      }
      return this.reference(record)
    } catch (error) {
      this.destroyRecord(record)
      throw error
    }
  }
  private async clearBrowserSession(
    record: TaskBrowserPartitionRegistration,
    authorize: boolean,
  ): Promise<void> {
    await this.lifecycle.runSessionReset(record.pluginId, async () => {
      if (authorize) await this.options.authorizePlugin(record.pluginId)
      this.destroyWhere(surface => surface.pluginId === record.pluginId)
      const cleanupResults = await Promise.allSettled([
        this.options.factory.clearSession(record.partition),
        this.options.permissions.clearSession(record.pluginId),
      ])
      const failure = cleanupResults.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })
  }

  private requireCaptureSurface(request: TaskBrowserSurfaceCaptureRequest): SurfaceRecord {
    const surface = this.requireSurface(request.surfaceId)
    if (surface.generation !== request.generation) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface generation has been superseded')
    }
    if (
      surface.windowId !== request.windowId
      || surface.pluginId !== request.pluginId
      || surface.taskId !== request.taskId
    ) {
      throw new TaskBrowserSurfaceError('SURFACE_ACCESS_DENIED', 'Task Browser capture does not belong to this window, plugin, and Task')
    }
    return surface
  }

  private assertCaptureSurfaceCurrent(surface: SurfaceRecord, generation: number): void {
    if (this.surfacesById.get(surface.surfaceId) !== surface || surface.generation !== generation) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface capture was superseded by lifecycle cleanup')
    }
  }

  private requireSurface(surfaceId: string): SurfaceRecord {
    const surface = this.surfacesById.get(surfaceId)
    if (!surface) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed or evicted')
    }
    return surface
  }

  private reference(surface: SurfaceRecord): TaskBrowserSurfaceReference {
    return {
      surfaceId: surface.surfaceId,
      generation: surface.generation,
      state: copyState(surface.native.getState()),
    }
  }

  private enforceDetachedLimit(windowId: number): void {
    const detached = Array.from(this.surfacesById.values())
      .filter(surface => surface.windowId === windowId && !surface.attached)
      .sort((left, right) => left.lastDetachedAt - right.lastDetachedAt)
    while (detached.length > 4) {
      const evicted = detached.shift()
      if (evicted) this.destroyRecord(evicted)
    }
  }

  private destroyWhere(predicate: (surface: SurfaceRecord) => boolean): void {
    for (const surface of Array.from(this.surfacesById.values())) {
      if (predicate(surface)) this.destroyRecord(surface)
    }
  }
  private retainDetached(surface: SurfaceRecord, refreshRecency: boolean): void {
    const wasAttached = surface.attached
    surface.attached = false
    surface.native.detach()
    if (wasAttached || refreshRecency) surface.lastDetachedAt = ++this.lruSequence
    this.enforceDetachedLimit(surface.windowId)
  }

  private destroyRecord(surface: SurfaceRecord): void {
    if (this.surfacesById.get(surface.surfaceId) !== surface) return
    this.surfacesById.delete(surface.surfaceId)
    this.surfacesByKey.delete(surface.key)
    surface.unsubscribe()
    surface.unsubscribeAction()
    surface.native.detach()
    surface.native.destroy()
  }
}
