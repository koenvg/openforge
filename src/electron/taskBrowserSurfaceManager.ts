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

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function copyState(state: TaskBrowserNativeState): TaskBrowserNativeState {
  return { ...state, error: state.error ? { ...state.error } : null }
}

function liveKey(request: Pick<GetOrCreateTaskBrowserSurfaceRequest, 'windowId' | 'pluginId' | 'taskId' | 'id'>): string {
  return [request.windowId, request.pluginId, request.taskId, request.id].join('\u0000')
}

export function taskBrowserSessionPartition(pluginId: string, taskId: string): TaskBrowserSessionPartition {
  const digest = createHash('sha256').update(`${pluginId}\u0000${taskId}`, 'utf8').digest('hex')
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

function requestsPopupPreferenceOverride(features: string): boolean {
  return features.split(',').some(feature => {
    const [name] = feature.split('=', 1)
    return NON_CONFIGURABLE_POPUP_PREFERENCES.has(name.trim().toLowerCase())
  })
}

export const SECURE_TASK_BROWSER_POPUP_POLICY: TaskBrowserPopupPolicy = Object.freeze({
  isAllowed: ({ url, features }: TaskBrowserPopupRequest) => (
    allowedUrl(url) && !requestsPopupPreferenceOverride(features)
  ),
})

function validBounds(bounds: TaskBrowserBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height]
    .every(Number.isFinite)
    && bounds.width >= 0
    && bounds.height >= 0
}

function clampBounds(bounds: TaskBrowserBounds, content: TaskBrowserBounds): TaskBrowserBounds {
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

export class TaskBrowserSurfaceManager {
  private readonly windows = new Map<number, TaskBrowserBounds>()
  private readonly surfacesByKey = new Map<string, SurfaceRecord>()
  private readonly surfacesById = new Map<string, SurfaceRecord>()
  private readonly pending = new Map<string, PendingSurfaceCreation>()
  private readonly sessionResets = new Map<string, Promise<void>>()
  private readonly pluginEpochs = new Map<string, number>()
  private readonly taskEpochs = new Map<string, number>()
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
    this.windowEpochs.set(windowId, (this.windowEpochs.get(windowId) ?? 0) + 1)
    this.destroyWhere(surface => surface.windowId === windowId)
    this.windows.delete(windowId)
  }

  async getOrCreate(request: GetOrCreateTaskBrowserSurfaceRequest): Promise<TaskBrowserSurfaceReference> {
    this.validateIdentity(request)
    const sessionKey = this.sessionEpochKey(request.pluginId, request.taskId)
    let observedSessionEpoch = this.sessionEpochs.get(sessionKey) ?? 0
    while (true) {
      await this.waitForSessionReset(request.pluginId, request.taskId)
      const currentSessionEpoch = this.sessionEpochs.get(sessionKey) ?? 0
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
      if ((this.sessionEpochs.get(sessionKey) ?? 0) !== observedSessionEpoch) {
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
    if (bounds !== null && !validBounds(bounds)) {
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

    const clamped = integerTaskBrowserBounds(clampBounds(bounds, contentBounds))
    if (clamped.width === 0 || clamped.height === 0) {
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
    const previousReset = this.sessionResets.get(sessionKey)
    const reset = (async () => {
      await previousReset?.catch(() => undefined)
      await this.options.authorize(pluginId, taskId)
      this.destroyWhere(surface => surface.pluginId === pluginId && surface.taskId === taskId)
      await this.options.factory.clearSession(taskBrowserSessionPartition(pluginId, taskId))
    })()
    this.sessionResets.set(sessionKey, reset)
    try {
      await reset
    } finally {
      if (this.sessionResets.get(sessionKey) === reset) this.sessionResets.delete(sessionKey)
    }
  }

  destroyTask(taskId: string): void {
    if (!taskId.trim()) return
    this.taskEpochs.set(taskId, (this.taskEpochs.get(taskId) ?? 0) + 1)
    this.destroyWhere(surface => surface.taskId === taskId)
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
      task: this.taskEpochs.get(request.taskId) ?? 0,
      session: this.sessionEpochs.get(sessionKey) ?? 0,
      window: this.windowEpochs.get(request.windowId) ?? 0,
    }
    await this.options.authorize(request.pluginId, request.taskId)
    if (
      lifecycleEpoch.global !== this.globalEpoch
      || lifecycleEpoch.plugin !== (this.pluginEpochs.get(request.pluginId) ?? 0)
      || lifecycleEpoch.task !== (this.taskEpochs.get(request.taskId) ?? 0)
      || lifecycleEpoch.session !== (this.sessionEpochs.get(sessionKey) ?? 0)
      || lifecycleEpoch.window !== (this.windowEpochs.get(request.windowId) ?? 0)
) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface creation was superseded by lifecycle cleanup')
    }
    if (!this.windows.has(request.windowId)) {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Owning OpenForge window is unavailable')
    }

    const partition = taskBrowserSessionPartition(request.pluginId, request.taskId)
    const native = this.options.factory.createSurface({
      windowId: request.windowId,
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
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
  private async waitForSessionReset(pluginId: string, taskId: string): Promise<void> {
    const sessionKey = this.sessionEpochKey(pluginId, taskId)
    let reset = this.sessionResets.get(sessionKey)
    while (reset) {
      await reset.catch(() => undefined)
      reset = this.sessionResets.get(sessionKey)
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
