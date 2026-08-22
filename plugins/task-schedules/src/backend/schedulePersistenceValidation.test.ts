import { describe, expect, it } from 'vitest'
import { createMockBackendOpenForgeApi, createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import backendPlugin, {
  SAVE_SCHEDULE_METHOD,
  SCHEDULES_STORAGE_KEY,
  listTaskSchedules,
  runScheduleNow,
  saveTaskSchedule,
} from '../backend'
import type { TaskScheduleDraft } from '../lib/types'
import { makeSchedule, projectId, setStoredSchedules } from './testFixtures'

describe('Task Schedule persistence and validation', () => {
  it('migrates stored v1 one-off schedules into discriminated timing and lifecycle data', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 1, 9)
    await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, [{
      id: 'schedule-v1',
      title: 'Stored one-off',
      prompt: 'Preserve this schedule.',
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      mode: 'create-only',
      enabled: false,
      createdAt: runAt - 60_000,
      updatedAt: runAt,
      nextFireAt: null,
      lastFireAt: runAt,
      lastTaskId: 'T-v1',
      cancelledAt: null,
      idempotencyKey: null,
      history: [],
    }] as unknown as never)

    const [migrated] = await listTaskSchedules(api, { projectId })

    expect(migrated).toMatchObject({
      timing: { type: 'once', runAt },
      lifecycle: { state: 'completed', completedAt: runAt },
    })
    expect(migrated).not.toHaveProperty('kind')
    expect(migrated).not.toHaveProperty('enabled')
    expect(migrated).not.toHaveProperty('nextFireAt')
  })

  it('migrates stored v1 recurring active and cancelled lifecycle states', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const nextFireAt = Date.UTC(2026, 0, 2, 9)
    const lastFireAt = Date.UTC(2026, 0, 1, 9)
    const cancelledAt = Date.UTC(2026, 0, 1, 12)
    const base = {
      title: 'Stored recurring schedule',
      prompt: 'Preserve this recurring schedule.',
      kind: 'recurring',
      preset: 'weekly',
      cron: '0 9 * * 1',
      runAt: null,
      mode: 'create-and-start',
      createdAt: Date.UTC(2025, 11, 1, 9),
      updatedAt: cancelledAt,
      nextFireAt,
      lastFireAt,
      lastTaskId: 'T-v1',
      idempotencyKey: null,
      history: [],
    }
    await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, [
      { ...base, id: 'schedule-active-v1', enabled: false, cancelledAt: null },
      { ...base, id: 'schedule-cancelled-v1', enabled: false, cancelledAt },
    ] as unknown as never)

    const migrated = await listTaskSchedules(api, { projectId })

    expect(migrated).toEqual([
      expect.objectContaining({
        id: 'schedule-active-v1',
        timing: { type: 'recurring', preset: 'weekly', cron: '0 9 * * 1' },
        lifecycle: { state: 'active', enabled: false, nextFireAt, lastFireAt },
      }),
      expect.objectContaining({
        id: 'schedule-cancelled-v1',
        timing: { type: 'recurring', preset: 'weekly', cron: '0 9 * * 1' },
        lifecycle: { state: 'cancelled', cancelledAt, lastFireAt },
      }),
    ])
  })
  it.each([
    ['completed', { state: 'completed', completedAt: Date.UTC(2026, 0, 1, 9) }],
    ['cancelled', { state: 'cancelled', cancelledAt: Date.UTC(2026, 0, 1, 10) }],
  ] as const)('enforces terminal %s one-off schedules at every backend write boundary', async (_state, lifecycle) => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 2, 9)
    await setStoredSchedules(api, [makeSchedule({
      timing: { type: 'once', runAt },
      lifecycle,
    })])

    await expect(saveTaskSchedule(api, {
      projectId,
      schedule: {
        id: 'schedule-1',
        title: 'Changed terminal schedule',
        prompt: 'This must not be saved.',
        enabled: true,
      },
    })).rejects.toThrow(/cannot be updated/i)
    await expect(runScheduleNow(api, { projectId, scheduleId: 'schedule-1' })).rejects.toThrow(/cannot be run/i)
    expect(api.__testing.calls.taskCreations).toEqual([])
  })

  it('saves new Task Schedules enabled by default with create-and-start mode', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        title: 'Weekly cleanup',
        prompt: 'Clean up stale branches',
        preset: 'weekly',
        timeOfDay: '14:30',
      },
    }, Date.UTC(2026, 0, 1, 8))

    expect(saved).toMatchObject({
      title: 'Weekly cleanup',
      prompt: 'Clean up stale branches',
      timing: { type: 'recurring', preset: 'weekly', cron: '30 14 * * 1' },
      mode: 'create-and-start',
      lifecycle: { state: 'active', enabled: true },
      lastTaskId: null,
      history: [],
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toHaveLength(1)
    expect(api.__testing.calls.storageSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'project', scopeId: projectId, key: SCHEDULES_STORAGE_KEY }),
    ]))
  })

  it('rejects malformed required Task Schedule fields at the backend boundary', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })
    await registry.activateBackend(backendPlugin)

    await expect(registry.frontendApi.backend.invoke(SAVE_SCHEDULE_METHOD, {
      projectId,
      schedule: {
        title: { text: 'Daily triage' },
        prompt: 'Review incoming dependencies',
        preset: 'daily',
      },
    })).rejects.toThrow('Task Schedule title is required')

    await expect(registry.frontendApi.backend.invoke(SAVE_SCHEDULE_METHOD, {
      projectId,
      schedule: {
        title: 'Daily triage',
        prompt: ['Review incoming dependencies'],
        preset: 'daily',
      },
    })).rejects.toThrow('Task Schedule prompt is required')

    await expect(registry.frontendApi.backend.invoke(SAVE_SCHEDULE_METHOD, {
      projectId,
      schedule: {
        title: 'Daily triage',
        prompt: 'Review incoming dependencies',
        preset: 'custom',
        cron: { expression: '*/15 * * * *' },
      },
    })).rejects.toThrow('Custom Task Schedule cron is required')
  })

  it('rejects custom Task Schedules that fire more often than once every five minutes', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })

    await expect(saveTaskSchedule(api, {
      projectId,
      schedule: {
        title: 'Flooder',
        prompt: 'Do the thing',
        preset: 'custom',
        cron: '* * * * *',
      },
    }, Date.UTC(2026, 0, 1, 8))).rejects.toThrow(/5 minutes/i)

    await expect(listTaskSchedules(api, { projectId })).resolves.toHaveLength(0)
  })

  it('allows a custom Task Schedule at the five-minute minimum cadence', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        title: 'Every five minutes',
        prompt: 'Do the thing',
        preset: 'custom',
        cron: '*/5 * * * *',
      },
    }, Date.UTC(2026, 0, 1, 8))

    expect(saved.timing).toEqual({ type: 'recurring', preset: 'custom', cron: '*/5 * * * *' })
  })

  it('saves selected weekly Task Schedule days into the cron-backed schedule', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        title: 'Friday cleanup',
        prompt: 'Clean up stale branches',
        preset: 'weekly',
        timeOfDay: '14:30',
        dayOfWeek: 5,
      },
    }, Date.UTC(2026, 0, 1, 8))

    expect(saved).toMatchObject({
      timing: { type: 'recurring', preset: 'weekly', cron: '30 14 * * 5' },
    })
  })

  it('preserves last Task and history when editing a Task Schedule', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const previous = makeSchedule({
      lastTaskId: 'T-previous',
      history: [{ id: 'outcome-1', firedAt: 1, trigger: 'scheduled', status: 'started', taskId: 'T-previous', message: 'Started T-previous' }],
    })
    await setStoredSchedules(api, [previous])

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        id: previous.id,
        title: 'Daily edited',
        prompt: 'New prompt',
        preset: 'custom',
        cron: '*/30 * * * *',
        mode: 'create-only',
      },
    }, Date.UTC(2026, 0, 1, 10))

    expect(saved.lastTaskId).toBe('T-previous')
    expect(saved.history).toEqual(previous.history)
    expect(saved).toMatchObject({ title: 'Daily edited', prompt: 'New prompt', mode: 'create-only' })
  })

  it('creates a fresh Task Schedule when saving with an id that no longer exists', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const now = Date.UTC(2026, 0, 1, 10)

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        id: 'schedule-deleted',
        title: 'Daily triage',
        prompt: 'Review incoming dependencies',
        preset: 'daily',
        timeOfDay: '09:00',
        mode: 'create-and-start',
        enabled: true,
        createdAt: Date.UTC(2025, 11, 31, 8),
        lastFireAt: Date.UTC(2026, 0, 1, 8),
        lastTaskId: 'T-previous',
        history: [{ id: 'outcome-1', firedAt: 1, trigger: 'scheduled', status: 'started', taskId: 'T-previous', message: 'Started T-previous' }],
      } as TaskScheduleDraft,
    }, now)

    expect(saved.id).not.toBe('schedule-deleted')
    expect(saved.id).toMatch(/^schedule-/)
    expect(saved).toMatchObject({
      createdAt: now,
      lifecycle: { state: 'active' },
      lastTaskId: null,
      history: [],
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toEqual([saved])
  })
})
