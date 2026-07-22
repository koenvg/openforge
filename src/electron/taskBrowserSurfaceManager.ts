import { createHash } from 'node:crypto'

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

export interface TaskBrowserSurfaceCreateOptions {
  partition: string
  webPreferences: TaskBrowserWebPreferences
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
  clearSession(partition: string): Promise<void>
}

export interface TaskBrowserSurfaceStateEvent {
  windowId: number
  surfaceId: string
  generation: number
  state: TaskBrowserNativeState
}

export interface TaskBrowserSurfaceManagerOptions {
  factory: NativeTaskBrowserSurfaceFactory
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

type SurfaceRecord = {
  key: string
  surfaceId: string
  generation: number
  windowId: number
  pluginId: string
  taskId: string
  id: string
  partition: string
  attachmentId: string | null
  staleAttachmentIds: Set<string>
  requestedBounds: TaskBrowserBounds | null
  attached: boolean
  lastDetachedAt: number
  native: NativeTaskBrowserSurface
  unsubscribe: () => void
}

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function copyState(state: TaskBrowserNativeState): TaskBrowserNativeState {
  return { ...state, error: state.error ? { ...state.error } : null }
}

function liveKey(request: Pick<GetOrCreateTaskBrowserSurfaceRequest, 'windowId' | 'pluginId' | 'taskId' | 'id'>): string {
  return [request.windowId, request.pluginId, request.taskId, request.id].join('\u0000')
}

function partitionFor(pluginId: string, taskId: string): string {
  const digest = createHash('sha256').update(`${pluginId}\u0000${taskId}`).digest('hex')
  return `persist:openforge-task-browser-${digest}`
}

function allowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validBounds(bounds: TaskBrowserBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width >= 0
    && bounds.height >= 0
}

function clampBounds(bounds: TaskBrowserBounds, content: TaskBrowserBounds): TaskBrowserBounds {
  const left = Math.max(bounds.x, content.x)
  const top = Math.max(bounds.y, content.y)
  const right = Math.min(bounds.x + bounds.width, content.x + content.width)
  const bottom = Math.min(bounds.y + bounds.height, content.y + content.height)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export class TaskBrowserSurfaceManager {
  private readonly windows = new Map<number, TaskBrowserBounds>()
  private readonly surfacesByKey = new Map<string, SurfaceRecord>()
  private readonly surfacesById = new Map<string, SurfaceRecord>()
  private readonly pending = new Map<string, Promise<TaskBrowserSurfaceReference>>()
  private readonly destroyedSurfaceIds = new Set<string>()
  private readonly pluginEpochs = new Map<string, number>()
  private readonly sessionEpochs = new Map<string, number>()
  private readonly windowEpochs = new Map<number, number>()
  private surfaceSequence = 0
  private generationSequence = 0
  private lruSequence = 0
  private globalEpoch = 0

  constructor(private readonly options: TaskBrowserSurfaceManagerOptions) {}

  registerWindow(windowId: number, contentBounds: TaskBrowserBounds): void {
    if (!Number.isInteger(windowId) || !validBounds(contentBounds) || contentBounds.width <= 0 || contentBounds.height <= 0) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface requires a valid owning OpenForge window')
    }
    this.windows.set(windowId, { ...contentBounds })
  }

  updateWindowBounds(windowId: number, contentBounds: TaskBrowserBounds): void {
    if (!this.windows.has(windowId)) return
    if (!validBounds(contentBounds) || contentBounds.width <= 0 || contentBounds.height <= 0) return
    this.windows.set(windowId, { ...contentBounds })
    for (const surface of this.surfacesById.values()) {
      if (surface.windowId === windowId && surface.attachmentId && surface.requestedBounds) {
        this.attach(surface.surfaceId, surface.attachmentId, surface.requestedBounds)
      }
    }
  }

  unregisterWindow(windowId: number): void {
    this.windowEpochs.set(windowId, (this.windowEpochs.get(windowId) ?? 0) + 1)
    this.destroyWhere(surface => surface.windowId === windowId)
    this.windows.delete(windowId)
  }

  async getOrCreate(request: GetOrCreateTaskBrowserSurfaceRequest): Promise<TaskBrowserSurfaceReference> {
    this.validateIdentity(request)
    if (!this.windows.has(request.windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }

    const key = liveKey(request)
    const existing = this.surfacesByKey.get(key)
    if (existing) {
      await this.options.authorize(request.pluginId, request.taskId)
      return this.reference(existing)
    }

    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const creation = this.createSurface(request, key)
    this.pending.set(key, creation)
    try {
      return await creation
    } finally {
      if (this.pending.get(key) === creation) this.pending.delete(key)
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

  attach(surfaceId: string, attachmentId: string, bounds: TaskBrowserBounds): void {
    const surface = this.requireSurface(surfaceId)
    if (!attachmentId.trim()) throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires an id')
    if (!validBounds(bounds)) throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Attachment bounds are invalid')
    const contentBounds = this.windows.get(surface.windowId)
    if (!contentBounds) throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')

    if (surface.staleAttachmentIds.has(attachmentId)) return
    if (surface.attachmentId && surface.attachmentId !== attachmentId) {
      surface.staleAttachmentIds.add(surface.attachmentId)
    }
    surface.attachmentId = attachmentId
    surface.requestedBounds = { ...bounds }
    const clamped = clampBounds(bounds, contentBounds)
    if (clamped.width === 0 || clamped.height === 0) {
      surface.native.detach()
      surface.attached = false
      surface.lastDetachedAt = ++this.lruSequence
      this.enforceDetachedLimit(surface.windowId)
      return
    }
    surface.native.attach(surface.windowId, clamped)
    surface.attached = true
  }

  detach(surfaceId: string, attachmentId?: string): void {
    const surface = this.requireSurface(surfaceId)
    if (attachmentId !== undefined && surface.attachmentId !== attachmentId) return
    if (surface.attachmentId) surface.staleAttachmentIds.add(surface.attachmentId)
    surface.attachmentId = null
    surface.requestedBounds = null
    surface.attached = false
    surface.lastDetachedAt = ++this.lruSequence
    surface.native.detach()
    this.enforceDetachedLimit(surface.windowId)
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
    if (!allowedUrl(url)) throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) navigation')
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
    const sessionKey = this.sessionEpochKey(pluginId, taskId)
    this.sessionEpochs.set(sessionKey, (this.sessionEpochs.get(sessionKey) ?? 0) + 1)
    await this.options.authorize(pluginId, taskId)
    this.destroyWhere(surface => surface.pluginId === pluginId && surface.taskId === taskId)
    await this.options.factory.clearSession(partitionFor(pluginId, taskId))
  }

  destroyPlugin(pluginId: string): void {
    this.pluginEpochs.set(pluginId, (this.pluginEpochs.get(pluginId) ?? 0) + 1)
    this.destroyWhere(surface => surface.pluginId === pluginId)
  }

  destroyAll(): void {
    this.globalEpoch += 1
    this.destroyWhere(() => true)
  }

  private async createSurface(request: GetOrCreateTaskBrowserSurfaceRequest, key: string): Promise<TaskBrowserSurfaceReference> {
    if (request.initialUrl !== undefined && !allowedUrl(request.initialUrl)) {
      throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) initial URLs')
    }
    const sessionKey = this.sessionEpochKey(request.pluginId, request.taskId)
    const lifecycleEpoch = {
      global: this.globalEpoch,
      plugin: this.pluginEpochs.get(request.pluginId) ?? 0,
      session: this.sessionEpochs.get(sessionKey) ?? 0,
      window: this.windowEpochs.get(request.windowId) ?? 0,
    }
    await this.options.authorize(request.pluginId, request.taskId)
    if (
      lifecycleEpoch.global !== this.globalEpoch
      || lifecycleEpoch.plugin !== (this.pluginEpochs.get(request.pluginId) ?? 0)
      || lifecycleEpoch.session !== (this.sessionEpochs.get(sessionKey) ?? 0)
      || lifecycleEpoch.window !== (this.windowEpochs.get(request.windowId) ?? 0)
    ) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }
    if (!this.windows.has(request.windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }

    const partition = partitionFor(request.pluginId, request.taskId)
    const native = this.options.factory.createSurface({
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
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
      staleAttachmentIds: new Set(),
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

  private sessionEpochKey(pluginId: string, taskId: string): string {
    return `${pluginId}\u0000${taskId}`
  }

  private validateIdentity(request: GetOrCreateTaskBrowserSurfaceRequest): void {
    if (!Number.isInteger(request.windowId)) throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is invalid')
    if (!request.taskId.trim()) throw new TaskBrowserSurfaceError('INVALID_TASK', 'Task Browser Surface requires a non-empty Task ID')
    if (!LOCAL_ID.test(request.pluginId) || !LOCAL_ID.test(request.id)) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Surface plugin and local ids must be valid stable identifiers')
    }
  }

  private requireSurface(surfaceId: string): SurfaceRecord {
    const surface = this.surfacesById.get(surfaceId)
    if (!surface) {
      const detail = this.destroyedSurfaceIds.has(surfaceId) ? 'has been destroyed' : 'is unavailable'
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', `Task Browser Surface ${detail}`)
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

  private destroyRecord(surface: SurfaceRecord): void {
    if (this.surfacesById.get(surface.surfaceId) !== surface) return
    this.surfacesById.delete(surface.surfaceId)
    this.surfacesByKey.delete(surface.key)
    this.destroyedSurfaceIds.add(surface.surfaceId)
    surface.unsubscribe()
    surface.native.detach()
    surface.native.destroy()
  }
}
