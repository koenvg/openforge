import { cronForPreset, getNextScheduledFireAt, validateCronCadence, validateFiveFieldCron } from '../lib/cron'
import type { ActiveTaskSchedule, ScheduledFireOutcome, SchedulePreset, TaskSchedule, TaskScheduleBase, TaskScheduleDraft, TaskScheduleMode, TaskScheduleTiming } from '../lib/types'
import { createId } from './ids'

export function normalizeScheduleDraft(draft: TaskScheduleDraft, existing: ActiveTaskSchedule | null, now: number): ActiveTaskSchedule {
  const title = requireTrimmedString(draft.title, 'Task Schedule title is required')
  const prompt = requireTrimmedString(draft.prompt, 'Task Schedule prompt is required')
  const kind = draft.kind ?? existing?.timing.type ?? 'recurring'
  if (kind !== 'recurring' && kind !== 'once') {
    throw new Error('Task Schedule kind must be recurring or once')
  }

  let timing: TaskScheduleTiming
  let nextFireAt: number
  if (kind === 'once') {
    const runAt = draft.runAt ?? (existing?.timing.type === 'once' ? existing.timing.runAt : null)
    if (typeof runAt !== 'number' || !Number.isFinite(runAt)) {
      throw new Error('One-off Task Schedule time is required')
    }
    if (runAt <= now) throw new Error('One-off Task Schedule time must be in the future')
    timing = { type: 'once', runAt }
    nextFireAt = runAt
  } else {
    const preset = draft.preset ?? (existing?.timing.type === 'recurring' ? existing.timing.preset : null) ?? 'daily'
    if (!isSchedulePreset(preset)) {
      throw new Error('Task Schedule preset must be daily, weekly, monthly, or custom')
    }
    const cron = preset === 'custom'
      ? requireTrimmedString(draft.cron ?? (existing?.timing.type === 'recurring' ? existing.timing.cron : null), 'Custom Task Schedule cron is required')
      : cronForPreset(preset, draft.timeOfDay ?? '09:00', draft.dayOfWeek ?? 1)
    const validation = validateFiveFieldCron(cron)
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid custom Schedule Preset')
    }
    const cadence = validateCronCadence(cron, now)
    if (!cadence.valid) {
      throw new Error(cadence.error ?? 'Task Schedule cadence is too frequent')
    }
    timing = { type: 'recurring', preset, cron }
    nextFireAt = getNextScheduledFireAt(cron, now)
  }

  const mode: TaskScheduleMode = draft.mode ?? 'create-and-start'
  if (mode !== 'create-and-start' && mode !== 'create-only') {
    throw new Error('Task Schedule mode must be create-and-start or create-only')
  }
  const enabled = draft.enabled ?? existing?.lifecycle.enabled ?? true

  return {
    id: existing?.id ?? createId('schedule', now),
    title,
    prompt,
    timing,
    mode,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastTaskId: existing?.lastTaskId ?? null,
    idempotencyKey: draft.idempotencyKey ?? existing?.idempotencyKey ?? null,
    history: existing?.history ?? [],
    lifecycle: {
      state: 'active',
      enabled,
      nextFireAt,
      ...(existing?.lifecycle.lastFireAt === undefined ? {} : { lastFireAt: existing.lifecycle.lastFireAt }),
    },
  }
}

export function normalizeStoredSchedule(value: unknown): TaskSchedule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const stored = value as Record<string, unknown>
  if (typeof stored.id !== 'string' ||
    typeof stored.title !== 'string' ||
    typeof stored.prompt !== 'string' ||
    (stored.mode !== 'create-and-start' && stored.mode !== 'create-only') ||
    typeof stored.createdAt !== 'number' ||
    typeof stored.updatedAt !== 'number' ||
    !Array.isArray(stored.history)) return null

  const timing = normalizeStoredTiming(stored)
  if (!timing) return null
  const lifecycle = normalizeStoredLifecycle(stored, timing)
  if (!lifecycle) return null

  const base: TaskScheduleBase = {
    id: stored.id,
    title: stored.title,
    prompt: stored.prompt,
    mode: stored.mode,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    lastTaskId: typeof stored.lastTaskId === 'string' ? stored.lastTaskId : null,
    idempotencyKey: typeof stored.idempotencyKey === 'string' ? stored.idempotencyKey : null,
    history: stored.history as ScheduledFireOutcome[],
  }
  if (lifecycle.state === 'active') return { ...base, timing, lifecycle }
  if (lifecycle.state === 'cancelled') return { ...base, timing, lifecycle }
  if (timing.type !== 'once') return null
  return { ...base, timing, lifecycle }
}

export function isActiveTaskSchedule(schedule: TaskSchedule): schedule is ActiveTaskSchedule {
  return schedule.lifecycle.state === 'active'
}

