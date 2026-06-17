import { describe, expect, it, vi } from 'vitest'
import { createMockBackendOpenForgeApi, createOpenForgeRegistryFake } from '@openforge/plugin-sdk/testing'
import backendPlugin, {
  LIST_SCHEDULES_METHOD,
  RUN_NOW_METHOD,
  SAVE_SCHEDULE_METHOD,
  SCHEDULES_STORAGE_KEY,
  listTaskSchedules,
  processDueSchedules,
  processDueSchedulesForAllProjects,
  runScheduleNow,
  saveTaskSchedule,
} from './backend'
import type { BackendOpenForgeAPI } from '@openforge/plugin-sdk/backend'
import type { TaskSchedule, TaskScheduleDraft } from './lib/types'

const projectId = 'P-1'

function makeSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: 'schedule-1',
    title: 'Daily triage',
    prompt: 'Review incoming dependencies',
    preset: 'daily',
    cron: '0 9 * * *',
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 1, 9),
    lastFireAt: null,
    lastTaskId: null,
    history: [],
    ...overrides,
  }
}

function restoredOutcome(index: number) {
  return {
    id: `valid-outcome-${index}`,
    firedAt: index,
    trigger: 'manual' as const,
    status: 'created' as const,
    taskId: `T-${index}`,
    message: `Created T-${index}`,
  }
}

