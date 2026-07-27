import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type {
  BrowserSurfaceErrorCode,
  BrowserSurfacesAPI,
  Disposable,
  GetOrCreateBrowserSurfaceRequest,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import type { OpenForgeDesktopBridge } from '../desktopIpc'

const STATE_EVENT = 'task-browser-surface-state'
const MAX_ATTACHMENT_UPDATE_ATTEMPTS = 3
let attachmentSequence = 0

interface BrowserSurfaceReference {
  surfaceId: string
  generation: number
  state: TaskBrowserSurfaceState
}

interface BrowserSurfaceStateEvent extends BrowserSurfaceReference {}

type HostResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: BrowserSurfaceErrorCode; message: string } }

function desktopBridge(): OpenForgeDesktopBridge {
  const bridge = typeof window === 'undefined' ? null : window.openforge ?? null
  if (!bridge) {
    throw new BrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surfaces require the Electron desktop host')
  }
  return bridge
}

function isHostResponse<T>(value: unknown): value is HostResponse<T> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

async function invokeHost<T>(command: string, payload: unknown): Promise<T> {
  let response: unknown
  try {
    response = await desktopBridge().invoke(command, payload)
  } catch (error) {
    if (error instanceof BrowserSurfaceError) throw error
    throw new BrowserSurfaceError('HOST_UNAVAILABLE', error instanceof Error ? error.message : String(error))
  }
  if (!isHostResponse<T>(response)) {
    throw new BrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface host returned an invalid response')
  }
  if (!response.ok) throw new BrowserSurfaceError(response.error.code, response.error.message)
  return response.value
}

function stateCopy(state: TaskBrowserSurfaceState): TaskBrowserSurfaceState {
  return { ...state, error: state.error ? { ...state.error } : null }
}

interface TrackedSurfaceAttachments {
  pluginId: string
  taskId: string
  attachments: Set<Disposable>
}

const trackedSurfaceAttachments = new Map<string, TrackedSurfaceAttachments>()

interface AttachmentCleanupScope {
  pluginId: string
  taskId: string | null
  surfaceId: string | null
}

interface ActiveAttachmentCleanup {
  scope: AttachmentCleanupScope
  operation: Promise<void>
}

const activeAttachmentCleanups = new Map<number, ActiveAttachmentCleanup>()
let attachmentCleanupSequence = 0
let attachmentCleanupEpoch = 0

function cleanupScopesOverlap(left: AttachmentCleanupScope, right: AttachmentCleanupScope): boolean {
  if (left.pluginId !== right.pluginId) return false
  if (left.taskId !== null && right.taskId !== null && left.taskId !== right.taskId) return false
  return left.surfaceId === null || right.surfaceId === null || left.surfaceId === right.surfaceId
}

async function waitForAttachmentCleanup(scope: AttachmentCleanupScope): Promise<number> {
  let observedEpoch = attachmentCleanupEpoch
  while (true) {
    const pending = Array.from(activeAttachmentCleanups.values())
      .filter(cleanup => cleanupScopesOverlap(cleanup.scope, scope))
      .map(cleanup => cleanup.operation.catch(() => undefined))
    await Promise.all(pending)
    if (observedEpoch === attachmentCleanupEpoch) {
      const stillActive = Array.from(activeAttachmentCleanups.values())
        .some(cleanup => cleanupScopesOverlap(cleanup.scope, scope))
      if (!stillActive) return observedEpoch
    }
    observedEpoch = attachmentCleanupEpoch
  }
}

async function waitForStableAttachmentCleanup(scope: AttachmentCleanupScope): Promise<void> {
  while (true) {
    const stableEpoch = await waitForAttachmentCleanup(scope)
    if (stableEpoch === attachmentCleanupEpoch) return
  }
}

function runAttachmentCleanup(
  scope: AttachmentCleanupScope,
  cleanup: () => Promise<void>,
): Promise<void> {
  attachmentCleanupEpoch += 1
  const cleanupId = ++attachmentCleanupSequence
  const previous = Array.from(activeAttachmentCleanups.values())
    .filter(active => cleanupScopesOverlap(active.scope, scope))
    .map(active => active.operation.catch(() => undefined))
  let operation: Promise<void>
  operation = Promise.all(previous)
    .then(() => cleanup())
    .finally(() => { activeAttachmentCleanups.delete(cleanupId) })
  activeAttachmentCleanups.set(cleanupId, { scope, operation })
  return operation
}

