import { describe, expect, it, vi } from 'vitest'

import {
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  TaskBrowserSurfaceError,
  TaskBrowserSurfaceManager,
} from './taskBrowserSurfaceManager'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserSurfaceCreateOptions,
} from './taskBrowserSurfaceManager'

class FakeNativeSurface implements NativeTaskBrowserSurface {
  readonly loadCalls: string[] = []
  readonly bounds: TaskBrowserBounds[] = []
  readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  state: TaskBrowserNativeState = {
    url: 'about:blank',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  }
  attachedWindowId: number | null = null
  destroyed = false

  getState(): TaskBrowserNativeState {
    return { ...this.state }
  }

  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async loadURL(url: string): Promise<void> {
    if (this.loadGate) await this.loadGate
    this.loadCalls.push(url)
    this.state = { ...this.state, url }
    this.emit()
  }

  attach(windowId: number, bounds: TaskBrowserBounds): void {
    this.attachedWindowId = windowId
    this.bounds.push(bounds)
  }

  detach(): void {
    this.attachedWindowId = null
  }

  loadGate: Promise<void> | null = null

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
  }

  async goBack(): Promise<void> {}
  async goForward(): Promise<void> {}
  async reload(): Promise<void> {}
  stop(): void {}

  emit(patch: Partial<TaskBrowserNativeState> = {}): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.getState())
  }
}

class FakeNativeFactory implements NativeTaskBrowserSurfaceFactory {
  readonly creations: TaskBrowserSurfaceCreateOptions[] = []
  readonly surfaces: FakeNativeSurface[] = []
  readonly clearedPartitions: string[] = []
  loadGate: Promise<void> | null = null

  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface {
    this.creations.push(options)
    const surface = new FakeNativeSurface()
    surface.loadGate = this.loadGate
    this.surfaces.push(surface)
    return surface
  }

  async clearSession(partition: string): Promise<void> {
    this.clearedPartitions.push(partition)
  }
}

function createManager(overrides: { authorize?: (pluginId: string, taskId: string) => Promise<void> } = {}) {
  const factory = new FakeNativeFactory()
  const authorize = overrides.authorize ?? vi.fn(async () => undefined)
  const stateEvents: unknown[] = []
  const manager = new TaskBrowserSurfaceManager({
    factory,
    authorize,
    onStateChanged: event => stateEvents.push(event),
  })
  manager.registerWindow(10, { x: 0, y: 0, width: 800, height: 600 })
  manager.registerWindow(11, { x: 0, y: 0, width: 800, height: 600 })
  return { manager, factory, authorize, stateEvents }
}

