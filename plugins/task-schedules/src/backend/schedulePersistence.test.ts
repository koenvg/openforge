import { describe, expect, it } from 'vitest'
import { createMockBackendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import { makeSchedule, projectId } from './testFixtures'
import { readSchedules, SCHEDULES_STORAGE_KEY, writeSchedules } from './schedulePersistence'

const pluginId = 'com.openforge.task-schedules'
const runAt = Date.UTC(2026, 0, 2, 9)
const createdAt = Date.UTC(2026, 0, 1, 8)

function storedV1Schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-v1',
    title: 'Stored schedule',
    prompt: 'Preserve this schedule.',
    kind: 'once',
    preset: null,
    cron: null,
    runAt,
    mode: 'create-only',
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    nextFireAt: runAt,
    lastFireAt: null,
    lastTaskId: null,
    cancelledAt: null,
    idempotencyKey: null,
    history: [],
    ...overrides,
  }
}

describe('Task Schedule persistence', () => {
  it('serializes discriminated Task Schedule data without stored-v1 fields', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId, projectId })
    const schedule = makeSchedule({
      id: 'schedule-current',
      timing: { type: 'once', runAt },
      lifecycle: { state: 'active', enabled: false, nextFireAt: runAt },
    })

    await writeSchedules(api, projectId, [schedule])

    const stored = await api.storage.project(projectId).get(SCHEDULES_STORAGE_KEY)
    expect(stored).toEqual([{
      id: 'schedule-current',
      title: 'Daily triage',
      prompt: 'Review incoming dependencies',
      mode: 'create-and-start',
      createdAt,
      updatedAt: createdAt,
      lastTaskId: null,
      idempotencyKey: null,
      history: [],
      timing: { type: 'once', runAt },
      lifecycle: { state: 'active', enabled: false, nextFireAt: runAt },
    }])
  })

  it('migrates original stored-v1 recurring data that predates one-off schedules', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId, projectId })
    await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, [{
      id: 'schedule-original-v1',
      title: 'Daily triage',
      prompt: 'Review incoming dependencies',
      preset: 'daily',
      cron: '0 9 * * *',
      mode: 'create-and-start',
      enabled: true,
      createdAt,
      updatedAt: createdAt,
      nextFireAt: runAt,
      lastFireAt: null,
      lastTaskId: null,
      history: [],
    }] as unknown as never)

    await expect(readSchedules(api, projectId)).resolves.toEqual([{
      id: 'schedule-original-v1',
      title: 'Daily triage',
      prompt: 'Review incoming dependencies',
      mode: 'create-and-start',
      createdAt,
      updatedAt: createdAt,
      lastTaskId: null,
      idempotencyKey: null,
      history: [],
      timing: { type: 'recurring', preset: 'daily', cron: '0 9 * * *' },
      lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
    }])
  })

  it.each([
    ['active', {
      stored: {},
      lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
    }],
    ['completed', {
      stored: { enabled: false, nextFireAt: null, lastFireAt: runAt },
      lifecycle: { state: 'completed', completedAt: runAt },
    }],
    ['cancelled', {
      stored: { enabled: false, nextFireAt: null, cancelledAt: createdAt },
      lifecycle: { state: 'cancelled', cancelledAt: createdAt },
    }],
  ] as const)('migrates stored-v1 %s one-off lifecycle data', async (_state, expected) => {
    const api = createMockBackendOpenForgeApi({ pluginId, projectId })
    await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, [
      storedV1Schedule(expected.stored),
    ] as unknown as never)

    const [schedule] = await readSchedules(api, projectId)

    expect(schedule).toEqual({
      id: 'schedule-v1',
      title: 'Stored schedule',
      prompt: 'Preserve this schedule.',
      mode: 'create-only',
      createdAt,
      updatedAt: createdAt,
      lastTaskId: null,
      idempotencyKey: null,
      history: [],
      timing: { type: 'once', runAt },
      lifecycle: expected.lifecycle,
    })
  })
})