function trackAttachment(
  pluginId: string,
  taskId: string,
  surfaceId: string,
  attachment: Disposable,
): Disposable {
  let entry = trackedSurfaceAttachments.get(surfaceId)
  if (!entry) {
    entry = { pluginId, taskId, attachments: new Set() }
    trackedSurfaceAttachments.set(surfaceId, entry)
  }
  let tracked = true
  const disposable: Disposable = {
    async dispose() {
      if (!tracked) return
      tracked = false
      entry?.attachments.delete(disposable)
      if (entry?.attachments.size === 0 && trackedSurfaceAttachments.get(surfaceId) === entry) {
        trackedSurfaceAttachments.delete(surfaceId)
      }
      await attachment.dispose()
    },
  }
  entry.attachments.add(disposable)
  return disposable
}

async function disposeTrackedSurfaceAttachments(surfaceId: string): Promise<void> {
  const entry = trackedSurfaceAttachments.get(surfaceId)
  if (!entry) return
  trackedSurfaceAttachments.delete(surfaceId)
  await Promise.allSettled(Array.from(entry.attachments, attachment => attachment.dispose()))
}

async function disposeTrackedAttachmentsWhere(
  predicate: (entry: TrackedSurfaceAttachments) => boolean,
): Promise<void> {
  const surfaceIds = Array.from(trackedSurfaceAttachments.entries())
    .filter(([, entry]) => predicate(entry))
    .map(([surfaceId]) => surfaceId)
  await Promise.all(surfaceIds.map(disposeTrackedSurfaceAttachments))
}

async function createTrackedAttachment(
  pluginId: string,
  taskId: string,
  surfaceId: string,
  bridge: OpenForgeDesktopBridge,
  element: HTMLElement,
): Promise<Disposable> {
  const cleanupScope = { pluginId, taskId, surfaceId }
  await waitForStableAttachmentCleanup(cleanupScope)
  let released = false
  let attachmentPromise: Promise<Disposable> | null = null
  const pendingAttachment: Disposable = {
    async dispose() {
      released = true
      const attachment = await attachmentPromise?.catch(() => null)
      await attachment?.dispose()
    },
  }
  attachmentPromise = createAttachment(bridge, surfaceId, element)
  const trackedAttachment = trackAttachment(pluginId, taskId, surfaceId, pendingAttachment)

  try {
    await attachmentPromise
    if (released) {
      throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Attachment was released during attachment')
    }
    return trackedAttachment
  } catch (error) {
    const releasedByLifecycle = released
    await trackedAttachment.dispose()
    if (releasedByLifecycle && !(error instanceof BrowserSurfaceError && error.code === 'SURFACE_DESTROYED')) {
      throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Attachment was released during attachment')
    }
    throw error
  }
}

type SerializableBounds = { x: number; y: number; width: number; height: number }

function intersectBounds(left: SerializableBounds, right: SerializableBounds): SerializableBounds | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  if (rightEdge <= x || bottomEdge <= y) return null
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

function visibleElementBounds(element: HTMLElement, rect: DOMRect): SerializableBounds | null {
  const style = getComputedStyle(element)
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null

  let visible: SerializableBounds | null = intersectBounds(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  )

  let ancestor = element.parentElement
  while (visible && ancestor) {
    const ancestorStyle = getComputedStyle(ancestor)
    const clips = (value: string) => value !== '' && value !== 'visible'
    const clipsX = clips(ancestorStyle.overflowX) || clips(ancestorStyle.overflow)
    const clipsY = clips(ancestorStyle.overflowY) || clips(ancestorStyle.overflow)
    if (clipsX || clipsY) {
      const ancestorRect = ancestor.getBoundingClientRect()
      const clip = {
        x: clipsX ? ancestorRect.x : visible.x,
        y: clipsY ? ancestorRect.y : visible.y,
        width: clipsX ? ancestorRect.width : visible.width,
        height: clipsY ? ancestorRect.height : visible.height,
      }
      visible = intersectBounds(visible, clip)
    }
    ancestor = ancestor.parentElement
  }
  return visible
}

