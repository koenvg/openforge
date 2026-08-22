import { cronForPreset, getNextScheduledFireAt, validateCronCadence, validateFiveFieldCron } from '../lib/cron'
import type { TaskSchedule, TaskScheduleDraft, TaskScheduleMode } from '../lib/types'
import { createId } from './ids'

export function normalizeScheduleDraft(draft: TaskScheduleDraft, existing: TaskSchedule | null, now: number): TaskSchedule {
  const title = requireTrimmedString(draft.title, 'Task Schedule title is required')
  const prompt = requireTrimmedString(draft.prompt, 'Task Schedule prompt is required')
  const kind = draft.kind ?? existing?.kind ?? 'recurring'
  if (kind !== 'recurring' && kind !== 'once') {
    throw new Error('Task Schedule kind must be recurring or once')
  }

  let preset: TaskSchedule['preset'] = null
  let cron: string | null = null
  let runAt: number | null = null
  let nextFireAt: number
  if (kind === 'once') {
    runAt = draft.runAt ?? (existing?.kind === 'once' ? existing.runAt : null)
    if (typeof runAt !== 'number' || !Number.isFinite(runAt)) {
      throw new Error('One-off Task Schedule time is required')
    }
    if (runAt <= now) throw new Error('One-off Task Schedule time must be in the future')
    nextFireAt = runAt
  } else {
    preset = draft.preset ?? (existing?.kind === 'recurring' ? existing.preset : null) ?? 'daily'
    if (!isSchedulePreset(preset)) {
      throw new Error('Task Schedule preset must be daily, weekly, monthly, or custom')
    }
    cron = preset === 'custom'
      ? requireTrimmedString(draft.cron ?? existing?.cron, 'Custom Task Schedule cron is required')
      : cronForPreset(preset, draft.timeOfDay ?? '09:00', draft.dayOfWeek ?? 1)
    const validation = validateFiveFieldCron(cron)
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid custom Schedule Preset')
    }
    const cadence = validateCronCadence(cron, now)
    if (!cadence.valid) {
      throw new Error(cadence.error ?? 'Task Schedule cadence is too frequent')
    }
    nextFireAt = getNextScheduledFireAt(cron, now)
  }

  const mode: TaskScheduleMode = draft.mode ?? 'create-and-start'
  if (mode !== 'create-and-start' && mode !== 'create-only') {
    throw new Error('Task Schedule mode must be create-and-start or create-only')
  }
  const enabled = draft.enabled ?? existing?.enabled ?? true

  return {
    id: existing?.id ?? createId('schedule', now),
    title,
    prompt,
    kind,
    preset,
    cron,
    runAt,
    mode,
    enabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextFireAt,
    lastFireAt: existing?.lastFireAt ?? null,
    lastTaskId: existing?.lastTaskId ?? null,
    cancelledAt: enabled ? null : existing?.cancelledAt ?? null,
    idempotencyKey: draft.idempotencyKey ?? existing?.idempotencyKey ?? null,
    history: existing?.history ?? [],
  }
}

export function normalizeStoredSchedule(value: unknown): TaskSchedule | null {
  if (!value || typeof value !== 'object') return null
  const schedule = value as Partial<TaskSchedule>
  if (typeof schedule.id !== 'string' ||
    typeof schedule.title !== 'string' ||
    typeof schedule.prompt !== 'string' ||
    !Array.isArray(schedule.history)) return null

  const kind = schedule.kind === 'once' ? 'once' : 'recurring'
  const cron = typeof schedule.cron === 'string' ? schedule.cron : null
  const runAt = typeof schedule.runAt === 'number' ? schedule.runAt : null
  const nextFireAt = typeof schedule.nextFireAt === 'number' ? schedule.nextFireAt : null
  if (kind === 'once' && (runAt === null || (nextFireAt === null && schedule.lastFireAt == null))) return null
  if (kind === 'recurring' && (cron === null || nextFireAt === null)) return null

  return {
    ...schedule,
    kind,
    preset: kind === 'recurring' && isSchedulePreset(schedule.preset) ? schedule.preset : kind === 'recurring' ? 'custom' : null,
    cron,
    runAt,
    nextFireAt,
    cancelledAt: typeof schedule.cancelledAt === 'number' ? schedule.cancelledAt : null,
    idempotencyKey: typeof schedule.idempotencyKey === 'string' ? schedule.idempotencyKey : null,
  } as TaskSchedule
}

export function requireRecurringCron(schedule: TaskSchedule): string {
  if (schedule.kind !== 'recurring' || !schedule.cron) {
    throw new Error('Recurring Task Schedule cron is required')
  }
  return schedule.cron
}

export function isTerminalOneOff(schedule: TaskSchedule): boolean {
  return schedule.kind === 'once' && (schedule.lastFireAt !== null || schedule.cancelledAt !== null)
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

function isSchedulePreset(value: unknown): value is TaskSchedule['preset'] {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom'
}

