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
  TaskBrowserSurfaceStateEvent,
} from './taskBrowserSurfaceManager'

class FakeNativeSurface implements NativeTaskBrowserSurface {
  readonly loadCalls: string[] = []
  readonly controlCalls: Array<'goBack' | 'goForward' | 'reload' | 'stop'> = []
  readonly bounds: TaskBrowserBounds[] = []
  readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private readonly history = ['about:blank']
  private historyIndex = 0
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

  loadGate: Promise<void> | null = null

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
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

  emit(patch: Partial<TaskBrowserNativeState> = {}): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.getState())
  }

  private emitHistoryState(patch: Partial<TaskBrowserNativeState>): void {
    this.emit({
      ...patch,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
    })
  }
}

class FakeNativeFactory implements NativeTaskBrowserSurfaceFactory {
  readonly creations: TaskBrowserSurfaceCreateOptions[] = []
  readonly surfaces: FakeNativeSurface[] = []
  readonly clearedPartitions: string[] = []
  readonly sessionDataByPartition = new Map<string, Map<string, string>>()
  loadGate: Promise<void> | null = null
  clearGate: Promise<void> | null = null

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

function createManager(overrides: { authorize?: (pluginId: string, taskId: string) => Promise<void> } = {}) {
  const factory = new FakeNativeFactory()
  const authorize = overrides.authorize ?? vi.fn(async () => undefined)
  const stateEvents: TaskBrowserSurfaceStateEvent[] = []
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
      windowId: 10,
      partition: expect.stringMatching(/^persist:openforge-task-browser-/),
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
    })
    expect(factory.creations[1].partition).toBe(factory.creations[0].partition)
  })

  it('allows ordinary HTTP(S) popups and rejects unsafe schemes or requested preference overrides', async () => {
    const { manager, factory } = createManager()
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-popup-policy', id: 'main' })
    const { popupPolicy } = factory.creations[0]

    for (const url of ['https://auth.example/start', 'http://127.0.0.1:4173/oauth/start']) {
      expect(popupPolicy.isAllowed({ url, features: '' }), url).toBe(true)
      expect(popupPolicy.isAllowed({ url, features: 'width=640,height=720,resizable=yes' }), url).toBe(true)
    }

    for (const url of [
      'about:blank',
      'file:///tmp/secret',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'plugin://browser/page',
      'openforge://internal',
      'mailto:user@example.com',
      'malformed',
    ]) {
      expect(popupPolicy.isAllowed({ url, features: '' }), url).toBe(false)
    }

    for (const features of [
      'nodeIntegration=yes',
      'contextIsolation=no',
      'sandbox=no',
      'webSecurity=no',
      'allowRunningInsecureContent=yes',
      'webviewTag=yes',
      'preload=/tmp/unsafe.cjs',
      'devTools=yes',
      'partition=persist:other',
      'javascript=no',
      'zoomFactor=2',
      'NODEINTEGRATION=yes',
      ' nodeIntegration = yes ',
    ]) {
      expect(popupPolicy.isAllowed({ url: 'https://auth.example/start', features }), features).toBe(false)
    }
  })

  it('derives one stable persistent partition per plugin and Task without surface identity collisions', async () => {
    const { manager, factory } = createManager()

    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'secondary' })
    await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-2', id: 'main' })
    await manager.getOrCreate({ windowId: 10, pluginId: 'notes', taskId: 'T-1', id: 'main' })

    const partitions = factory.creations.map(creation => creation.partition)
    expect(partitions.slice(0, 3)).toEqual([
      'persist:openforge-task-browser-f3c7a3c60de8e74b261b9e88aeaf2593e6ff954e58b3a1c5b3849f6731f97ba0',
      'persist:openforge-task-browser-f3c7a3c60de8e74b261b9e88aeaf2593e6ff954e58b3a1c5b3849f6731f97ba0',
      'persist:openforge-task-browser-f3c7a3c60de8e74b261b9e88aeaf2593e6ff954e58b3a1c5b3849f6731f97ba0',
    ])
    expect(new Set(partitions)).toEqual(new Set([
      partitions[0],
      'persist:openforge-task-browser-70819d092c2822b2e0555899dd6e86a1836fb0b8f9e5b62867d356511acd7697',
      'persist:openforge-task-browser-c8eb76f24facb80fa89c177bdfc4d94a7ab2b5d1129767299dbea3828eb7798c',
    ]))
  })

  it('preserves Task Browser Session data through destruction, plugin cleanup, LRU eviction, and restart', async () => {
    const { manager, factory } = createManager()
    const savedUrl = 'https://example.com/restored'
    const original = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
      initialUrl: savedUrl,
    })
    const partition = factory.creations.at(-1)!.partition
    const durableData = factory.sessionDataFor(partition)
    for (const dataKind of ['cookies', 'cache', 'localStorage', 'indexedDB', 'serviceWorkers']) {
      durableData.set(dataKind, 'preserved')
    }

    await manager.destroy(original.surfaceId)
    const withoutPluginUrl = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
    })
    expect(factory.creations.at(-1)!.partition).toBe(partition)
    await expect(manager.getState(withoutPluginUrl.surfaceId)).resolves.toMatchObject({ url: 'about:blank' })

    await manager.destroy(withoutPluginUrl.surfaceId)
    const beforePluginCleanup = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
      initialUrl: savedUrl,
    })
    manager.destroyPlugin('browser')
    const afterPluginCleanup = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
      initialUrl: savedUrl,
    })
    expect(afterPluginCleanup.surfaceId).not.toBe(beforePluginCleanup.surfaceId)

    for (let index = 0; index < 4; index += 1) {
      await manager.getOrCreate({
        windowId: 10,
        pluginId: 'browser',
        taskId: `T-lru-${index}`,
        id: 'main',
      })
    }
    await expect(manager.getState(afterPluginCleanup.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })

    const afterEviction = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
      initialUrl: savedUrl,
    })
    expect(factory.creations.at(-1)!.partition).toBe(partition)
    await expect(manager.getState(afterEviction.surfaceId)).resolves.toMatchObject({ url: savedUrl })

    manager.destroyAll()
    const restartedManager = new TaskBrowserSurfaceManager({
      factory,
      authorize: async () => undefined,
    })
    restartedManager.registerWindow(10, { x: 0, y: 0, width: 800, height: 600 })
    await restartedManager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-durable',
      id: 'main',
      initialUrl: savedUrl,
    })

    expect(factory.creations.at(-1)!.partition).toBe(partition)
    expect(factory.sessionDataFor(partition)).toEqual(durableData)
    expect([...durableData.values()]).toEqual(Array(5).fill('preserved'))
    expect(factory.clearedPartitions).toEqual([])
  })

  it('keeps concurrent callers pending until the initial URL load completes', async () => {
    let releaseInitialLoad: (() => void) | null = null
    const { manager, factory } = createManager()
    factory.loadGate = new Promise<void>(resolve => { releaseInitialLoad = resolve })

    const first = manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-load-serialization',
      id: 'main',
      initialUrl: 'https://example.com',
    })
    await Promise.resolve()
    await Promise.resolve()
    let secondSettled = false
    const second = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-load-serialization', id: 'main' })
      .then(reference => {
        secondSettled = true
        return reference
      })
    await Promise.resolve()
    await Promise.resolve()
    const settledBeforeLoad = secondSettled

    ;(releaseInitialLoad as (() => void) | null)?.()
    const [firstReference, secondReference] = await Promise.all([first, second])

    expect(settledBeforeLoad).toBe(false)
    expect(secondReference.surfaceId).toBe(firstReference.surfaceId)
    expect(factory.creations).toHaveLength(1)
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

  it('clamps bounds and uses attachment generations to preserve the newest attachment', async () => {
    const { manager, factory, stateEvents } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })

    manager.attach(created.surfaceId, 'old', 1, { x: -20, y: 20, width: 900, height: 700 })
    manager.attach(created.surfaceId, 'new', 2, { x: 30, y: 40, width: 300, height: 200 })
    manager.attach(created.surfaceId, 'old', 1, { x: 400, y: 400, width: 100, height: 100 })
    manager.detach(created.surfaceId, 'old', 1)

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

    manager.attach(created.surfaceId, 'new', 2, { x: -20, y: 10, width: 100, height: 100 })
    manager.updateWindowBounds(10, { x: 0, y: 0, width: 50, height: 50 })
    expect(factory.surfaces[0].bounds.slice(-2)).toEqual([
      { x: 0, y: 10, width: 80, height: 100 },
      { x: 0, y: 10, width: 50, height: 40 },
    ])

    manager.attach(created.surfaceId, 'new', 2, null)
    expect(factory.surfaces[0].attachedWindowId).toBeNull()
    manager.attach(created.surfaceId, 'new', 2, { x: 5, y: 6, width: 20, height: 30 })
    expect(factory.surfaces[0].attachedWindowId).toBe(10)

    manager.detach(created.surfaceId, 'new', 2)
    manager.attach(created.surfaceId, 'new', 2, { x: 7, y: 8, width: 20, height: 30 })
    expect(factory.surfaces[0].attachedWindowId).toBeNull()

    manager.attach(created.surfaceId, 'tiny', 3, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(factory.surfaces[0].attachedWindowId).toBeNull()
    manager.attach(created.surfaceId, 'tiny', 3, { x: 0.1, y: 0.1, width: 1.2, height: 1.2 })
    expect(factory.surfaces[0].attachedWindowId).toBe(10)
    expect(factory.surfaces[0].bounds.at(-1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })

    expect(() => manager.attach(created.surfaceId, 'replacement', 4, { x: 0, y: 0, width: -1, height: 20 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_BOUNDS' }))

    await manager.destroy(created.surfaceId)
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(created.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('does not return an existing surface destroyed while reauthorization is pending', async () => {
    let releaseReauthorization: (() => void) | null = null
    let authorizationCall = 0
    const { manager } = createManager({
      authorize: vi.fn(async () => {
        authorizationCall += 1
        if (authorizationCall === 2) {
          await new Promise<void>(resolve => { releaseReauthorization = resolve })
        }
      }),
    })
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-existing-race', id: 'main' })

    const reacquired = manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-existing-race', id: 'main' })
    await Promise.resolve()
    manager.destroyPlugin('browser')
    ;(releaseReauthorization as (() => void) | null)?.()

    await expect(reacquired).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('does not return an existing surface after a session reset starts', async () => {
    let releaseClear: (() => void) | null = null
    const { manager, factory } = createManager()
    const existing = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-reset-existing',
      id: 'main',
    })
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    let reacquireSettled = false
    const reacquired = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-existing', id: 'main' })
      .then(reference => {
        reacquireSettled = true
        return reference
      })
    const reset = manager.resetSession('browser', 'T-reset-existing')
    for (let count = 0; count < 6; count += 1) await Promise.resolve()
    const settledBeforeResetFinished = reacquireSettled

    ;(releaseClear as (() => void) | null)?.()
    await reset
    const replacement = await reacquired

    expect(settledBeforeResetFinished).toBe(false)
    expect(replacement.surfaceId).not.toBe(existing.surfaceId)
    await expect(manager.getState(existing.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(replacement.surfaceId)).resolves.toBeDefined()
  })

  it('waits for reset clearing when reset starts during existing-surface authorization', async () => {
    let releaseReauthorization: (() => void) | null = null
    let releaseClear: (() => void) | null = null
    let authorizationCall = 0
    const { manager, factory } = createManager({
      authorize: vi.fn(async () => {
        authorizationCall += 1
        if (authorizationCall === 2) {
          await new Promise<void>(resolve => { releaseReauthorization = resolve })
        }
      }),
    })
    const existing = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-reset-during-authorization',
      id: 'main',
    })
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    let reacquireSettled = false
    const reacquired = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-during-authorization', id: 'main' })
      .then(reference => {
        reacquireSettled = true
        return reference
      })
    for (let count = 0; count < 6 && releaseReauthorization === null; count += 1) await Promise.resolve()
    const reset = manager.resetSession('browser', 'T-reset-during-authorization')
    for (let count = 0; count < 6; count += 1) await Promise.resolve()
    ;(releaseReauthorization as (() => void) | null)?.()
    for (let count = 0; count < 6; count += 1) await Promise.resolve()
    const settledBeforeResetFinished = reacquireSettled

    ;(releaseClear as (() => void) | null)?.()
    await reset
    const replacement = await reacquired

    expect(settledBeforeResetFinished).toBe(false)
    expect(replacement.surfaceId).not.toBe(existing.surfaceId)
    await expect(manager.getState(replacement.surfaceId)).resolves.toBeDefined()
  })

  it('does not create a surface when a same-turn session reset begins first', async () => {
    let releaseClear: (() => void) | null = null
    const { manager, factory } = createManager()
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    let getOrCreateSettled = false
    const created = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-same-turn', id: 'main' })
      .then(reference => {
        getOrCreateSettled = true
        return reference
      })
    const reset = manager.resetSession('browser', 'T-reset-same-turn')
    for (let count = 0; count < 6; count += 1) await Promise.resolve()
    const settledBeforeResetFinished = getOrCreateSettled

    ;(releaseClear as (() => void) | null)?.()
    await reset
    const reference = await created

    expect(settledBeforeResetFinished).toBe(false)
    await expect(manager.getState(reference.surfaceId)).resolves.toBeDefined()
  })

  it('invalidates pending creation when reset, Task, or plugin cleanup wins the lifecycle race', async () => {
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

    let releaseTaskCreation: (() => void) | null = null
    const taskHarness = createManager({
      authorize: vi.fn(() => new Promise<void>(resolve => { releaseTaskCreation = resolve })),
    })
    const pendingTask = taskHarness.manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-task', id: 'main' })
    await Promise.resolve()
    taskHarness.manager.destroyTask('T-task')
    ;(releaseTaskCreation as (() => void) | null)?.()
    await expect(pendingTask).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    expect(taskHarness.factory.creations).toHaveLength(0)

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

  it('reacquires a replacement instead of inheriting stale pre-reset pending creation', async () => {
    let releaseInitialLoad: (() => void) | null = null
    let releaseClear: (() => void) | null = null
    const { manager, factory } = createManager()
    factory.loadGate = new Promise<void>(resolve => { releaseInitialLoad = resolve })
    const original = manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-reset-pending',
      id: 'main',
      initialUrl: 'https://example.com',
    })
    for (let count = 0; count < 8 && factory.creations.length === 0; count += 1) await Promise.resolve()
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    const reset = manager.resetSession('browser', 'T-reset-pending')
    for (let count = 0; count < 8 && factory.clearedPartitions.length === 0; count += 1) await Promise.resolve()
    let reacquireSettled = false
    const reacquired = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-pending', id: 'main' })
      .then(
        reference => {
          reacquireSettled = true
          return { reference, errorCode: null }
        },
        error => {
          reacquireSettled = true
          return { reference: null, errorCode: (error as { code?: string }).code ?? 'unexpected-error' }
        },
      )
    factory.loadGate = null

    ;(releaseClear as (() => void) | null)?.()
    await reset
    for (let count = 0; count < 8; count += 1) await Promise.resolve()
    const settledAfterReset = reacquireSettled

    ;(releaseInitialLoad as (() => void) | null)?.()
    const reacquireOutcome = await reacquired
    await expect(original).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })

    expect(settledAfterReset).toBe(true)
    expect(reacquireOutcome.errorCode).toBeNull()
    expect(reacquireOutcome.reference).not.toBeNull()
    await expect(manager.getState(reacquireOutcome.reference!.surfaceId)).resolves.toBeDefined()
  })
  it('blocks new live surfaces until asynchronous Task Browser Session reset finishes', async () => {
    let releaseClear: (() => void) | null = null
    const { manager, factory } = createManager()
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-serialized', id: 'main' })
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    const reset = manager.resetSession('browser', 'T-reset-serialized')
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    const duringReset = manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-reset-serialized',
      id: 'main',
    })
    for (let count = 0; count < 4; count += 1) await Promise.resolve()
    const creationsBeforeClearFinished = factory.creations.length

    ;(releaseClear as (() => void) | null)?.()
    await reset
    const replacement = await duringReset

    expect(creationsBeforeClearFinished).toBe(1)
    expect(factory.creations).toHaveLength(2)
    expect(factory.surfaces[0].destroyed).toBe(true)
    expect(factory.surfaces[1].destroyed).toBe(false)
    await expect(manager.getState(replacement.surfaceId)).resolves.toBeDefined()
  })
  it('retains at most four detached surfaces per window without evicting attached surfaces', async () => {
    const { manager, factory } = createManager()
    const surfaces = []
    for (let index = 0; index < 4; index += 1) {
      surfaces.push(await manager.getOrCreate({
        windowId: 10,
        pluginId: 'browser',
        taskId: `T-${index}`,
        id: 'main',
      }))
    }

    manager.attach(surfaces[0].surfaceId, 'visible', 1, { x: 0, y: 0, width: 200, height: 100 })
    for (let index = 4; index < 6; index += 1) {
      surfaces.push(await manager.getOrCreate({
        windowId: 10,
        pluginId: 'browser',
        taskId: `T-${index}`,
        id: 'main',
      }))
    }

    expect(factory.surfaces[0].destroyed).toBe(false)
    expect(factory.surfaces[1].destroyed).toBe(true)
    await expect(manager.getState(surfaces[0].surfaceId)).resolves.toBeDefined()
    await expect(manager.getState(surfaces[1].surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })

    manager.detach(surfaces[0].surfaceId)
    expect(factory.surfaces[0].destroyed).toBe(false)
    expect(factory.surfaces[2].destroyed).toBe(true)
  })

  it('releases every live surface owned by a Task without clearing its durable sessions', async () => {
    const { manager, factory } = createManager()
    const browserTask = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-cleanup', id: 'main' })
    const notesTask = await manager.getOrCreate({ windowId: 11, pluginId: 'notes', taskId: 'T-cleanup', id: 'main' })
    const unaffected = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-other', id: 'main' })

    manager.destroyTask('T-cleanup')

    expect(factory.surfaces[0].destroyed).toBe(true)
    expect(factory.surfaces[1].destroyed).toBe(true)
    expect(factory.surfaces[2].destroyed).toBe(false)
    await expect(manager.getState(browserTask.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(notesTask.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(unaffected.surfaceId)).resolves.toBeDefined()
    expect(factory.clearedPartitions).toEqual([])
  })

  it('does not recreate a surface after Task cleanup when authorization observes a terminal Task', async () => {
    let taskCompleted = false
    const { manager, factory } = createManager({
      authorize: vi.fn(async () => {
        if (taskCompleted) throw new TaskBrowserSurfaceError('INVALID_TASK', 'Task is completed')
      }),
    })
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-cleanup', id: 'main' })

    taskCompleted = true
    manager.destroyTask('T-cleanup')

    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-cleanup', id: 'main' }))
      .rejects.toMatchObject({ code: 'INVALID_TASK' })
    expect(factory.creations).toHaveLength(1)
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(created.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('releases plugin, window, and application live resources without clearing durable sessions', async () => {
    const { manager, factory } = createManager()
    const pluginWindow10 = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-2', id: 'main' })
    const otherPluginWindow10 = await manager.getOrCreate({ windowId: 10, pluginId: 'notes', taskId: 'T-1', id: 'main' })
    const otherPluginWindow11 = await manager.getOrCreate({ windowId: 11, pluginId: 'notes', taskId: 'T-2', id: 'main' })

    manager.destroyPlugin('browser')
    expect(factory.surfaces.slice(0, 2).every(surface => surface.destroyed)).toBe(true)
    await expect(manager.getState(pluginWindow10.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(otherPluginWindow10.surfaceId)).resolves.toBeDefined()

    manager.unregisterWindow(10)
    expect(factory.surfaces[2].destroyed).toBe(true)
    await expect(manager.getState(otherPluginWindow11.surfaceId)).resolves.toBeDefined()

    manager.destroyAll()
    expect(factory.surfaces[3].destroyed).toBe(true)
    expect(factory.clearedPartitions).toEqual([])
  })

  it('clears durable session data only for an explicit session reset', async () => {
    const { manager, factory } = createManager()
    const surface = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset', id: 'main' })

    await manager.resetSession('browser', 'T-reset')

    expect(factory.clearedPartitions).toEqual([factory.creations[0].partition])
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(surface.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('controls HTTP(S) navigation and returns complete history and loading snapshots', async () => {
    const { manager, factory, stateEvents } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-nav', id: 'main' })
    const native = factory.surfaces[0]

    await expect(manager.navigate(created.surfaceId, 'https://example.com/first')).resolves.toEqual({
      url: 'https://example.com/first',
      title: '',
      loading: true,
      canGoBack: true,
      canGoForward: false,
      error: null,
    })
    await manager.navigate(created.surfaceId, 'http://example.com/second')
    await expect(manager.goBack(created.surfaceId)).resolves.toMatchObject({
      url: 'https://example.com/first',
      canGoBack: true,
      canGoForward: true,
    })
    await manager.goBack(created.surfaceId)
    await manager.goBack(created.surfaceId)
    await expect(manager.goForward(created.surfaceId)).resolves.toMatchObject({
      url: 'https://example.com/first',
      canGoBack: true,
      canGoForward: true,
    })
    await expect(manager.reload(created.surfaceId)).resolves.toMatchObject({ loading: true, error: null })
    await expect(manager.stop(created.surfaceId)).resolves.toMatchObject({ loading: false })

    expect(native.controlCalls).toEqual(['goBack', 'goBack', 'goForward', 'reload', 'stop'])
    expect(stateEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId: 10,
        surfaceId: created.surfaceId,
        generation: created.generation,
        state: expect.objectContaining({ url: 'https://example.com/first', canGoForward: true }),
      }),
    ]))
    for (const event of stateEvents) {
      expect(event.state).toEqual(expect.objectContaining({
        url: expect.any(String),
        title: expect.any(String),
        loading: expect.any(Boolean),
        canGoBack: expect.any(Boolean),
        canGoForward: expect.any(Boolean),
      }))
      expect(event.state).toHaveProperty('error')
    }
  })

  it.each([
    'about:blank',
    'file:///tmp/secret',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'plugin://browser/page',
    'openforge://internal',
    'mailto:user@example.com',
    'not a url',
  ])('blocks unsupported plugin navigation destinations: %s', async blockedUrl => {
    const { manager } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-policy', id: 'main' })

    await expect(manager.navigate(created.surfaceId, blockedUrl)).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('rejects state events from destroyed native generations while keeping windows isolated', async () => {
    const { manager, factory, stateEvents } = createManager()
    const first = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    const otherWindow = await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    const staleListener = Array.from(factory.surfaces[0].listeners)[0]
    expect(staleListener).toBeDefined()

    await manager.destroy(first.surfaceId)
    const replacement = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    staleListener?.({
      url: 'https://stale.example',
      title: 'Stale',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: { code: '-105', message: 'stale failure', url: 'https://stale.example' },
    })
    factory.surfaces[1].emit({ title: 'Other window' })
    factory.surfaces[2].emit({ title: 'Replacement' })

    expect(replacement.generation).not.toBe(first.generation)
    expect(stateEvents).toEqual([
      expect.objectContaining({ windowId: 11, surfaceId: otherWindow.surfaceId, state: expect.objectContaining({ title: 'Other window' }) }),
      expect.objectContaining({ windowId: 10, surfaceId: replacement.surfaceId, state: expect.objectContaining({ title: 'Replacement' }) }),
    ])
    expect(stateEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ state: expect.objectContaining({ title: 'Stale' }) }),
    ]))
  })
})
