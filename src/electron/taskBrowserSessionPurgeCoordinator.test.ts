import { mkdtemp, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

import { FileTaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry'
import {
  TaskBrowserSessionPurgeCoordinator,
  invokeWithTaskBrowserSessionPurgeDrain,
} from './taskBrowserSessionPurgeCoordinator'
import type { TaskBrowserSessionPurgeIntent } from './taskBrowserSessionPurgeCoordinator'
import type {
  TaskBrowserPartitionRegistration,
  TaskBrowserPartitionRegistry,
} from './taskBrowserPartitionRegistry'

function partition(digit: string): `persist:openforge-task-browser-${string}` {
  return `persist:openforge-task-browser-${digit.repeat(64)}`
}

class MemoryRegistry implements TaskBrowserPartitionRegistry {
  readonly records = new Map<string, TaskBrowserPartitionRegistration>()

  async register(record: TaskBrowserPartitionRegistration): Promise<void> {
    this.records.set(record.partition, record)
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

class PendingBackend {
  readonly intents = new Map<number, TaskBrowserSessionPurgeIntent>()
  readonly acknowledged: number[] = []
  acknowledgeError: Error | null = null
  listCalls = 0
  listGate: Promise<void> | null = null

  async listPending(): Promise<TaskBrowserSessionPurgeIntent[]> {
    this.listCalls += 1
    const snapshot = [...this.intents.values()]
    if (this.listGate) await this.listGate
    return snapshot
  }

  async acknowledge(intentId: number): Promise<void> {
    if (this.acknowledgeError) throw this.acknowledgeError
    this.acknowledged.push(intentId)
    this.intents.delete(intentId)
  }
}

function intent(id: number, scope: 'task' | 'plugin', ownerId: string): TaskBrowserSessionPurgeIntent {
  return { id, scope, ownerId, createdAt: 1_000 + id }
}

describe('TaskBrowserSessionPurgeCoordinator', () => {
  it('purges every registered Task session and acknowledges only after cleanup', async () => {
    const registry = new MemoryRegistry()
    await registry.register({ pluginId: 'browser', taskId: 'T-1', partition: partition('a') })
    await registry.register({ pluginId: 'notes', taskId: 'T-1', partition: partition('b') })
    await registry.register({ pluginId: 'browser', taskId: 'T-2', partition: partition('c') })
    const backend = new PendingBackend()
    backend.intents.set(1, intent(1, 'task', 'T-1'))
    const purged: TaskBrowserPartitionRegistration[] = []
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry,
      beginPurge: () => undefined,
      purgeSession: async record => { purged.push(record) },
    })

    await coordinator.drain()

    expect(purged).toEqual([
      { pluginId: 'browser', taskId: 'T-1', partition: partition('a') },
      { pluginId: 'notes', taskId: 'T-1', partition: partition('b') },
    ])
    expect(backend.acknowledged).toEqual([1])
    await expect(registry.listByTask('T-1')).resolves.toEqual([])
    await expect(registry.listByTask('T-2')).resolves.toHaveLength(1)
  })
  it('invalidates matching live and in-flight resources before acknowledging even an empty registry scope', async () => {
    const registry = new MemoryRegistry()
    const backend = new PendingBackend()
    const purgeIntent = intent(5, 'task', 'T-race')
    backend.intents.set(5, purgeIntent)
    const beginPurge = vi.fn()
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry,
      beginPurge,
      purgeSession: async () => undefined,
    })

    await coordinator.drain()

    expect(beginPurge).toHaveBeenCalledWith(purgeIntent)
    expect(backend.acknowledged).toEqual([5])
  })

  it('runs another listing pass when a destructive operation requests a drain during an active pass', async () => {
    let releaseList: (() => void) | null = null
    const backend = new PendingBackend()
    backend.intents.set(6, intent(6, 'task', 'T-first'))
    backend.listGate = new Promise<void>(resolve => { releaseList = resolve })
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry: new MemoryRegistry(),
      beginPurge: () => undefined,
      purgeSession: async () => undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    const firstDrain = coordinator.drain()
    for (let count = 0; count < 6 && backend.listCalls === 0; count += 1) await Promise.resolve()
    backend.intents.set(7, intent(7, 'plugin', 'browser'))
    const secondDrain = coordinator.drain()
    ;(releaseList as (() => void) | null)?.()
    backend.listGate = null
    await Promise.all([firstDrain, secondDrain])

    expect(backend.listCalls).toBe(2)
    expect(backend.acknowledged).toEqual([6, 7])
  })

  it('keeps partially failed cleanup pending, logs diagnostics, and retries only remaining partitions', async () => {
    const registry = new MemoryRegistry()
    const first = { pluginId: 'browser', taskId: 'T-1', partition: partition('a') }
    const second = { pluginId: 'browser', taskId: 'T-2', partition: partition('b') }
    await registry.register(first)
    await registry.register(second)
    const backend = new PendingBackend()
    backend.intents.set(2, intent(2, 'plugin', 'browser'))
    const attempts: string[] = []
    let failSecond = true
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry,
      beginPurge: () => undefined,
      logger,
      purgeSession: async record => {
        attempts.push(record.taskId ?? record.pluginId)
        if (record.taskId === 'T-2' && failSecond) throw new Error('clear failed')
      },
    })

    const firstDrain = await coordinator.drain()

    expect(firstDrain.pendingIntentIds).toEqual([2])
    expect(backend.acknowledged).toEqual([])
    expect(attempts).toEqual(['T-1', 'T-2'])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('intent 2'), expect.any(Error))
    await expect(registry.listByPlugin('browser')).resolves.toEqual([second])

    failSecond = false
    const retry = await coordinator.drain()

    expect(retry.pendingIntentIds).toEqual([])
    expect(attempts).toEqual(['T-1', 'T-2', 'T-2'])
    expect(backend.acknowledged).toEqual([2])
  })

  it('retries acknowledgement idempotently without recreating already-cleared registry entries', async () => {
    const registry = new MemoryRegistry()
    await registry.register({ pluginId: 'browser', taskId: 'T-1', partition: partition('a') })
    const backend = new PendingBackend()
    backend.intents.set(3, intent(3, 'task', 'T-1'))
    backend.acknowledgeError = new Error('sidecar unavailable')
    const purgeSession = vi.fn(async () => undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry,
      beginPurge: () => undefined,
      purgeSession,
      logger,
    })

    await coordinator.drain()
    expect(purgeSession).toHaveBeenCalledTimes(1)
    expect(backend.intents.has(3)).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('acknowledge purge intent 3'), expect.any(Error))

    backend.acknowledgeError = null
    await coordinator.drain()
    expect(purgeSession).toHaveBeenCalledTimes(1)
    expect(backend.acknowledged).toEqual([3])
  })

  it('drains a pending intent against the durable registry after a simulated restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openforge-browser-purge-restart-'))
    const path = join(directory, 'registry.json')
    const beforeRestart = new FileTaskBrowserPartitionRegistry(path)
    const record = { pluginId: 'browser', taskId: 'T-1', partition: partition('a') }
    await beforeRestart.register(record)
    const backend = new PendingBackend()
    backend.intents.set(4, intent(4, 'task', 'T-1'))
    const purgeSession = vi.fn(async () => undefined)

    const afterRestart = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry: new FileTaskBrowserPartitionRegistry(path),
      beginPurge: () => undefined,
      purgeSession,
    })
    await afterRestart.drain()

    expect(purgeSession).toHaveBeenCalledWith(record)
    expect(backend.acknowledged).toEqual([4])
  })

  it('keeps a purge pending when both initialized registry copies are missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openforge-browser-purge-missing-registry-'))
    const path = join(directory, 'registry.json')
    const registry = new FileTaskBrowserPartitionRegistry(path)
    await registry.register({ pluginId: 'browser', taskId: 'T-1', partition: partition('a') })
    await Promise.all([unlink(path), unlink(`${path}.backup`)])
    const backend = new PendingBackend()
    backend.intents.set(5, intent(5, 'task', 'T-1'))
    const purgeSession = vi.fn(async () => undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const coordinator = new TaskBrowserSessionPurgeCoordinator({
      backend,
      registry: new FileTaskBrowserPartitionRegistry(path),
      beginPurge: () => undefined,
      purgeSession,
      logger,
    })

    await expect(coordinator.drain()).resolves.toEqual({
      acknowledgedIntentIds: [],
      pendingIntentIds: [5],
    })

    expect(purgeSession).not.toHaveBeenCalled()
    expect(backend.acknowledged).toEqual([])
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cleanup remains pending'),
      expect.objectContaining({ message: expect.stringMatching(/both registry copies are missing/i) }),
    )
  })
})

describe('invokeWithTaskBrowserSessionPurgeDrain', () => {
  it.each(['delete_task', 'delete_project', 'uninstall_plugin'])('drains after successful %s operations', async command => {
    const order: string[] = []
    const result = await invokeWithTaskBrowserSessionPurgeDrain(
      { command, payload: {} },
      async () => { order.push('invoke'); return 'ok' },
      async () => { order.push('drain') },
    )

    expect(result).toBe('ok')
    expect(order).toEqual(['invoke', 'drain'])
  })

  it('does not drain after unrelated or failed operations', async () => {
    const drain = vi.fn(async () => undefined)
    await invokeWithTaskBrowserSessionPurgeDrain(
      { command: 'get_tasks', payload: null },
      async () => [],
      drain,
    )
    await expect(invokeWithTaskBrowserSessionPurgeDrain(
      { command: 'delete_task', payload: {} },
      async () => { throw new Error('delete failed') },
      drain,
    )).rejects.toThrow('delete failed')

    expect(drain).not.toHaveBeenCalled()
  })
})
