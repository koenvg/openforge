import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import { isTerminalTaskSchedule } from '../lib/taskScheduleLifecycle'
import type { ScheduleCommandInput, TaskSchedule, TaskScheduleDraft, UpdateScheduleCommandInput } from '../lib/types'
import { readSchedules, saveTaskSchedule, writeSchedules } from './schedulePersistence'
import { optionalTrimmedString, parseFutureRunAt } from './scheduleValidation'

export function createAgentScheduleRunner(openforge: BackendOpenForgeAPI) {
  const pendingByIdempotencyKey = new Map<string, Promise<TaskSchedule>>()
  return {
    schedule(projectId: string, input: ScheduleCommandInput, now = Date.now()): Promise<TaskSchedule> {
      const idempotencyKey = optionalTrimmedString(input.idempotencyKey, 'idempotencyKey must be a non-empty string')
      if (!idempotencyKey) return scheduleTaskFromCommand(openforge, projectId, input, now)

      const key = `${projectId}:${idempotencyKey}`
      const pending = pendingByIdempotencyKey.get(key)
      if (pending) return pending

      const scheduled = scheduleTaskFromCommand(openforge, projectId, input, now)
      pendingByIdempotencyKey.set(key, scheduled)
      const clear = () => {
        if (pendingByIdempotencyKey.get(key) === scheduled) pendingByIdempotencyKey.delete(key)
      }
      void scheduled.then(clear, clear)
      return scheduled
    },
  }
}

export async function scheduleTaskFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  input: ScheduleCommandInput,
  now = Date.now(),
): Promise<TaskSchedule> {
  const idempotencyKey = optionalTrimmedString(input.idempotencyKey, 'idempotencyKey must be a non-empty string')
  if (idempotencyKey) {
    const existing = (await readSchedules(openforge, projectId))
      .find((schedule) => schedule.idempotencyKey === idempotencyKey)
    if (existing) return existing
  }

  const timing = input.timing
  if (timing.type === 'once') {
    return saveTaskSchedule(openforge, {
      projectId,
      schedule: {
        title: input.title,
        prompt: input.prompt,
        kind: 'once',
        runAt: parseFutureRunAt(timing.at, now),
        mode: input.mode,
        idempotencyKey,
      },
    }, now)
  }

  return saveTaskSchedule(openforge, {
    projectId,
    schedule: {
      title: input.title,
      prompt: input.prompt,
      kind: 'recurring',
      preset: 'custom',
      cron: timing.cron,
      mode: input.mode,
      idempotencyKey,
    },
  }, now)
}

export async function updateScheduleFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  input: UpdateScheduleCommandInput,
  now = Date.now(),
): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, projectId)
  const existing = schedules.find((schedule) => schedule.id === input.scheduleId)
  if (!existing) throw new Error('Task Schedule not found')
  if (isTerminalTaskSchedule(existing)) {
    throw new Error('Completed or cancelled Task Schedules cannot be updated')
  }
  if (input.timing && input.timing.type !== existing.timing.type) {
    throw new Error('Task Schedule timing type cannot be changed')
  }

  const draft: TaskScheduleDraft = {
    id: existing.id,
    title: input.title ?? existing.title,
    prompt: input.prompt ?? existing.prompt,
    kind: existing.timing.type,
    mode: input.mode ?? existing.mode,
    enabled: existing.lifecycle.enabled,
    idempotencyKey: existing.idempotencyKey,
    ...(existing.timing.type === 'recurring'
      ? { preset: existing.timing.preset, cron: existing.timing.cron }
      : { runAt: existing.timing.runAt }),
  }
  if (input.timing?.type === 'once') draft.runAt = parseFutureRunAt(input.timing.at, now)
  if (input.timing?.type === 'recurring') {
    draft.preset = 'custom'
    draft.cron = input.timing.cron
  }
  return saveTaskSchedule(openforge, { projectId, schedule: draft }, now)
}

export async function cancelScheduleFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  scheduleId: string,
  now = Date.now(),
): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, projectId)
  const existing = schedules.find((schedule) => schedule.id === scheduleId)
  if (!existing) throw new Error('Task Schedule not found')
  if (isTerminalTaskSchedule(existing)) return existing
  const cancelled: TaskSchedule = {
    ...existing,
    updatedAt: now,
    lifecycle: {
      state: 'cancelled',
      cancelledAt: now,
      ...(existing.lifecycle.lastFireAt === undefined ? {} : { lastFireAt: existing.lifecycle.lastFireAt }),
    },
  }
  await writeSchedules(openforge, projectId, schedules.map((schedule) => schedule.id === scheduleId ? cancelled : schedule))
  return cancelled
}