async function createAttachment(
  bridge: OpenForgeDesktopBridge,
  surfaceId: string,
  element: HTMLElement,
): Promise<Disposable> {
  const attachmentGeneration = ++attachmentSequence
  const attachmentId = `task-browser-attachment-${attachmentGeneration}`
  let disposed = false
  let frame: number | null = null
  let intersecting = true
  let shouldTrackPosition = false
  let lastBoundsKey: string | undefined
  let failedBoundsKey: string | undefined
  let failedBoundsAttempts = 0
  let updateQueue: Promise<void> = Promise.resolve()

  const update = async () => {
    if (disposed) return
    const rect = element.getBoundingClientRect()
    const bounds = intersecting ? visibleElementBounds(element, rect) : null
    shouldTrackPosition = bounds !== null
    const boundsKey = JSON.stringify(bounds)
    if (boundsKey === lastBoundsKey) {
      failedBoundsKey = undefined
      failedBoundsAttempts = 0
      return
    }
    if (boundsKey !== failedBoundsKey) {
      failedBoundsKey = undefined
      failedBoundsAttempts = 0
    }
    if (failedBoundsAttempts >= MAX_ATTACHMENT_UPDATE_ATTEMPTS) return

    try {
      const response = await bridge.invoke('task_browser_surface_attach', {
        surfaceId,
        attachmentId,
        attachmentGeneration,
        bounds,
      })
      if (!isHostResponse(response) || !response.ok) {
        const error = isHostResponse(response) && !response.ok
          ? new BrowserSurfaceError(response.error.code, response.error.message)
          : new BrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface attachment host returned an invalid response')
        throw error
      }
      lastBoundsKey = boundsKey
      failedBoundsKey = undefined
      failedBoundsAttempts = 0
    } catch (error) {
      failedBoundsKey = boundsKey
      failedBoundsAttempts += 1
      throw error
    }
  }

  const queueUpdate = (): Promise<void> => {
    const operation = updateQueue.then(update)
    updateQueue = operation.catch(() => undefined)
    return operation
  }

  const reportScheduledError = (error: unknown) => {
    console.error('[taskBrowserSurfaces] Failed to update Task Browser Attachment bounds:', error)
  }

  const schedule = () => {
    if (disposed || frame !== null) return
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => {
        void queueUpdate()
          .catch(reportScheduledError)
          .finally(() => {
            frame = null
            if (
              shouldTrackPosition
              || (failedBoundsKey !== undefined && failedBoundsAttempts < MAX_ATTACHMENT_UPDATE_ATTEMPTS)
            ) schedule()
          })
      })
    } else {
      void queueUpdate().catch(reportScheduledError)
    }
  }

  while (true) {
    try {
      await queueUpdate()
      break
    } catch (error) {
      if (failedBoundsAttempts >= MAX_ATTACHMENT_UPDATE_ATTEMPTS) throw error
    }
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
        const entry = entries.find(candidate => candidate.target === element)
        intersecting = entry?.isIntersecting ?? false
        schedule()
      })
    : null
  const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
  resizeObserver?.observe(element)
  intersectionObserver?.observe(element)
  mutationObserver?.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  if (shouldTrackPosition) schedule()

  return {
    async dispose() {
      if (disposed) return
      disposed = true
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      await updateQueue
      try {
        await invokeHost<void>('task_browser_surface_detach', {
          surfaceId,
          attachmentId,
          attachmentGeneration,
        })
      } catch (error) {
        if (!(error instanceof BrowserSurfaceError) || error.code !== 'SURFACE_DESTROYED') throw error
      }
    },
  }
}

class HostTaskBrowserSurfaceController implements TaskBrowserSurfaceController {
  private currentState: TaskBrowserSurfaceState
  private destroyed = false

  constructor(
    private readonly bridge: OpenForgeDesktopBridge,
    private readonly reference: BrowserSurfaceReference,
    private readonly pluginId: string,
    private readonly taskId: string,
  ) {
    this.currentState = stateCopy(reference.state)
  }

