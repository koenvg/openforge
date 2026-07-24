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

type SerializableBounds = { x: number; y: number; width: number; height: number }

function intersectBounds(left: SerializableBounds, right: SerializableBounds): SerializableBounds | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  if (rightEdge <= x || bottomEdge <= y) return null
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

function visibleElementBounds(element: HTMLElement, rect: DOMRect, intersectionBounds: SerializableBounds | null): SerializableBounds | null {
  const style = getComputedStyle(element)
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null

  let visible: SerializableBounds | null = intersectBounds(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  )
  if (visible && intersectionBounds) visible = intersectBounds(visible, intersectionBounds)

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

function createAttachment(
  bridge: OpenForgeDesktopBridge,
  surfaceId: string,
  element: HTMLElement,
): Promise<Disposable> {
  const attachmentId = `task-browser-attachment-${++attachmentSequence}`
  let disposed = false
  let frame: number | null = null
  let intersecting = true
  let intersectionBounds: SerializableBounds | null = null

  const update = async () => {
    frame = null
    if (disposed) return
    const rect = element.getBoundingClientRect()
    const bounds = intersecting ? visibleElementBounds(element, rect, intersectionBounds) : null
    const response = await bridge.invoke(
      bounds ? 'task_browser_surface_attach' : 'task_browser_surface_detach',
      bounds
        ? { surfaceId, attachmentId, bounds }
        : { surfaceId, attachmentId },
    )
    if (!isHostResponse(response) || !response.ok) {
      const error = isHostResponse(response) && !response.ok
        ? new BrowserSurfaceError(response.error.code, response.error.message)
        : new BrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface attachment host returned an invalid response')
      throw error
    }
  }

  const schedule = () => {
    if (disposed || frame !== null) return
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => { void update() })
    } else {
      void update()
    }
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
        const entry = entries.find(candidate => candidate.target === element)
        intersecting = entry?.isIntersecting ?? false
        intersectionBounds = entry?.isIntersecting
          ? {
              x: entry.intersectionRect.x,
              y: entry.intersectionRect.y,
              width: entry.intersectionRect.width,
              height: entry.intersectionRect.height,
            }
          : null
        schedule()
      })
    : null
  const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
  resizeObserver?.observe(element)
  intersectionObserver?.observe(element)
  mutationObserver?.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)

  return update().then(() => ({
    async dispose() {
      if (disposed) return
      disposed = true
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      await invokeHost<void>('task_browser_surface_detach', { surfaceId, attachmentId })
    },
  }))
}

class HostTaskBrowserSurfaceController implements TaskBrowserSurfaceController {
  private currentState: TaskBrowserSurfaceState
  private destroyed = false

  constructor(
    private readonly bridge: OpenForgeDesktopBridge,
    private readonly reference: BrowserSurfaceReference,
  ) {
    this.currentState = stateCopy(reference.state)
  }

  attach(element: HTMLElement): Promise<Disposable> {
    this.assertLive()
    if (!(element instanceof HTMLElement)) {
      return Promise.reject(new BrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Surface attach requires an HTMLElement'))
    }
    return createAttachment(this.bridge, this.reference.surfaceId, element)
  }

  async detach(): Promise<void> {
    this.assertLive()
    await invokeHost<void>('task_browser_surface_detach', { surfaceId: this.reference.surfaceId })
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    await invokeHost<void>('task_browser_surface_destroy', { surfaceId: this.reference.surfaceId })
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
      const bridge = desktopBridge()
      const payload = request.initialUrl === undefined
        ? { pluginId, taskId: request.taskId, id: request.id }
        : { pluginId, ...request }
      const reference = await invokeHost<BrowserSurfaceReference>('task_browser_surface_get_or_create', payload)
      return new HostTaskBrowserSurfaceController(bridge, reference)
    },
    async resetSession(taskId: string) {
      await invokeHost<void>('task_browser_surface_reset_session', { pluginId, taskId })
    },
  }
}

export async function destroyHostPluginBrowserSurfaces(pluginId: string): Promise<void> {
  if (typeof window === 'undefined' || !window.openforge) return
  await invokeHost<void>('task_browser_surface_destroy_plugin', { pluginId })
}
