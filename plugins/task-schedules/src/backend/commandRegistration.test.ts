import { describe, expect, it, vi } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import backendPlugin, {
  CANCEL_RUN_NOW_METHOD,
  CANCEL_SCHEDULE_COMMAND,
  LIST_SCHEDULES_COMMAND,
  LIST_SCHEDULES_METHOD,
  RUN_NOW_METHOD,
  SAVE_SCHEDULE_METHOD,
  SCHEDULE_COMMAND,
  UPDATE_SCHEDULE_COMMAND,
  listTaskSchedules,
  processDueSchedules,
  saveTaskSchedule,
} from '../backend'
import type { TaskSchedule } from '../lib/types'
import { makeSchedule, projectId, setStoredSchedules } from './testFixtures'

describe('Task Schedule command registration', () => {
  it('registers backend methods and a global background service', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })

    await registry.activateBackend(backendPlugin)

    expect(registry.snapshot.backendMethods.map((method) => method.id).sort()).toEqual([
      CANCEL_RUN_NOW_METHOD,
      'deleteSchedule',
      LIST_SCHEDULES_METHOD,
      RUN_NOW_METHOD,
      SAVE_SCHEDULE_METHOD,
    ].sort())
    expect(registry.snapshot.backgroundServices).toMatchObject([
      { id: 'scheduled-fires', scope: 'global', started: true },
    ])
  })

  it('registers one agent-facing command for every schedule operation', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })

    await registry.activateBackend(backendPlugin)

    const commands = registry.snapshot.commands
    expect(commands.map((command) => command.id).sort()).toEqual([
      CANCEL_SCHEDULE_COMMAND,
      LIST_SCHEDULES_COMMAND,
      SCHEDULE_COMMAND,
      UPDATE_SCHEDULE_COMMAND,
    ].sort())
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: SCHEDULE_COMMAND, discoverable: false, agent: expect.objectContaining({ discoverable: true }) }),
      expect.objectContaining({ id: LIST_SCHEDULES_COMMAND, discoverable: false, agent: expect.objectContaining({ discoverable: true }) }),
      expect.objectContaining({ id: UPDATE_SCHEDULE_COMMAND, discoverable: false, agent: expect.objectContaining({ discoverable: true }) }),
      expect.objectContaining({ id: CANCEL_SCHEDULE_COMMAND, discoverable: false, agent: expect.objectContaining({ discoverable: true }) }),
    ]))
    expect(commands.find((command) => command.id === SCHEDULE_COMMAND)).toMatchObject({
      input: { type: 'object', required: ['title', 'prompt', 'timing'] },
      output: { type: 'object', required: expect.arrayContaining(['id', 'timing', 'lifecycle']) },
    })
    const listCommand = commands.find((command) => command.id === LIST_SCHEDULES_COMMAND)
    expect(listCommand?.input).toBeUndefined()
    expect(listCommand).toMatchObject({ output: { type: 'array' } })
    expect(commands.find((command) => command.id === UPDATE_SCHEDULE_COMMAND)).toMatchObject({
      input: {
        anyOf: expect.arrayContaining([
          expect.objectContaining({ required: ['scheduleId', 'title'], additionalProperties: false }),
          expect.objectContaining({ required: ['scheduleId', 'prompt'], additionalProperties: false }),
          expect.objectContaining({ required: ['scheduleId', 'timing'], additionalProperties: false }),
          expect.objectContaining({ required: ['scheduleId', 'mode'], additionalProperties: false }),
        ]),
      },
      output: { type: 'object' },
    })
    expect(commands.find((command) => command.id === CANCEL_SCHEDULE_COMMAND)).toMatchObject({
      input: { type: 'object', required: ['scheduleId'] },
      output: { type: 'object' },
    })
  })

  it('schedules one-off work through the agent command for the current project', async () => {
    vi.useFakeTimers()
    try {
      const now = Date.UTC(2026, 7, 21, 12, 33)
      const runAt = Date.UTC(2026, 7, 26, 13, 46)
      vi.setSystemTime(now)
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)

      const scheduled = await registry.backendApi.commands.invoke<TaskSchedule>(SCHEDULE_COMMAND, {
        title: 'Resume dependency upgrade',
        prompt: 'Retry the dependency upgrade after its release-age gate.',
        timing: { type: 'once', at: '2026-08-26T13:46:00Z' },
        idempotencyKey: 'bits-ui-2.18.2-release-age',
      })

      expect(scheduled).toMatchObject({
        title: 'Resume dependency upgrade',
        prompt: 'Retry the dependency upgrade after its release-age gate.',
        timing: { type: 'once', runAt },
        lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
        mode: 'create-and-start',
        idempotencyKey: 'bits-ui-2.18.2-release-age',
      })
      await expect(listTaskSchedules(registry.backendApi, { projectId })).resolves.toEqual([scheduled])
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts lowercase RFC 3339 separators and leap seconds for one-off schedules', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 7, 21, 12, 33))
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)

      const scheduled = await registry.backendApi.commands.invoke<TaskSchedule>(SCHEDULE_COMMAND, {
        title: 'New year follow-up',
        prompt: 'Run after the leap second.',
        timing: { type: 'once', at: '2026-12-31t23:59:60z' },
      })

      expect(scheduled.timing).toEqual({ type: 'once', runAt: Date.UTC(2027, 0, 1, 0, 0) })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns one schedule when idempotent agent requests overlap', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 7, 21, 12, 33))
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)
      const input = {
        title: 'Resume dependency upgrade',
        prompt: 'Retry after the release-age gate.',
        timing: { type: 'once', at: '2026-08-26T13:46:00Z' },
        idempotencyKey: 'release-age-gate',
      }

      const [first, retried] = await Promise.all([
        registry.backendApi.commands.invoke<TaskSchedule>(SCHEDULE_COMMAND, input),
        registry.backendApi.commands.invoke<TaskSchedule>(SCHEDULE_COMMAND, input),
      ])

      expect(retried.id).toBe(first.id)
      await expect(listTaskSchedules(registry.backendApi, { projectId })).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['a past timestamp', '2026-08-20T13:46:00Z', /future/i],
    ['an impossible calendar date', '2027-02-30T13:46:00Z', /valid RFC 3339/i],
    ['a timestamp without a timezone', '2026-08-26T13:46:00', /timezone/i],
  ])('rejects %s for a one-off agent schedule', async (_case, at, expectedError) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 7, 21, 12, 33))
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)

      await expect(registry.backendApi.commands.invoke(SCHEDULE_COMMAND, {
        title: 'Invalid schedule',
        prompt: 'This must not be stored.',
        timing: { type: 'once', at },
      })).rejects.toThrow(expectedError)
      await expect(listTaskSchedules(registry.backendApi, { projectId })).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('schedules recurring cron work through the same agent command', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 7, 21, 12, 33))
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)

      const scheduled = await registry.backendApi.commands.invoke<TaskSchedule>(SCHEDULE_COMMAND, {
        title: 'Weekly dependency review',
        prompt: 'Review eligible dependency updates.',
        timing: { type: 'recurring', cron: '0 9 * * 1' },
        mode: 'create-only',
      })

      expect(scheduled).toMatchObject({
        timing: { type: 'recurring', preset: 'custom', cron: '0 9 * * 1' },
        mode: 'create-only',
      })
      expect(scheduled.lifecycle.state === 'active' ? scheduled.lifecycle.nextFireAt : null).toBeGreaterThan(Date.now())
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists current-project schedules through the agent command', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
    await registry.activateBackend(backendPlugin)
    await setStoredSchedules(registry.backendApi, [makeSchedule()])

    await expect(registry.backendApi.commands.invoke(LIST_SCHEDULES_COMMAND)).resolves.toEqual([
      expect.objectContaining({ id: 'schedule-1', title: 'Daily triage' }),
    ])
  })

  it('rejects agent schedule commands without Project context', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId: null })
    await registry.activateBackend(backendPlugin)

    await expect(registry.backendApi.commands.invoke(LIST_SCHEDULES_COMMAND)).rejects.toThrow(/Project context/i)
  })

  it('updates an active schedule through the agent command', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 0, 1, 8))
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)
      await setStoredSchedules(registry.backendApi, [makeSchedule()])

      const updated = await registry.backendApi.commands.invoke<TaskSchedule>(UPDATE_SCHEDULE_COMMAND, {
        scheduleId: 'schedule-1',
        title: 'Tuesday dependency review',
        timing: { type: 'recurring', cron: '0 10 * * 2' },
        mode: 'create-only',
      })

      expect(updated).toMatchObject({
        id: 'schedule-1',
        title: 'Tuesday dependency review',
        prompt: 'Review incoming dependencies',
        timing: { type: 'recurring', preset: 'custom', cron: '0 10 * * 2' },
        mode: 'create-only',
      })
      await expect(listTaskSchedules(registry.backendApi, { projectId })).resolves.toEqual([updated])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects updates to completed one-off schedules', async () => {
    const runAt = Date.UTC(2026, 0, 1, 9)
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
    await registry.activateBackend(backendPlugin)
    await setStoredSchedules(registry.backendApi, [makeSchedule({
      timing: { type: 'once', runAt },
      lifecycle: { state: 'completed', completedAt: runAt },
    })])

    await expect(registry.backendApi.commands.invoke(UPDATE_SCHEDULE_COMMAND, {
      scheduleId: 'schedule-1',
      prompt: 'Run it again.',
    })).rejects.toThrow(/cannot be updated/i)
  })

  it('rejects updates to cancelled recurring schedules', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
    await registry.activateBackend(backendPlugin)
    await setStoredSchedules(registry.backendApi, [makeSchedule({
      lifecycle: { state: 'cancelled', cancelledAt: Date.UTC(2026, 0, 1, 9) },
    })])

    await expect(registry.backendApi.commands.invoke(UPDATE_SCHEDULE_COMMAND, {
      scheduleId: 'schedule-1',
      prompt: 'Change a cancelled schedule.',
    })).rejects.toThrow(/cannot be updated/i)
    await expect(saveTaskSchedule(registry.backendApi, {
      projectId,
      schedule: {
        id: 'schedule-1',
        title: 'Revived schedule',
        prompt: 'This must stay cancelled.',
        preset: 'daily',
        enabled: true,
      },
    })).rejects.toThrow(/cannot be updated/i)
  })

  it('cancels a schedule through the agent command without deleting its record', async () => {
    vi.useFakeTimers()
    try {
      const now = Date.UTC(2026, 0, 1, 8)
      const runAt = Date.UTC(2026, 0, 2, 9)
      vi.setSystemTime(now)
      const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
      await registry.activateBackend(backendPlugin)
      await setStoredSchedules(registry.backendApi, [makeSchedule({
        timing: { type: 'once', runAt },
        lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
      })])

      const cancelled = await registry.backendApi.commands.invoke<TaskSchedule>(CANCEL_SCHEDULE_COMMAND, {
        scheduleId: 'schedule-1',
      })

      expect(cancelled).toMatchObject({
        id: 'schedule-1',
        lifecycle: { state: 'cancelled', cancelledAt: now },
      })
      await expect(listTaskSchedules(registry.backendApi, { projectId })).resolves.toEqual([cancelled])
      await expect(processDueSchedules(registry.backendApi, projectId, runAt + 60_000)).resolves.toEqual([])
      expect(registry.backendApi.__testing.calls.taskCreations).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not rewrite a completed one-off schedule as cancelled', async () => {
    const runAt = Date.UTC(2026, 0, 1, 9)
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
    await registry.activateBackend(backendPlugin)
    await setStoredSchedules(registry.backendApi, [makeSchedule({
      timing: { type: 'once', runAt },
      lifecycle: { state: 'completed', completedAt: runAt },
    })])

    const completed = await registry.backendApi.commands.invoke<TaskSchedule>(CANCEL_SCHEDULE_COMMAND, {
      scheduleId: 'schedule-1',
    })

    expect(completed.lifecycle).toEqual({ state: 'completed', completedAt: runAt })
  })
})
