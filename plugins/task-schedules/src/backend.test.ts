import { describe, expect, it, vi } from 'vitest'
import { createMockBackendOpenForgeApi, createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
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
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { Task } from '@openforge-app/plugin-sdk'
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
      lastFireAt: null,
      lastTaskId: null,
      history: [],
    })
    await expect(listTaskSchedules(api, { projectId })).resolves.toEqual([saved])
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

  it('skips a Scheduled Fire when the previous scheduled Task is still open', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => makeScheduleTask('T-open', 'doing'))
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-open' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'skipped', taskId: 'T-open' })
    expect(api.__testing.calls.taskCreations).toEqual([])
  })

  it('fires again after the previous scheduled Task was completed and deleted', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async (taskId: string) => { throw new Error(`task not found: ${taskId}`) })
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-completed' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'started', taskId: 'mock-task-1', trigger: 'manual' })
    expect(api.__testing.calls.taskCreations).toEqual([
      { initialPrompt: 'Review incoming dependencies', projectId, labelNames: ['scheduled'] },
    ])
  })

  it('does not skip a due background Scheduled Fire when the previous scheduled Task was deleted', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async (taskId: string) => { throw new Error(`task not found: ${taskId}`) })
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-completed', nextFireAt: Date.UTC(2025, 11, 28, 9) })])

    const outcomes = await processDueSchedules(api, projectId, Date.UTC(2026, 0, 1, 10))

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'started', trigger: 'scheduled' })
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('fires when the previous scheduled Task still resolves but is already done', async () => {
    // 'done' is a recognized-but-unreachable status after AVIV-118: only legacy
    // rows can still resolve as 'done'. Such a last Task counts as closed.
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => makeScheduleTask('T-done', 'done'))
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-done' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'started', taskId: 'mock-task-1' })
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('treats any failure to load the previous scheduled Task as closed so the schedule keeps firing', async () => {
    // Any tasks.get rejection (not only 'task not found') is treated as closed:
    // permanently skipping is the worse outcome, so an unreadable last Task must
    // not block future fires.
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => { throw new Error('failed to get task: database is locked') })
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-unreadable' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'started', taskId: 'mock-task-1' })
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
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

function makeScheduleTask(id: string, status: 'backlog' | 'doing' | 'done'): Task {
  return {
    id,
    status,
    initial_prompt: 'prompt',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
  }
}
