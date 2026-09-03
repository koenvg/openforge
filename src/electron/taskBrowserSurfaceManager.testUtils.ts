import { vi } from 'vitest'

import { TaskBrowserSurfaceManager } from './taskBrowserSurfaceManager.js'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserDevToolsPanel,
  TaskBrowserNativeState,
  TaskBrowserSurfaceCreateOptions,
  TaskBrowserSurfaceVisualFeedback,
  TaskBrowserVisualFeedbackAction,
  TaskBrowserSurfaceVisualFeedbackActionEvent,
  TaskBrowserSurfaceStateEvent,
} from './taskBrowserSurfaceManager.js'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'
import type {
  TaskBrowserPartitionRegistration,
  TaskBrowserPartitionRegistry,
} from './taskBrowserPartitionRegistry.js'

export class FakeNativeSurface implements NativeTaskBrowserSurface {
  readonly loadCalls: string[] = []
  readonly controlCalls: Array<'goBack' | 'goForward' | 'reload' | 'stop' | 'openDevTools' | 'closeDevTools' | 'clearVisualFeedback'> = []
  readonly devToolsPanels: Array<TaskBrowserDevToolsPanel | undefined> = []
  readonly captureCalls: Array<Record<string, never>> = []
  readonly feedbackReplacements: TaskBrowserSurfaceVisualFeedback[][] = []
  readonly bounds: TaskBrowserBounds[] = []
  readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  readonly actionListeners = new Set<(action: TaskBrowserVisualFeedbackAction) => void>()
  private readonly history = ['about:blank']
  private historyIndex = 0
  state: TaskBrowserNativeState = {
    url: 'about:blank',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    error: null,
  }
  attachedWindowId: number | null = null
  destroyed = false
  loadGate: Promise<void> | null = null

  getState(): TaskBrowserNativeState {
    return { ...this.state }
  }

  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onVisualFeedbackAction(listener: (action: TaskBrowserVisualFeedbackAction) => void): () => void {
    this.actionListeners.add(listener)
    return () => this.actionListeners.delete(listener)
  }

  async loadURL(url: string): Promise<void> {
    if (this.loadGate) await this.loadGate
    this.loadCalls.push(url)
    this.history.splice(this.historyIndex + 1)
    this.history.push(url)
    this.historyIndex = this.history.length - 1
    this.emitHistoryState({ url, loading: true, error: null })
  }

  attach(windowId: number, bounds: TaskBrowserBounds): void {
    this.attachedWindowId = windowId
    this.bounds.push(bounds)
  }

  detach(): void {
    this.attachedWindowId = null
  }

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
    this.actionListeners.clear()
  }

  async goBack(): Promise<void> {
    this.controlCalls.push('goBack')
    if (this.historyIndex > 0) this.historyIndex -= 1
    this.emitHistoryState({ url: this.history[this.historyIndex], loading: true, error: null })
  }

  async goForward(): Promise<void> {
    this.controlCalls.push('goForward')
    if (this.historyIndex < this.history.length - 1) this.historyIndex += 1
    this.emitHistoryState({ url: this.history[this.historyIndex], loading: true, error: null })
  }

  async reload(): Promise<void> {
    this.controlCalls.push('reload')
    this.emitHistoryState({ loading: true, error: null })
  }

  stop(): void {
    this.controlCalls.push('stop')
    this.emitHistoryState({ loading: false })
  }

  async openDevTools(panel?: TaskBrowserDevToolsPanel): Promise<void> {
    this.controlCalls.push('openDevTools')
    this.devToolsPanels.push(panel)
    this.emit({ devToolsOpen: true })
  }

  async closeDevTools(): Promise<void> {
    this.controlCalls.push('closeDevTools')
    this.emit({ devToolsOpen: false })
  }

  async selectVisibleRegion() {
    return {
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      comment: 'Example visual feedback',
      annotationNumber: 1,
    }
  }

  async cancelVisibleRegionSelection(): Promise<void> {
  }

  async clearVisualFeedback(): Promise<void> {
    this.controlCalls.push('clearVisualFeedback')
  }

  async replaceVisualFeedback(feedback: readonly TaskBrowserSurfaceVisualFeedback[]): Promise<void> {
    this.feedbackReplacements.push(feedback.map(marker => ({ ...marker, region: { ...marker.region } })))
  }
  async captureVisibleViewport() {
    this.captureCalls.push({})
    return { png: Buffer.from('fake-visible-png'), width: 800, height: 600 }
  }

  emit(patch: Partial<TaskBrowserNativeState> = {}): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.getState())
  }

  emitAction(action: TaskBrowserVisualFeedbackAction): void {
    for (const listener of this.actionListeners) listener({ ...action })
  }

  private emitHistoryState(patch: Partial<TaskBrowserNativeState>): void {
    this.emit({
      ...patch,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
    })
  }
}