  async attach(element: HTMLElement): Promise<Disposable> {
    this.assertLive()
    if (!(element instanceof HTMLElement)) {
      throw new BrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Surface attach requires an HTMLElement')
    }
    return createTrackedAttachment(
      this.pluginId,
      this.taskId,
      this.reference.surfaceId,
      this.bridge,
      element,
    )
  }

  async detach(): Promise<void> {
    this.assertLive()
    await runAttachmentCleanup(
      { pluginId: this.pluginId, taskId: this.taskId, surfaceId: this.reference.surfaceId },
      async () => {
        await disposeTrackedSurfaceAttachments(this.reference.surfaceId)
        await invokeHost<void>('task_browser_surface_detach', { surfaceId: this.reference.surfaceId })
      },
    )
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    await runAttachmentCleanup(
      { pluginId: this.pluginId, taskId: this.taskId, surfaceId: this.reference.surfaceId },
      async () => {
        await disposeTrackedSurfaceAttachments(this.reference.surfaceId)
        await invokeHost<void>('task_browser_surface_destroy', { surfaceId: this.reference.surfaceId })
      },
    )
    this.destroyed = true
  }

  async getState(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.currentState = await invokeHost<TaskBrowserSurfaceState>('task_browser_surface_get_state', { surfaceId: this.reference.surfaceId })
    return stateCopy(this.currentState)
  }

  onStateChanged(handler: (state: TaskBrowserSurfaceState) => void): Disposable {
    this.assertLive()
    const unlisten = this.bridge.onEvent(STATE_EVENT, payload => {
      if (this.destroyed || !this.isCurrentEvent(payload)) return
      this.currentState = stateCopy(payload.state)
      handler(stateCopy(this.currentState))
    })
    return { dispose: unlisten }
  }

  navigate(url: string): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_navigate', { surfaceId: this.reference.surfaceId, url })
  }

  goBack(): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_go_back', { surfaceId: this.reference.surfaceId })
  }

  goForward(): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_go_forward', { surfaceId: this.reference.surfaceId })
  }

  reload(): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_reload', { surfaceId: this.reference.surfaceId })
  }

  stop(): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_stop', { surfaceId: this.reference.surfaceId })
  }

  private async control(command: string, payload: unknown): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.currentState = await invokeHost<TaskBrowserSurfaceState>(command, payload)
    return stateCopy(this.currentState)
  }

  private isCurrentEvent(payload: unknown): payload is BrowserSurfaceStateEvent {
    if (typeof payload !== 'object' || payload === null) return false
    const event = payload as Partial<BrowserSurfaceStateEvent>
    return event.surfaceId === this.reference.surfaceId
      && event.generation === this.reference.generation
      && typeof event.state === 'object'
      && event.state !== null
  }

  private assertLive(): void {
    if (this.destroyed) throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
  }
}

export function createHostBrowserSurfaces(pluginId: string): BrowserSurfacesAPI {
  return {
    async getOrCreate(request: GetOrCreateBrowserSurfaceRequest) {
      await waitForStableAttachmentCleanup({ pluginId, taskId: request.taskId, surfaceId: null })
      const bridge = desktopBridge()
      const payload = request.initialUrl === undefined
        ? { pluginId, taskId: request.taskId, id: request.id }
        : { pluginId, ...request }
      const reference = await invokeHost<BrowserSurfaceReference>('task_browser_surface_get_or_create', payload)
      return new HostTaskBrowserSurfaceController(bridge, reference, pluginId, request.taskId)
    },
    async resetSession(taskId: string) {
      await runAttachmentCleanup(
        { pluginId, taskId, surfaceId: null },
        async () => {
          await disposeTrackedAttachmentsWhere(entry => entry.pluginId === pluginId && entry.taskId === taskId)
          await invokeHost<void>('task_browser_surface_reset_session', { pluginId, taskId })
        },
      )
    },
  }
}

export async function destroyHostPluginBrowserSurfaces(pluginId: string): Promise<void> {
  if (typeof window === 'undefined' || !window.openforge) return
  await runAttachmentCleanup(
    { pluginId, taskId: null, surfaceId: null },
    async () => {
      await disposeTrackedAttachmentsWhere(entry => entry.pluginId === pluginId)
      await invokeHost<void>('task_browser_surface_destroy_plugin', { pluginId })
    },
  )
}