export function completeOneOffSchedule(schedule: ActiveTaskSchedule, completedAt: number): TaskSchedule {
  if (schedule.timing.type !== 'once') throw new Error('Only one-off Task Schedules can be completed')
  return { ...schedule, timing: schedule.timing, lifecycle: { state: 'completed', completedAt } }
}

function normalizeStoredTiming(stored: Record<string, unknown>): TaskScheduleTiming | null {
  const timing = stored.timing
  if (timing && typeof timing === 'object' && !Array.isArray(timing)) {
    const candidate = timing as Record<string, unknown>
    if (candidate.type === 'once' && typeof candidate.runAt === 'number') {
      return { type: 'once', runAt: candidate.runAt }
    }
    if (candidate.type === 'recurring' && isSchedulePreset(candidate.preset) && typeof candidate.cron === 'string') {
      return { type: 'recurring', preset: candidate.preset, cron: candidate.cron }
    }
    return null
  }

  if (stored.kind === 'once' && typeof stored.runAt === 'number') {
    return { type: 'once', runAt: stored.runAt }
  }
  if (stored.kind !== 'once' && typeof stored.cron === 'string') {
    return {
      type: 'recurring',
      preset: isSchedulePreset(stored.preset) ? stored.preset : 'custom',
      cron: stored.cron,
    }
  }
  return null
}

function normalizeStoredLifecycle(stored: Record<string, unknown>, timing: TaskScheduleTiming): TaskSchedule['lifecycle'] | null {
  const lifecycle = stored.lifecycle
  if (lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)) {
    const candidate = lifecycle as Record<string, unknown>
    if (candidate.state === 'active' && typeof candidate.enabled === 'boolean' && typeof candidate.nextFireAt === 'number') {
      return {
        state: 'active',
        enabled: candidate.enabled,
        nextFireAt: candidate.nextFireAt,
        ...(typeof candidate.lastFireAt === 'number' ? { lastFireAt: candidate.lastFireAt } : {}),
      }
    }
    if (candidate.state === 'completed' && timing.type === 'once' && typeof candidate.completedAt === 'number') {
      return { state: 'completed', completedAt: candidate.completedAt }
    }
    if (candidate.state === 'cancelled' && typeof candidate.cancelledAt === 'number') {
      return {
        state: 'cancelled',
        cancelledAt: candidate.cancelledAt,
        ...(typeof candidate.lastFireAt === 'number' ? { lastFireAt: candidate.lastFireAt } : {}),
      }
    }
    return null
  }

  if (typeof stored.cancelledAt === 'number') {
    return {
      state: 'cancelled',
      cancelledAt: stored.cancelledAt,
      ...(typeof stored.lastFireAt === 'number' ? { lastFireAt: stored.lastFireAt } : {}),
    }
  }
  if (timing.type === 'once' && typeof stored.lastFireAt === 'number') {
    return { state: 'completed', completedAt: stored.lastFireAt }
  }
  if (typeof stored.enabled !== 'boolean' || typeof stored.nextFireAt !== 'number') return null
  return {
    state: 'active',
    enabled: stored.enabled,
    nextFireAt: stored.nextFireAt,
    ...(typeof stored.lastFireAt === 'number' ? { lastFireAt: stored.lastFireAt } : {}),
  }
}

export function requireTrimmedString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

export function optionalTrimmedString(value: unknown, message: string): string | null {
  if (value === undefined || value === null) return null
  return requireTrimmedString(value, message)
}

export function parseFutureRunAt(value: unknown, now: number): number {
  const timestamp = requireTrimmedString(value, 'One-off timing.at must be an RFC 3339 timestamp')
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(timestamp)
  if (!match) throw new Error('One-off timing.at must be an RFC 3339 timestamp with a timezone')

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', , offsetSign, offsetHourText = '0', offsetMinuteText = '0'] = match
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ].map(Number)
  const millisecond = Number(fraction.padEnd(3, '0').slice(0, 3))
  const calendarSecond = second === 60 ? 59 : second
  const calendarTime = Date.UTC(year, month - 1, day, hour, minute, calendarSecond, millisecond)
  const localDate = new Date(calendarTime)
  const calendarIsValid = localDate.getUTCFullYear() === year &&
    localDate.getUTCMonth() === month - 1 &&
    localDate.getUTCDate() === day &&
    localDate.getUTCHours() === hour &&
    localDate.getUTCMinutes() === minute &&
    localDate.getUTCSeconds() === calendarSecond &&
    second <= 60 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  const localTime = calendarTime + (second === 60 ? 1_000 : 0)
  if (!calendarIsValid) throw new Error('One-off timing.at must be a valid RFC 3339 timestamp')

  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (offsetSign === '-' ? -1 : 1)
  const runAt = localTime - offset
  if (runAt <= now) throw new Error('One-off timing.at must be in the future')
  return runAt
}

function isSchedulePreset(value: unknown): value is SchedulePreset {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom'
}