export class FakeNativeFactory implements NativeTaskBrowserSurfaceFactory {
  readonly creations: TaskBrowserSurfaceCreateOptions[] = []
  readonly surfaces: FakeNativeSurface[] = []
  readonly clearedPartitions: string[] = []
  readonly sessionDataByPartition = new Map<string, Map<string, string>>()
  loadGate: Promise<void> | null = null
  clearGate: Promise<void> | null = null
  clearError: Error | null = null

  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface {
    this.creations.push(options)
    this.sessionDataFor(options.partition)
    const surface = new FakeNativeSurface()
    surface.loadGate = this.loadGate
    this.surfaces.push(surface)
    return surface
  }

  async clearSession(partition: string): Promise<void> {
    this.clearedPartitions.push(partition)
    if (this.clearGate) await this.clearGate
    if (this.clearError) throw this.clearError
    this.sessionDataFor(partition).clear()
  }

  sessionDataFor(partition: string): Map<string, string> {
    let data = this.sessionDataByPartition.get(partition)
    if (!data) {
      data = new Map()
      this.sessionDataByPartition.set(partition, data)
    }
    return data
  }
}

export class FakePartitionRegistry implements TaskBrowserPartitionRegistry {
  readonly registrations: TaskBrowserPartitionRegistration[] = []
  readonly records = new Map<string, TaskBrowserPartitionRegistration>()

  async register(record: TaskBrowserPartitionRegistration): Promise<void> {
    this.registrations.push({ ...record })
    this.records.set(record.partition, { ...record })
  }

  async listAll(): Promise<TaskBrowserPartitionRegistration[]> {
    return [...this.records.values()]
  }

  async listByTask(taskId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return [...this.records.values()].filter(record => record.taskId === taskId)
  }

  async listByPlugin(pluginId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return [...this.records.values()].filter(record => record.pluginId === pluginId)
  }

  async remove(partition: string): Promise<void> {
    this.records.delete(partition)
  }
}

export function createTaskBrowserSurfaceManagerFixture(
  overrides: {
    authorize?: (pluginId: string, taskId: string) => Promise<void>
    authorizePlugin?: (pluginId: string) => Promise<void>
    rendererZoomFactor?: (windowId: number) => number
  } = {},
) {
  const factory = new FakeNativeFactory()
  const registry = new FakePartitionRegistry()
  const authorize = overrides.authorize ?? vi.fn(async () => undefined)
  const authorizePlugin = overrides.authorizePlugin ?? vi.fn(async () => undefined)
  const permissionHandler: TaskBrowserPermissionSessionHandler = {
    check: vi.fn(() => false),
    request: vi.fn(async () => false),
  }
  const permissions = {
    createSessionHandler: vi.fn(async () => permissionHandler),
    clearSession: vi.fn<(pluginId: string) => Promise<void>>(async () => undefined),
  }
  const artifacts = {
    store: vi.fn(async () => ({
      artifactId: '11111111-1111-4111-8111-111111111111',
      absolutePath: '/tmp/openforge/task-browser/capture.png',
    })),
    exists: vi.fn(async () => true),
    discard: vi.fn(async () => undefined),
    cleanupTask: vi.fn(async () => undefined),
  }
  const stateEvents: TaskBrowserSurfaceStateEvent[] = []
  const actionEvents: TaskBrowserSurfaceVisualFeedbackActionEvent[] = []
  const manager = new TaskBrowserSurfaceManager({
    factory,
    registry,
    permissions,
    artifacts,
    authorize,
    authorizePlugin,
    onStateChanged: event => stateEvents.push(event),
    onVisualFeedbackAction: event => actionEvents.push(event),
    ...(overrides.rendererZoomFactor ? { rendererZoomFactor: overrides.rendererZoomFactor } : {}),
  })
  manager.registerWindow(10, { x: 0, y: 0, width: 800, height: 600 })
  manager.registerWindow(11, { x: 0, y: 0, width: 800, height: 600 })
  return {
    manager,
    factory,
    registry,
    permissions,
    artifacts,
    permissionHandler,
    authorize,
    authorizePlugin,
    stateEvents,
    actionEvents,
  }
}
