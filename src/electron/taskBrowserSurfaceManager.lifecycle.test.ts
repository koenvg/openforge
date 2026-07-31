import { describe, expect, it, vi } from 'vitest'

import {
  TaskBrowserSurfaceError,
  TaskBrowserSurfaceManager,
} from './taskBrowserSurfaceManager'
import {
  FakePartitionRegistry,
  createTaskBrowserSurfaceManagerFixture as createManager,
} from './taskBrowserSurfaceManager.testUtils'

describe('Task Browser Surface Manager lifecycle', () => {
  it('preserves Plugin Browser Session data through destruction, plugin cleanup, LRU eviction, and restart', async () => {
    const { manager, factory, permissions } = createManager()
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
      registry: new FakePartitionRegistry(),
      permissions,
      authorize: async () => undefined,
      authorizePlugin: async () => undefined,
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
    const reset = manager.resetSession('browser')
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
    const reset = manager.resetSession('browser')
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
    const reset = manager.resetSession('browser')
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
    await resetHarness.manager.resetSession('browser')
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
    expect(taskHarness.registry.registrations).toHaveLength(0)

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
    await loadHarness.manager.resetSession('browser')
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

    const reset = manager.resetSession('browser')
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
  it('blocks new live surfaces until asynchronous Plugin Browser Session reset finishes', async () => {
    let releaseClear: (() => void) | null = null
    const { manager, factory } = createManager()
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-serialized', id: 'main' })
    factory.clearGate = new Promise<void>(resolve => { releaseClear = resolve })

    const reset = manager.resetSession('browser')
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

  it('registers one durable plugin-scoped partition shared by every Task of that plugin', async () => {
    const { manager, factory, registry } = createManager()
    const first = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-registry', id: 'main' })
    await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-other', id: 'main' })
    const partition = factory.creations[0].partition

    // Two different Tasks, one shared Plugin Browser Session: the login travels between them.
    expect(factory.creations[1].partition).toBe(partition)

    await manager.destroy(first.surfaceId)
    await manager.resetSession('browser')

    expect(registry.registrations).toEqual([
      { pluginId: 'browser', partition },
      { pluginId: 'browser', partition },
    ])
    await expect(registry.listByPlugin('browser')).resolves.toEqual([
      { pluginId: 'browser', partition },
    ])
  })

  it('purges a registered session across windows without reauthorizing an uninstalled plugin', async () => {
    const authorize = vi.fn(async () => undefined)
    const authorizePlugin = vi.fn(async () => undefined)
    const { manager, factory, permissions } = createManager({ authorize, authorizePlugin })
    const first = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-purge', id: 'main' })
    const second = await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-purge', id: 'main' })
    const unrelated = await manager.getOrCreate({ windowId: 10, pluginId: 'notes', taskId: 'T-purge', id: 'main' })
    const partition = factory.creations[0].partition
    authorize.mockRejectedValue(new Error('Task no longer exists'))
    authorizePlugin.mockRejectedValue(new Error('Plugin no longer installed'))

    await manager.purgeRegisteredSession({ pluginId: 'browser', partition })

    expect(authorize).toHaveBeenCalledTimes(3)
    expect(authorizePlugin).not.toHaveBeenCalled()
    expect(factory.clearedPartitions).toEqual([partition])
    expect(permissions.clearSession).toHaveBeenCalledWith('browser')
    await expect(manager.getState(first.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(second.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(unrelated.surfaceId)).resolves.toBeDefined()
  })

  it('keeps a failed host purge retryable and idempotent', async () => {
    const { manager, factory } = createManager()
    const surface = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-purge-retry', id: 'main' })
    const record = { pluginId: 'browser', partition: factory.creations[0].partition }
    factory.clearError = new Error('clear failed')

    await expect(manager.purgeRegisteredSession(record)).rejects.toThrow('clear failed')
    await expect(manager.getState(surface.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })

    factory.clearError = null
    await expect(manager.purgeRegisteredSession(record)).resolves.toBeUndefined()
    expect(factory.clearedPartitions).toEqual([record.partition, record.partition])
  })

  it('clears durable session data only for an explicit session reset, across every Task of the plugin', async () => {
    const { manager, factory, permissions, authorizePlugin } = createManager()
    const surface = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset', id: 'main' })
    const otherTask = await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-untouched', id: 'main' })
    const otherPlugin = await manager.getOrCreate({ windowId: 10, pluginId: 'notes', taskId: 'T-reset', id: 'main' })

    await manager.resetSession('browser')

    expect(authorizePlugin).toHaveBeenCalledWith('browser')
    expect(factory.clearedPartitions).toEqual([factory.creations[0].partition])
    expect(permissions.clearSession).toHaveBeenCalledWith('browser')
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(surface.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    // The blast radius is the whole plugin: the Task that did not trigger the reset loses its
    // surface too, because both browse with one Plugin Browser Session.
    await expect(manager.getState(otherTask.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
    await expect(manager.getState(otherPlugin.surfaceId)).resolves.toBeDefined()
  })

  it('refuses a session reset for a plugin that is no longer installed', async () => {
    const authorizePlugin = vi.fn(async () => {
      throw new TaskBrowserSurfaceError('PLUGIN_NOT_ENABLED', 'Plugin browser is not installed')
    })
    const { manager, factory } = createManager({ authorizePlugin })

    await expect(manager.resetSession('browser')).rejects.toMatchObject({ code: 'PLUGIN_NOT_ENABLED' })
    expect(factory.clearedPartitions).toEqual([])
  })


})
