import { describe, expect, it, vi } from 'vitest'

import { purgeSupersededTaskBrowserPartitions } from './supersededTaskBrowserPartitionCleanup'
import type { TaskBrowserPartitionRegistration } from './taskBrowserPartitionRegistry'

const LEGACY_A = `persist:openforge-task-browser-${'a'.repeat(64)}` as const
const LEGACY_B = `persist:openforge-task-browser-${'b'.repeat(64)}` as const
const SHARED = `persist:openforge-plugin-browser-${'c'.repeat(64)}` as const

function registryOf(records: TaskBrowserPartitionRegistration[]) {
  const remaining = [...records]
  return {
    listAll: vi.fn(async () => [...remaining]),
    remove: vi.fn(async (partition: string) => {
      const index = remaining.findIndex(record => record.partition === partition)
      if (index >= 0) remaining.splice(index, 1)
    }),
    remaining: () => remaining,
  }
}

function logger() {
  return { info: vi.fn(), error: vi.fn() }
}

describe('purgeSupersededTaskBrowserPartitions', () => {
  it('clears every per-Task partition and deregisters it', async () => {
    const registry = registryOf([
      { pluginId: 'browser', taskId: 'T-1', partition: LEGACY_A },
      { pluginId: 'browser', taskId: 'T-2', partition: LEGACY_B },
    ])
    const clearSession = vi.fn(async (_record: TaskBrowserPartitionRegistration) => undefined)

    const report = await purgeSupersededTaskBrowserPartitions({ registry, clearSession })

    expect(clearSession.mock.calls.map(([record]) => record.partition)).toEqual([LEGACY_A, LEGACY_B])
    expect(report).toEqual({ purgedPartitions: [LEGACY_A, LEGACY_B], pendingPartitions: [] })
    expect(registry.remaining()).toEqual([])
  })

  it('never touches the shared plugin partition that replaced them', async () => {
    const registry = registryOf([
      { pluginId: 'browser', taskId: 'T-1', partition: LEGACY_A },
      { pluginId: 'browser', partition: SHARED },
    ])
    const clearSession = vi.fn(async (_record: TaskBrowserPartitionRegistration) => undefined)

    const report = await purgeSupersededTaskBrowserPartitions({ registry, clearSession })

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledWith({ pluginId: 'browser', taskId: 'T-1', partition: LEGACY_A })
    expect(report.purgedPartitions).toEqual([LEGACY_A])
    expect(registry.remaining()).toEqual([{ pluginId: 'browser', partition: SHARED }])
  })

  it('keeps a failed partition registered so the next launch retries it', async () => {
    const registry = registryOf([
      { pluginId: 'browser', taskId: 'T-1', partition: LEGACY_A },
      { pluginId: 'browser', taskId: 'T-2', partition: LEGACY_B },
    ])
    const clearSession = vi.fn(async ({ partition }: TaskBrowserPartitionRegistration) => {
      if (partition === LEGACY_A) throw new Error('storage busy')
    })
    const log = logger()

    const report = await purgeSupersededTaskBrowserPartitions({ registry, clearSession, logger: log })

    expect(report).toEqual({ purgedPartitions: [LEGACY_B], pendingPartitions: [LEGACY_A] })
    expect(registry.remaining()).toEqual([{ pluginId: 'browser', taskId: 'T-1', partition: LEGACY_A }])
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/cleanup remains pending/i), expect.any(Error))
  })

  it('does nothing and stays silent when no superseded partition remains', async () => {
    const registry = registryOf([{ pluginId: 'browser', partition: SHARED }])
    const clearSession = vi.fn(async (_record: TaskBrowserPartitionRegistration) => undefined)
    const log = logger()

    const report = await purgeSupersededTaskBrowserPartitions({ registry, clearSession, logger: log })

    expect(clearSession).not.toHaveBeenCalled()
    expect(report).toEqual({ purgedPartitions: [], pendingPartitions: [] })
    expect(log.info).not.toHaveBeenCalled()
  })
})
