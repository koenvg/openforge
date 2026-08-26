import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type {
  BrowserSurfaceCapture,
  BrowserDevToolsPanel,
  BrowserSurfaceFeedbackSelection,
  BrowserSurfaceVisualFeedback,
  BrowserSurfaceErrorCode,
  BrowserSurfacesAPI,
  Disposable,
  GetOrCreateBrowserSurfaceRequest,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import type { OpenForgeDesktopBridge } from '../desktopIpc'
import { taskBrowserAttachments } from './taskBrowserAttachments'
import type { TaskBrowserAttachmentHost } from './taskBrowserAttachments'

const STATE_EVENT = 'task-browser-surface-state'

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

function attachmentHost(bridge: OpenForgeDesktopBridge): TaskBrowserAttachmentHost {
  return {
    update(payload) {
      return bridge.invoke('task_browser_surface_attach', payload)
    },
    validateUpdate(response) {
      if (!isHostResponse(response) || !response.ok) {
        const error = isHostResponse(response) && !response.ok
          ? new BrowserSurfaceError(response.error.code, response.error.message)
          : new BrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface attachment host returned an invalid response')
        throw error
      }
    },
    detach(payload) {
      return invokeHost<void>('task_browser_surface_detach', payload)
    },
  }
}

function stateCopy(state: TaskBrowserSurfaceState): TaskBrowserSurfaceState {
  return { ...state, error: state.error ? { ...state.error } : null }
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
    return taskBrowserAttachments.create({
      pluginId: this.pluginId,
      taskId: this.taskId,
      surfaceId: this.reference.surfaceId,
      host: attachmentHost(this.bridge),
      element,
    })
  }

  async detach(): Promise<void> {
    this.assertLive()
    await taskBrowserAttachments.cleanupSurface(
      this.pluginId,
      this.taskId,
      this.reference.surfaceId,
      () => invokeHost<void>('task_browser_surface_detach', { surfaceId: this.reference.surfaceId }),
    )
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    await taskBrowserAttachments.cleanupSurface(
      this.pluginId,
      this.taskId,
      this.reference.surfaceId,
      () => invokeHost<void>('task_browser_surface_destroy', { surfaceId: this.reference.surfaceId }),
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

  openDevTools(panel?: BrowserDevToolsPanel): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_open_devtools', {
      surfaceId: this.reference.surfaceId,
      ...(panel ? { panel } : {}),
    })
  }

  closeDevTools(): Promise<TaskBrowserSurfaceState> {
    return this.control('task_browser_surface_close_devtools', { surfaceId: this.reference.surfaceId })
  }

  selectVisibleRegion(): Promise<BrowserSurfaceFeedbackSelection | null> {
    this.assertLive()
    return invokeHost<BrowserSurfaceFeedbackSelection | null>('task_browser_surface_select_visible_region', this.captureOwner())
  }

  async cancelVisibleRegionSelection(): Promise<void> {
    this.assertLive()
    await invokeHost<void>('task_browser_surface_cancel_visible_region_selection', this.captureOwner())
  }

  async clearVisualFeedback(): Promise<void> {
    this.assertLive()
    await invokeHost<void>('task_browser_surface_clear_visual_feedback', this.captureOwner())
  }

  async replaceVisualFeedback(feedback: readonly BrowserSurfaceVisualFeedback[]): Promise<void> {
    this.assertLive()
    await invokeHost<void>('task_browser_surface_replace_visual_feedback', { ...this.captureOwner(), feedback })
  }

  async captureExists(artifactId: string): Promise<boolean> {
    this.assertLive()
    if (!artifactId.trim()) throw new BrowserSurfaceError('INVALID_ID', 'Task Browser capture requires an artifact ID')
    return invokeHost<boolean>('task_browser_surface_capture_exists', { ...this.captureOwner(), artifactId })
  }
  captureVisibleViewport(): Promise<BrowserSurfaceCapture> {
    this.assertLive()
    return invokeHost<BrowserSurfaceCapture>('task_browser_surface_capture_visible_viewport', this.captureOwner())
  }

  async discardCapture(artifactId: string): Promise<void> {
    this.assertLive()
    if (!artifactId.trim()) throw new BrowserSurfaceError('INVALID_ID', 'Task Browser capture requires an artifact ID')
    await invokeHost<void>('task_browser_surface_discard_capture', { ...this.captureOwner(), artifactId })
  }

  private captureOwner() {
    return {
      pluginId: this.pluginId,
      taskId: this.taskId,
      surfaceId: this.reference.surfaceId,
      generation: this.reference.generation,
    }
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
      await taskBrowserAttachments.waitForTaskCleanup(pluginId, request.taskId)
      const bridge = desktopBridge()
      const payload = request.initialUrl === undefined
        ? { pluginId, taskId: request.taskId, id: request.id }
        : { pluginId, ...request }
      const reference = await invokeHost<BrowserSurfaceReference>('task_browser_surface_get_or_create', payload)
      return new HostTaskBrowserSurfaceController(bridge, reference, pluginId, request.taskId)
    },
    async resetSession() {
      await taskBrowserAttachments.cleanupPlugin(
        pluginId,
        () => invokeHost<void>('task_browser_surface_reset_session', { pluginId }),
      )
    },
  }
}

export async function destroyHostPluginBrowserSurfaces(pluginId: string): Promise<void> {
  if (typeof window === 'undefined' || !window.openforge) return
  await taskBrowserAttachments.cleanupPlugin(
    pluginId,
    () => invokeHost<void>('task_browser_surface_destroy_plugin', { pluginId }),
  )
}
