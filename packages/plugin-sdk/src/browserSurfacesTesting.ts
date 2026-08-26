import {
  BrowserSurfaceError,
  isAllowedBrowserSurfaceUrl,
} from './browserSurfaces.js'
import type {
  BrowserSurfacesAPI,
  BrowserDevToolsPanel,
  BrowserSurfaceCapture,
  BrowserSurfaceFeedbackSelection,
  BrowserSurfaceVisualFeedback,
  GetOrCreateBrowserSurfaceRequest,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from './browserSurfaces'
import type { Disposable } from './types'

export interface TestingBrowserSurfaceCalls {
  browserSurfaceGetOrCreate: GetOrCreateBrowserSurfaceRequest[]
  browserSurfaceAttachments: Array<{ taskId: string; id: string; element: HTMLElement }>
  browserSurfaceDetaches: Array<{ taskId: string; id: string }>
  browserSurfaceDestroys: Array<{ taskId: string; id: string }>
  browserSurfaceNavigations: Array<{ taskId: string; id: string; url: string }>
  browserSurfaceControls: Array<{
    taskId: string
    id: string
    action: 'goBack' | 'goForward' | 'reload' | 'stop' | 'openDevTools' | 'closeDevTools'
    panel?: BrowserDevToolsPanel
  }>
  browserSurfaceSelections: Array<{ taskId: string; id: string }>
  browserSurfaceFeedbackClears: Array<{ taskId: string; id: string }>
  browserSurfaceFeedbackReplacements: Array<{ taskId: string; id: string; feedback: BrowserSurfaceVisualFeedback[] }>
  browserSurfaceCaptureChecks: Array<{ taskId: string; id: string; artifactId: string }>
  browserSurfaceCaptures: Array<{ taskId: string; id: string }>
  browserSurfaceCaptureDiscards: Array<{ taskId: string; id: string; artifactId: string }>
  browserSurfaceSessionResets: Array<Record<string, never>>
}

export interface TestingBrowserSurfaces {
  readonly api: BrowserSurfacesAPI
  setState(taskId: string, id: string, patch: Partial<TaskBrowserSurfaceState>): void
}

function disposable(dispose: () => void | Promise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

function surfaceKey(taskId: string, id: string): string {
  return `${taskId}\u0000${id}`
}

function copyState(state: TaskBrowserSurfaceState): TaskBrowserSurfaceState {
  return { ...state, error: state.error ? { ...state.error } : null }
}

function validateIdentity(taskId: string, id: string): void {
  if (!taskId.trim()) throw new BrowserSurfaceError('INVALID_TASK', 'Task Browser Surface requires a non-empty Task ID')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new BrowserSurfaceError('INVALID_ID', 'Task Browser Surface id must be a stable non-empty local identifier')
  }
}

class TestingTaskBrowserSurface implements TaskBrowserSurfaceController {
  private state: TaskBrowserSurfaceState
  private readonly history: string[]
  private historyIndex = 0
  private readonly listeners = new Set<(state: TaskBrowserSurfaceState) => void>()
  private currentAttachment = 0
  private destroyed = false
  private nextAnnotationNumber = 1
  private readonly capturedArtifactIds = new Set<string>()

  constructor(
    readonly taskId: string,
    readonly id: string,
    initialUrl: string | undefined,
    private readonly calls: TestingBrowserSurfaceCalls,
    private readonly onDestroyed: () => void,
  ) {
    const url = initialUrl ?? 'about:blank'
    this.history = [url]
    this.state = {
      url,
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    }
  }

  async attach(element: HTMLElement): Promise<Disposable> {
    this.assertLive()
    const attachment = ++this.currentAttachment
    this.calls.browserSurfaceAttachments.push({ taskId: this.taskId, id: this.id, element })
    return disposable(async () => {
      if (this.destroyed || attachment !== this.currentAttachment) return
      await this.detach()
    })
  }

  async detach(): Promise<void> {
    this.assertLive()
    this.currentAttachment += 1
    this.calls.browserSurfaceDetaches.push({ taskId: this.taskId, id: this.id })
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.listeners.clear()
    this.calls.browserSurfaceDestroys.push({ taskId: this.taskId, id: this.id })
    this.onDestroyed()
  }

  async getState(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    return copyState(this.state)
  }

  onStateChanged(handler: (state: TaskBrowserSurfaceState) => void): Disposable {
    this.assertLive()
    this.listeners.add(handler)
    return disposable(() => { this.listeners.delete(handler) })
  }

  async navigate(url: string): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    if (!isAllowedBrowserSurfaceUrl(url)) {
      throw new BrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) navigation')
    }
    this.calls.browserSurfaceNavigations.push({ taskId: this.taskId, id: this.id, url })
    this.history.splice(this.historyIndex + 1)
    this.history.push(url)
    this.historyIndex = this.history.length - 1
    this.publish({ url, title: '', error: null })
    return this.getState()
  }

  async goBack(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({ taskId: this.taskId, id: this.id, action: 'goBack' })
    if (this.historyIndex > 0) this.historyIndex -= 1
    this.publish({ url: this.history[this.historyIndex], error: null })
    return this.getState()
  }

  async goForward(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({ taskId: this.taskId, id: this.id, action: 'goForward' })
    if (this.historyIndex < this.history.length - 1) this.historyIndex += 1
    this.publish({ url: this.history[this.historyIndex], error: null })
    return this.getState()
  }

  async reload(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({ taskId: this.taskId, id: this.id, action: 'reload' })
    this.publish({ error: null })
    return this.getState()
  }

  async stop(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({ taskId: this.taskId, id: this.id, action: 'stop' })
    this.publish({ loading: false })
    return this.getState()
  }

  async openDevTools(panel?: BrowserDevToolsPanel): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({
      taskId: this.taskId,
      id: this.id,
      action: 'openDevTools',
      ...(panel ? { panel } : {}),
    })
    this.publish({ devToolsOpen: true })
    return this.getState()
  }

  async closeDevTools(): Promise<TaskBrowserSurfaceState> {
    this.assertLive()
    this.calls.browserSurfaceControls.push({ taskId: this.taskId, id: this.id, action: 'closeDevTools' })
    this.publish({ devToolsOpen: false })
    return this.getState()
  }

  async selectVisibleRegion(): Promise<BrowserSurfaceFeedbackSelection> {
    this.assertLive()
    this.calls.browserSurfaceSelections.push({ taskId: this.taskId, id: this.id })
    return {
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      comment: 'Example visual feedback',
      annotationNumber: this.nextAnnotationNumber++,
    }
  }

  async cancelVisibleRegionSelection(): Promise<void> {
    this.assertLive()
  }

  async clearVisualFeedback(): Promise<void> {
    this.assertLive()
    this.calls.browserSurfaceFeedbackClears.push({ taskId: this.taskId, id: this.id })
    this.nextAnnotationNumber = 1
  }

  async replaceVisualFeedback(feedback: readonly BrowserSurfaceVisualFeedback[]): Promise<void> {
    this.assertLive()
    this.calls.browserSurfaceFeedbackReplacements.push({
      taskId: this.taskId,
      id: this.id,
      feedback: feedback.map(marker => ({ ...marker, region: { ...marker.region } })),
    })
    this.nextAnnotationNumber = feedback.reduce(
      (maximum, marker) => Math.max(maximum, marker.annotationNumber),
      0,
    ) + 1
  }

  async captureExists(artifactId: string): Promise<boolean> {
    this.assertLive()
    if (!artifactId.trim()) throw new BrowserSurfaceError('INVALID_ID', 'Browser Surface capture requires an artifact ID')
    this.calls.browserSurfaceCaptureChecks.push({ taskId: this.taskId, id: this.id, artifactId })
    return this.capturedArtifactIds.has(artifactId)
  }

  async captureVisibleViewport(): Promise<BrowserSurfaceCapture> {
    this.assertLive()
    this.calls.browserSurfaceCaptures.push({ taskId: this.taskId, id: this.id })
    const artifactId = `capture-${this.calls.browserSurfaceCaptures.length}`
    this.capturedArtifactIds.add(artifactId)
    return {
      artifactId,
      absolutePath: `/tmp/openforge-browser-captures/${this.taskId}/capture-${this.calls.browserSurfaceCaptures.length}.png`,
      mediaType: 'image/png',
      width: 800,
      height: 600,
      url: this.state.url,
      title: this.state.title,
      capturedAt: '2026-01-01T00:00:00.000Z',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }
  }

  async discardCapture(artifactId: string): Promise<void> {
    this.assertLive()
    if (!artifactId.trim()) throw new BrowserSurfaceError('INVALID_ID', 'Browser Surface capture requires an artifact ID')
    this.calls.browserSurfaceCaptureDiscards.push({ taskId: this.taskId, id: this.id, artifactId })
    this.capturedArtifactIds.delete(artifactId)
  }

  setState(patch: Partial<TaskBrowserSurfaceState>): void {
    this.assertLive()
    this.state = copyState({ ...this.state, ...patch })
    this.notify()
  }

  private publish(patch: Partial<TaskBrowserSurfaceState>): void {
    this.state = {
      ...this.state,
      ...patch,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener(copyState(this.state))
  }

  private assertLive(): void {
    if (this.destroyed) throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
  }
}

