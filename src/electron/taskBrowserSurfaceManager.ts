import type { TaskBrowserPartitionRegistration } from './taskBrowserPartitionRegistry.js'
import {
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceContract.js'
import type {
  GetOrCreateTaskBrowserSurfaceRequest,
  NativeTaskBrowserSurface,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserSessionPartition,
  TaskBrowserSurfaceManagerOptions,
  TaskBrowserSurfaceReference,
} from './taskBrowserSurfaceContract.js'
import { TaskBrowserSurfaceLifecycle } from './taskBrowserSurfaceLifecycle.js'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  constrainTaskBrowserBounds,
  isTaskBrowserUrlAllowed,
  isValidTaskBrowserBounds,
  taskBrowserSessionPartition,
  validateTaskBrowserSurfaceIdentity,
} from './taskBrowserSurfacePolicy.js'

export { TaskBrowserSurfaceError } from './taskBrowserSurfaceContract.js'
export type {
  GetOrCreateTaskBrowserSurfaceRequest,
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNavigationError,
  TaskBrowserNativeState,
  TaskBrowserPermissionController,
  TaskBrowserPopupPolicy,
  TaskBrowserPopupRequest,
  TaskBrowserSessionPartition,
  TaskBrowserSurfaceCreateOptions,
  TaskBrowserSurfaceErrorCode,
  TaskBrowserSurfaceManagerOptions,
  TaskBrowserSurfaceReference,
  TaskBrowserSurfaceStateEvent,
  TaskBrowserWebPreferences,
} from './taskBrowserSurfaceContract.js'
export {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  integerTaskBrowserBounds,
  taskBrowserSessionPartition,
} from './taskBrowserSurfacePolicy.js'

type SurfaceRecord = {
  key: string
  surfaceId: string
  generation: number
  windowId: number
  pluginId: string
  taskId: string
  id: string
  partition: TaskBrowserSessionPartition
  attachmentId: string | null
  attachmentGeneration: number
  requestedBounds: TaskBrowserBounds | null
  attached: boolean
  lastDetachedAt: number
  native: NativeTaskBrowserSurface
  unsubscribe: () => void
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
      if (surface.windowId === windowId && surface.attachmentId && surface.requestedBounds) {
        this.attach(
          surface.surfaceId,
          surface.attachmentId,
          surface.attachmentGeneration,
          surface.requestedBounds,
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
    let observedSessionEpoch = this.lifecycle.currentSessionEpoch(request.pluginId, request.taskId)
    while (true) {
      await this.lifecycle.waitForSessionReset(request.pluginId, request.taskId)
      const currentSessionEpoch = this.lifecycle.currentSessionEpoch(request.pluginId, request.taskId)
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
      if (this.lifecycle.currentSessionEpoch(request.pluginId, request.taskId) !== observedSessionEpoch) {
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

  attach(
    surfaceId: string,
    attachmentId: string,
    attachmentGeneration: number,
    bounds: TaskBrowserBounds | null,
  ): void {
    const surface = this.requireSurface(surfaceId)
    if (!attachmentId.trim()) throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires an id')
    if (!Number.isSafeInteger(attachmentGeneration) || attachmentGeneration <= 0) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires a valid generation')
    }
    if (bounds !== null && !isValidTaskBrowserBounds(bounds)) {
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
    surface.requestedBounds = bounds === null ? null : { ...bounds }
    if (bounds === null) {
      this.retainDetached(surface, replacesAttachment)
      return
    }

    const clamped = constrainTaskBrowserBounds(bounds, contentBounds)
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
    surface.requestedBounds = null
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

  async resetSession(pluginId: string, taskId: string): Promise<void> {
    if (!taskId.trim()) throw new TaskBrowserSurfaceError('INVALID_TASK', 'Task Browser Session reset requires a Task ID')
    await this.clearBrowserSession(
      { pluginId, taskId, partition: taskBrowserSessionPartition(pluginId, taskId) },
      true,
    )
  }

  async purgeRegisteredSession(record: TaskBrowserPartitionRegistration): Promise<void> {
    if (!record.pluginId.trim() || !record.taskId.trim() || !record.partition.startsWith('persist:')) {
      throw new Error('Task Browser Session purge requires a valid durable partition registration')
    }
    await this.clearBrowserSession(record, false)
  }

  destroyTask(taskId: string): void {
    if (!taskId.trim()) return
    this.lifecycle.invalidateTask(taskId)
    this.destroyWhere(surface => surface.taskId === taskId)
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

    const permissionHandler = await this.options.permissions.createSessionHandler(request.pluginId, request.taskId)
    if (!this.lifecycle.isCurrent(request, lifecycleEpoch)) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }

    const partition = taskBrowserSessionPartition(request.pluginId, request.taskId)
    await this.options.registry.register({
      pluginId: request.pluginId,
      taskId: request.taskId,
      partition,
    })
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
      requestedBounds: null,
      attached: false,
      lastDetachedAt: ++this.lruSequence,
      native,
      unsubscribe: () => undefined,
    }

    record.unsubscribe = native.onStateChanged(state => {
      if (this.surfacesById.get(surfaceId)?.generation !== generation) return
      this.options.onStateChanged?.({ windowId: request.windowId, surfaceId, generation, state: copyState(state) })
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
    await this.lifecycle.runSessionReset(record.pluginId, record.taskId, async () => {
      if (authorize) await this.options.authorize(record.pluginId, record.taskId)
      this.destroyWhere(surface => surface.pluginId === record.pluginId && surface.taskId === record.taskId)
      const cleanupResults = await Promise.allSettled([
        this.options.factory.clearSession(record.partition),
        this.options.permissions.clearSession(record.pluginId, record.taskId),
      ])
      const failure = cleanupResults.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })
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
    surface.native.detach()
    surface.native.destroy()
  }
}
