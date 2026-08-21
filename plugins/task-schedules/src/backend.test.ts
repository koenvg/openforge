import { describe, expect, it, vi } from 'vitest'
import { createMockBackendOpenForgeApi, createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import backendPlugin, {
  CANCEL_RUN_NOW_METHOD,
  CANCEL_SCHEDULE_COMMAND,
  LIST_SCHEDULES_COMMAND,
  LIST_SCHEDULES_METHOD,
  RUN_NOW_METHOD,
  SAVE_SCHEDULE_METHOD,
  SCHEDULE_COMMAND,
  SCHEDULES_STORAGE_KEY,
  UPDATE_SCHEDULE_COMMAND,
  createGuardedPoll,
  createManualScheduleRunner,
  createScheduledFiresService,
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
    kind: 'recurring',
    preset: 'daily',
    cron: '0 9 * * *',
    runAt: null,
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 1, 9),
    lastFireAt: null,
    lastTaskId: null,
    cancelledAt: null,
    idempotencyKey: null,
    history: [],
    ...overrides,
  }
}


describe('Task Schedules backend plugin', () => {
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
      output: { type: 'object', required: expect.arrayContaining(['id', 'kind', 'nextFireAt']) },
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
        kind: 'once',
        preset: null,
        cron: null,
        runAt,
        nextFireAt: runAt,
        mode: 'create-and-start',
        enabled: true,
        cancelledAt: null,
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

      expect(scheduled.runAt).toBe(Date.UTC(2027, 0, 1, 0, 0))
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
        kind: 'recurring',
        preset: 'custom',
        cron: '0 9 * * 1',
        runAt: null,
        mode: 'create-only',
      })
      expect(scheduled.nextFireAt).toBeGreaterThan(Date.now())
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
        kind: 'recurring',
        cron: '0 10 * * 2',
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
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      enabled: false,
      nextFireAt: null,
      lastFireAt: runAt,
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
      enabled: false,
      cancelledAt: Date.UTC(2026, 0, 1, 9),
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
        kind: 'once',
        preset: null,
        cron: null,
        runAt,
        nextFireAt: runAt,
      })])

      const cancelled = await registry.backendApi.commands.invoke<TaskSchedule>(CANCEL_SCHEDULE_COMMAND, {
        scheduleId: 'schedule-1',
      })

      expect(cancelled).toMatchObject({
        id: 'schedule-1',
        enabled: false,
        cancelledAt: now,
        nextFireAt: runAt,
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
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      enabled: false,
      nextFireAt: null,
      lastFireAt: runAt,
    })])

    const completed = await registry.backendApi.commands.invoke<TaskSchedule>(CANCEL_SCHEDULE_COMMAND, {
      scheduleId: 'schedule-1',
    })

    expect(completed).toMatchObject({ lastFireAt: runAt, cancelledAt: null })
  })

  it.each([
    ['completed', { enabled: false, nextFireAt: null, lastFireAt: Date.UTC(2026, 0, 1, 9), cancelledAt: null }],
    ['cancelled', { enabled: false, nextFireAt: Date.UTC(2026, 0, 2, 9), lastFireAt: null, cancelledAt: Date.UTC(2026, 0, 1, 10) }],
  ] as const)('enforces terminal %s one-off schedules at every backend write boundary', async (_state, terminalState) => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 2, 9)
    await setStoredSchedules(api, [makeSchedule({
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      ...terminalState,
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

    expect(saved).toMatchObject({ preset: 'custom', cron: '*/5 * * * *' })
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

  it('completes a one-off schedule when it is run manually before its due time', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 2, 9)
    const now = Date.UTC(2026, 0, 1, 10)
    await setStoredSchedules(api, [makeSchedule({
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      nextFireAt: runAt,
    })])

    await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, now)
    const [completed] = await listTaskSchedules(api, { projectId })
    const laterOutcomes = await processDueSchedules(api, projectId, runAt + 60_000)

    expect(completed).toMatchObject({ enabled: false, nextFireAt: null, lastFireAt: now })
    expect(laterOutcomes).toEqual([])
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('keeps a one-off schedule pending when a manual run is cancelled before creating a Task', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 2, 9)
    await setStoredSchedules(api, [makeSchedule({
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      nextFireAt: runAt,
    })])

    const outcome = await runScheduleNow(
      api,
      { projectId, scheduleId: 'schedule-1' },
      Date.UTC(2026, 0, 1, 10),
      () => true,
    )
    const [pending] = await listTaskSchedules(api, { projectId })

    expect(outcome.status).toBe('cancelled')
    expect(pending).toMatchObject({ enabled: true, nextFireAt: runAt, lastFireAt: null })
    expect(api.__testing.calls.taskCreations).toEqual([])
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

  it('rejects duplicate manual submissions while the same schedule is already running', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    await setStoredSchedules(api, [makeSchedule()])
    let resolveCreate!: (task: Task) => void
    api.tasks.create = vi.fn(() => new Promise<Task>((resolve) => { resolveCreate = resolve }))
    const runner = createManualScheduleRunner(api)

    const firstRun = runner.run({ projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))
    await vi.waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1))

    await expect(runner.run({ projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))).rejects.toThrow(/already running/i)
    resolveCreate(makeScheduleTask('T-running', 'backlog'))
    await firstRun
  })

  it('cancels a manual create-and-start run at the next safe point without starting implementation', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    await setStoredSchedules(api, [makeSchedule()])
    let resolveCreate!: (task: Task) => void
    api.tasks.create = vi.fn(() => new Promise<Task>((resolve) => { resolveCreate = resolve }))
    const runner = createManualScheduleRunner(api)

    const pendingRun = runner.run({ projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))
    await vi.waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1))
    expect(runner.cancel({ projectId, scheduleId: 'schedule-1' })).toEqual({ cancelled: true })
    resolveCreate(makeScheduleTask('T-cancelled', 'backlog'))

    await expect(pendingRun).resolves.toMatchObject({ status: 'cancelled', taskId: 'T-cancelled' })
    expect(api.__testing.calls.taskImplementationStarts).toEqual([])
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
    // Since AVIV-118, completing a Task deletes it and tasks.get resolves to
    // null. A missing last Task is closed, so the schedule keeps firing.
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => null)
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-completed' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'started', taskId: 'mock-task-1', trigger: 'manual' })
    expect(api.__testing.calls.taskCreations).toEqual([
      { initialPrompt: 'Review incoming dependencies', projectId, labelNames: ['scheduled'] },
    ])
  })

  it('does not skip a due background Scheduled Fire when the previous scheduled Task was deleted', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => null)
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

  it('skips a fire when the previous scheduled Task cannot be verified by a transient error', async () => {
    // A tasks.get rejection that is NOT a missing-Task error (e.g. a locked
    // database) must be treated as "still open, unknown state": firing would
    // spawn a duplicate Task alongside one that may still be running. Only a
    // genuinely missing/deleted Task counts as closed (see the AVIV-118 tests).
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.get = vi.fn(async () => { throw new Error('failed to get task: database is locked') })
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: 'T-unreadable' })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'skipped', taskId: 'T-unreadable' })
    expect(api.__testing.calls.taskCreations).toHaveLength(0)
  })

  it('records the created Task as the last Task when start implementation fails so the next fire is throttled', async () => {
    // The Task is created before implementation starts. If startImplementation
    // throws, the created Task must still be recorded as lastTaskId; otherwise
    // every subsequent fire spawns another orphan Task (the weekend flood).
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.startImplementation = vi.fn(async () => { throw new Error('failed to create worktree') })
    await setStoredSchedules(api, [makeSchedule()])

    const first = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))
    expect(first).toMatchObject({ status: 'failed', taskId: 'mock-task-1' })

    const [afterFirst] = await listTaskSchedules(api, { projectId })
    expect(afterFirst.lastTaskId).toBe('mock-task-1')

    // The created Task is still open, so the next fire must skip rather than
    // create a second Task.
    api.tasks.get = vi.fn(async () => makeScheduleTask('mock-task-1', 'backlog'))
    const second = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 11))

    expect(second).toMatchObject({ status: 'skipped', taskId: 'mock-task-1' })
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('leaves the last Task untouched when Task creation itself fails', async () => {
    // If create throws, no Task exists, so lastTaskId must not change.
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    api.tasks.create = vi.fn(async () => { throw new Error('failed to create task') })
    await setStoredSchedules(api, [makeSchedule({ lastTaskId: null })])

    const outcome = await runScheduleNow(api, { projectId, scheduleId: 'schedule-1' }, Date.UTC(2026, 0, 1, 10))

    expect(outcome).toMatchObject({ status: 'failed' })
    expect(outcome.taskId).toBeUndefined()
    const [saved] = await listTaskSchedules(api, { projectId })
    expect(saved.lastTaskId).toBeNull()
  })

  it('keeps each scheduled-fires registration self-contained so stopping one does not leak or clobber another', async () => {
    vi.useFakeTimers()
    try {
      const apiA = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
      const apiB = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
      apiA.projects.list = vi.fn(async () => [])
      apiB.projects.list = vi.fn(async () => [])

      // Two activations register their own service; each owns its interval.
      const serviceA = createScheduledFiresService(apiA)
      const serviceB = createScheduledFiresService(apiB)

      await serviceA.start()
      await serviceB.start()
      expect(apiA.projects.list).toHaveBeenCalledTimes(1)
      expect(apiB.projects.list).toHaveBeenCalledTimes(1)

      // Stopping A must clear only A's interval, never B's.
      await serviceA.stop?.()
      await vi.advanceTimersByTimeAsync(60_000)

      // A is stopped: no further polls. B keeps polling: it was not clobbered.
      expect(apiA.projects.list).toHaveBeenCalledTimes(1)
      expect(apiB.projects.list).toHaveBeenCalledTimes(2)

      await serviceB.stop?.()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(apiB.projects.list).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('createGuardedPoll runs the body once while a previous run is still in flight', async () => {
    const releases: Array<() => void> = []
    let runCount = 0
    const guarded = createGuardedPoll(() => {
      runCount += 1
      return new Promise<void>((resolve) => { releases.push(resolve) })
    })

    const first = guarded()
    const second = guarded()
    expect(runCount).toBe(1)

    releases.splice(0).forEach((release) => release())
    await Promise.all([first, second])

    const third = guarded()
    expect(runCount).toBe(2)
    releases.splice(0).forEach((release) => release())
    await third
  })

  it('background processing scans project-scoped schedules without needing an active project context', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId: null })
    api.projects.list = vi.fn(async () => [{ id: projectId, name: 'Project', path: '/repo', created_at: 0, updated_at: 0 }])
    await setStoredSchedules(api, [makeSchedule({ nextFireAt: Date.UTC(2025, 11, 28, 9) })])

    const outcomes = await processDueSchedulesForAllProjects(api, Date.UTC(2026, 0, 1, 10))

    expect(outcomes).toHaveLength(1)
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
  })

  it('fires an overdue one-off schedule once and marks it completed', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'com.openforge.task-schedules', projectId })
    const runAt = Date.UTC(2026, 0, 1, 9)
    const now = Date.UTC(2026, 0, 1, 10)
    await setStoredSchedules(api, [makeSchedule({
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      nextFireAt: runAt,
    })])

    const firstOutcomes = await processDueSchedules(api, projectId, now)
    const [completed] = await listTaskSchedules(api, { projectId })
    const secondOutcomes = await processDueSchedules(api, projectId, now + 60_000)

    expect(firstOutcomes).toHaveLength(1)
    expect(secondOutcomes).toEqual([])
    expect(api.__testing.calls.taskCreations).toHaveLength(1)
    expect(completed).toMatchObject({ enabled: false, nextFireAt: null, lastFireAt: now })
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
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
  }
}