export function createTestingBrowserSurfaces(calls: TestingBrowserSurfaceCalls): TestingBrowserSurfaces {
  const surfaces = new Map<string, TestingTaskBrowserSurface>()

  const api: BrowserSurfacesAPI = {
    async getOrCreate(request) {
      const recorded = request.initialUrl === undefined ? { taskId: request.taskId, id: request.id } : { ...request }
      calls.browserSurfaceGetOrCreate.push(recorded)
      validateIdentity(request.taskId, request.id)
      const key = surfaceKey(request.taskId, request.id)
      let surface = surfaces.get(key)
      if (!surface) {
        if (request.initialUrl !== undefined && !isAllowedBrowserSurfaceUrl(request.initialUrl)) {
          throw new BrowserSurfaceError('INVALID_URL', 'Task Browser Surfaces only allow HTTP(S) initial URLs')
        }
        surface = new TestingTaskBrowserSurface(request.taskId, request.id, request.initialUrl, calls, () => surfaces.delete(key))
        surfaces.set(key, surface)
      }
      return surface
    },
    async resetSession() {
      calls.browserSurfaceSessionResets.push({})
      for (const surface of Array.from(surfaces.values())) await surface.destroy()
    },
  }

  return {
    api,
    setState(taskId, id, patch) {
      const surface = surfaces.get(surfaceKey(taskId, id))
      if (!surface) throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface is not live')
      surface.setState(patch)
    },
  }
}