describe('Task Browser Surface Manager', () => {
  it('creates one secure live surface per window, plugin, Task, and local id', async () => {
    const { manager, factory, authorize } = createManager()

    const first = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })
    const again = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/ignored',
    })
    const otherWindow = await manager.getOrCreate({
      windowId: 11,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
    })

    expect(again.surfaceId).toBe(first.surfaceId)
    expect(otherWindow.surfaceId).not.toBe(first.surfaceId)
    expect(factory.creations).toHaveLength(2)
    expect(factory.surfaces[0].loadCalls).toEqual(['https://example.com/first'])
    expect(factory.surfaces[1].loadCalls).toEqual([])
    expect(authorize).toHaveBeenCalledTimes(3)
    expect(factory.creations[0]).toMatchObject({
      partition: expect.stringMatching(/^persist:openforge-task-browser-/),
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
    })
    expect(factory.creations[1].partition).toBe(factory.creations[0].partition)
  })

  it('serializes concurrent getOrCreate calls for the same live identity', async () => {
    let releaseAuthorization: (() => void) | null = null
    const authorize = vi.fn(() => new Promise<void>(resolve => { releaseAuthorization = resolve }))
    const { manager, factory } = createManager({ authorize })

    const first = manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    const second = manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    await Promise.resolve()
    ;(releaseAuthorization as (() => void) | null)?.()

    const [a, b] = await Promise.all([first, second])
    expect(a.surfaceId).toBe(b.surfaceId)
    expect(factory.creations).toHaveLength(1)
    expect(authorize).toHaveBeenCalledOnce()
  })

  it('validates identifiers, URLs, window ownership, and project authorization with named errors', async () => {
    const denied = createManager({
      authorize: async () => {
        throw new TaskBrowserSurfaceError('PLUGIN_NOT_ENABLED', 'Plugin is not enabled for this Task project')
      },
    }).manager

    await expect(denied.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' }))
      .rejects.toMatchObject({ name: 'TaskBrowserSurfaceError', code: 'PLUGIN_NOT_ENABLED' })

    const { manager } = createManager()
    await expect(manager.getOrCreate({ windowId: 999, pluginId: 'browser', taskId: 'T-1', id: 'main' }))
      .rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: '', id: 'main' }))
      .rejects.toMatchObject({ code: 'INVALID_TASK' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'bad id' }))
      .rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main', initialUrl: 'file:///tmp/secret' }))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('attaches with clamped bounds, protects newer attachments, publishes state, and destroys explicitly', async () => {
    const { manager, factory, stateEvents } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })

    manager.attach(created.surfaceId, 'old', { x: -20, y: 20, width: 900, height: 700 })
    manager.attach(created.surfaceId, 'new', { x: 30, y: 40, width: 300, height: 200 })
    manager.attach(created.surfaceId, 'old', { x: 400, y: 400, width: 100, height: 100 })
    manager.detach(created.surfaceId, 'old')

    expect(factory.surfaces[0].attachedWindowId).toBe(10)
    expect(factory.surfaces[0].bounds).toEqual([
      { x: 0, y: 20, width: 800, height: 580 },
      { x: 30, y: 40, width: 300, height: 200 },
    ])

    factory.surfaces[0].emit({ title: 'Example', loading: true })
    expect(stateEvents).toEqual([
      expect.objectContaining({ surfaceId: created.surfaceId, state: expect.objectContaining({ title: 'Example', loading: true }) }),
    ])
    await expect(manager.getState(created.surfaceId)).resolves.toMatchObject({ title: 'Example', loading: true })

    manager.attach(created.surfaceId, 'new', { x: -20, y: 10, width: 100, height: 100 })
    manager.updateWindowBounds(10, { x: 0, y: 0, width: 50, height: 50 })
    expect(factory.surfaces[0].bounds.slice(-2)).toEqual([
      { x: 0, y: 10, width: 80, height: 100 },
      { x: 0, y: 10, width: 50, height: 40 },
    ])

    await manager.destroy(created.surfaceId)
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(created.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('invalidates pending creation when reset or plugin cleanup wins the lifecycle race', async () => {
    let releaseResetCreation: (() => void) | null = null
    let authorizationCall = 0
    const resetHarness = createManager({
      authorize: vi.fn(async () => {
        authorizationCall += 1
        if (authorizationCall === 1) await new Promise<void>(resolve => { releaseResetCreation = resolve })
      }),
    })
    const pendingReset = resetHarness.manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset', id: 'main' })
    await Promise.resolve()
    await resetHarness.manager.resetSession('browser', 'T-reset')
    ;(releaseResetCreation as (() => void) | null)?.()
    await expect(pendingReset).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    expect(resetHarness.factory.creations).toHaveLength(0)

    let releasePluginCreation: (() => void) | null = null
    const pluginHarness = createManager({
      authorize: vi.fn(() => new Promise<void>(resolve => { releasePluginCreation = resolve })),
    })
    const pendingPlugin = pluginHarness.manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-plugin', id: 'main' })
    await Promise.resolve()
    pluginHarness.manager.destroyPlugin('browser')
    ;(releasePluginCreation as (() => void) | null)?.()
    await expect(pendingPlugin).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    expect(pluginHarness.factory.creations).toHaveLength(0)

    let releaseInitialLoad: (() => void) | null = null
    const loadHarness = createManager()
    loadHarness.factory.loadGate = new Promise<void>(resolve => { releaseInitialLoad = resolve })
    const pendingLoad = loadHarness.manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-load',
      id: 'main',
      initialUrl: 'https://example.com',
    })
    await Promise.resolve()
    await Promise.resolve()
    await loadHarness.manager.resetSession('browser', 'T-load')
    ;(releaseInitialLoad as (() => void) | null)?.()
    await expect(pendingLoad).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('clears durable session data and evicts the least-recently-used detached surface above four', async () => {
    const { manager, factory } = createManager()
    const surfaces = []
    for (let index = 0; index < 5; index += 1) {
      surfaces.push(await manager.getOrCreate({
        windowId: 10,
        pluginId: 'browser',
        taskId: `T-${index}`,
        id: 'main',
      }))
    }

    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(surfaces[0].surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(surfaces[4].surfaceId)).resolves.toBeDefined()

    await manager.resetSession('browser', 'T-4')
    expect(factory.clearedPartitions).toEqual([factory.creations[4].partition])
    expect(factory.surfaces[4].destroyed).toBe(true)
  })
})