describe('Task Schedules backend plugin', () => {
  it('registers backend methods and a project background service', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId })

    await registry.activateBackend(backendPlugin)

    expect(registry.snapshot.backendMethods.map((method) => method.id).sort()).toEqual([
      'deleteSchedule',
      LIST_SCHEDULES_METHOD,
      RUN_NOW_METHOD,
      SAVE_SCHEDULE_METHOD,
    ].sort())
    expect(registry.snapshot.backgroundServices).toMatchObject([
      { id: 'scheduled-fires', scope: 'global', started: true },
    ])
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
      preset: 'weekly',
      cron: '30 14 * * 1',
      mode: 'create-and-start',
      enabled: true,
      lastTaskId: null,
      history: [],
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toHaveLength(1)
    expect(api.__testing.calls.storageSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'project', scopeId: projectId, key: SCHEDULES_STORAGE_KEY }),
    ]))
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
      preset: 'weekly',
      cron: '30 14 * * 5',
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

  it('restores deleted Task Schedule identity and history when undo re-saves a schedule draft', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const deleted = makeSchedule({
      id: 'schedule-deleted',
      createdAt: Date.UTC(2025, 11, 31, 8),
      lastFireAt: Date.UTC(2026, 0, 1, 8),
      lastTaskId: 'T-previous',
      history: [{ id: 'outcome-1', firedAt: 1, trigger: 'scheduled', status: 'started', taskId: 'T-previous', message: 'Started T-previous' }],
    })
    await setStoredSchedules(api, [])

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        id: deleted.id,
        title: deleted.title,
        prompt: deleted.prompt,
        preset: deleted.preset,
        timeOfDay: '09:00',
        mode: deleted.mode,
        enabled: deleted.enabled,
        createdAt: deleted.createdAt,
        lastFireAt: deleted.lastFireAt,
        lastTaskId: deleted.lastTaskId,
        history: deleted.history,
      },
    }, Date.UTC(2026, 0, 1, 10))

    expect(saved).toMatchObject({
      id: 'schedule-deleted',
      createdAt: deleted.createdAt,
      lastFireAt: deleted.lastFireAt,
      lastTaskId: 'T-previous',
      history: deleted.history,
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toContainEqual(expect.objectContaining({ id: 'schedule-deleted' }))
  })

  it('sanitizes malformed deleted Task Schedule restore metadata instead of persisting it', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const now = Date.UTC(2026, 0, 1, 10)
    const malformedRestoreDraft = {
      id: 42,
      title: 'Daily triage',
      prompt: 'Review incoming dependencies',
      preset: 'daily',
      timeOfDay: '09:00',
      mode: 'create-and-start',
      enabled: true,
      createdAt: 'not-a-timestamp',
      lastFireAt: { firedAt: Date.UTC(2026, 0, 1, 8) },
      lastTaskId: ['T-previous'],
      history: { id: 'outcome-1', firedAt: 1, trigger: 'scheduled', status: 'started', taskId: 'T-previous', message: 'Started T-previous' },
    } as unknown as TaskScheduleDraft

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: malformedRestoreDraft,
    }, now)

    expect(saved.id).toMatch(/^schedule-/)
    expect(saved).toMatchObject({
      createdAt: now,
      lastFireAt: null,
      lastTaskId: null,
      history: [],
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toEqual([saved])
  })

  it('drops malformed restored history entries and keeps only the latest five valid outcomes', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const restoredHistory = [
      restoredOutcome(0),
      { id: 'bad-fired-at', firedAt: 'later', trigger: 'manual', status: 'created', message: 'Bad firedAt' },
      restoredOutcome(1),
      { id: 'bad-trigger', firedAt: 2, trigger: 'automatic', status: 'created', message: 'Bad trigger' },
      { ...restoredOutcome(2), debug: { unsafe: true } },
      { id: 'bad-status', firedAt: 3, trigger: 'manual', status: 'done', message: 'Bad status' },
      restoredOutcome(3),
      { id: 'bad-message', firedAt: 4, trigger: 'manual', status: 'created', message: null },
      restoredOutcome(4),
      restoredOutcome(5),
    ] as unknown as TaskScheduleDraft['history']

    const saved = await saveTaskSchedule(api, {
      projectId,
      schedule: {
        id: 'schedule-restored-history',
        title: 'Daily triage',
        prompt: 'Review incoming dependencies',
        preset: 'daily',
        timeOfDay: '09:00',
        mode: 'create-only',
        enabled: true,
        createdAt: Date.UTC(2025, 11, 31, 8),
        lastFireAt: Date.UTC(2026, 0, 1, 8),
        lastTaskId: 'T-previous',
        history: restoredHistory,
      },
    }, Date.UTC(2026, 0, 1, 10))

    expect(saved.history).toEqual([
      restoredOutcome(1),
      restoredOutcome(2),
      restoredOutcome(3),
      restoredOutcome(4),
      restoredOutcome(5),
    ])
    await expect(listTaskSchedules(api, { projectId })).resolves.toContainEqual(expect.objectContaining({
      id: 'schedule-restored-history',
      history: saved.history,
    }))
  })

  it('Run now creates a normal Task with the scheduled label and starts implementation by default', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    await setStoredSchedules(api, [makeSchedule()])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'started', taskId: 'mock-task-1', trigger: 'manual' })
    expect(api.__testing.calls.taskCreations).toEqual([
      { initialPrompt: 'Review incoming dependencies', projectId, labelNames: ['scheduled'] },
    ])
    expect(api.__testing.calls.taskImplementationStarts).toEqual([{ taskId: 'mock-task-1' }])
  })

  it('create-only Scheduled Fires do not start implementation', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    await setStoredSchedules(api, [makeSchedule({ mode: 'create-only' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome.status).toBe('created')
    expect(api.__testing.calls.taskImplementationStarts).toEqual([])
  })

  it('skips a Scheduled Fire when the previous scheduled Task is not done', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => makeScheduleTask('T-open', 'doing'))
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-open' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'skipped', taskId: 'T-open' })
    expect(api.__testing.calls.taskCreations).toEqual([])
  })

  it('background processing scans project-scoped schedules without needing an active project context', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId: null })
    api.projects.list = vi.fn(async () => [{ id: projectId, name: 'Project', path: '/repo', created_at: 0, updated_at: 0 }])
    await setStoredSchedules(api, [makeSchedule({ nextFireAt: Date.UTC(2025, 11, 28, 9) })])

    const outcomes = await processDueSchedulesForAllProjects(api, Date.UTC(2026, 0, 1, 10))

    expect(outcomes).toHaveLength(1)
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('processes at most one missed Scheduled Fire and advances the next fire after restart', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    await setStoredSchedules(api, [
      makeSchedule({ nextFireAt: Date.UTC(2025, 11, 28, 9) }),
    ])

    const outcomes = await processDueSchedules(api, projectId, Date.UTC(2026, 0, 1, 10))
    const [saved] = await listTaskSchedules(api, { projectId })

    expect(outcomes).toHaveLength(1)
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
    expect(saved.nextFireAt).toBeGreaterThan(Date.UTC(2026, 0, 1, 10))
  })

  it('keeps only the last five outcomes', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const history = Array.from({ length: 5 }, (_, index) => ({
      id: `outcome-${index}`,
      firedAt: index,
      trigger: 'manual' as const,
      status: 'created' as const,
      taskId: `T-${index}`,
      message: `Created T-${index}`,
    }))
    await setStoredSchedules(api, [makeSchedule({ history })])

    await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))
    const [saved] = await listTaskSchedules(api, { projectId })

    expect(saved.history).toHaveLength(5)
    expect(saved.history.map((outcome) => outcome.id)).not.toContain('outcome-0')
  })
})

async function setStoredSchedules(api: BackendOpenForgeAPI, schedules: TaskSchedule[]) {
  await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as never)
}

function makeScheduleTask(id: string, status: 'backlog' | 'doing' | 'done') {
  return {
    id,
    status,
    initial_prompt: 'prompt',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    depends_on: [],
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
  }
}
