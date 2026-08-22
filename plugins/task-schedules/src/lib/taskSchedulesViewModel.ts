import { dayOfWeekFromCron, describeCronExpression, timeOfDayFromCron, validateCronCadence, validateFiveFieldCron } from './cron'
import { isTerminalOneOffTaskSchedule, isTerminalTaskSchedule } from './taskScheduleLifecycle'
import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft } from './types'
import type {
  OneOffScheduleDraftTiming,
  RecurringScheduleDraftTiming,
  ScheduleDraft,
  ScheduleDraftTiming,
  ScheduleFieldErrors,
  ScheduleFilter,
  ScheduleRunState,
  ScheduleSortKey,
  SortDirection,
} from './viewTypes'

export const CRON_HELP_TEXT = 'Use five fields: minute hour day-of-month month day-of-week. Runs at most once every 5 minutes.'
export const TERMINAL_ONE_OFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = Math.floor(index / 4)
  const minute = (index % 4) * 15
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
})

export const DAY_OF_WEEK_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

export function emptyScheduleDraftTiming(): RecurringScheduleDraftTiming
export function emptyScheduleDraftTiming(type: 'recurring'): RecurringScheduleDraftTiming
export function emptyScheduleDraftTiming(type: 'once'): OneOffScheduleDraftTiming
export function emptyScheduleDraftTiming(type: ScheduleDraftTiming['type'] = 'recurring'): ScheduleDraftTiming {
  if (type === 'once') return { type, runAt: '', originalRunAt: null }
  return {
    type,
    preset: 'daily',
    cron: '0 9 * * *',
    timeOfDay: '09:00',
    dayOfWeek: 1,
    advancedCron: false,
  }
}

export function emptyScheduleDraft(): ScheduleDraft {
  return {
    id: null,
    title: '',
    prompt: '',
    timing: emptyScheduleDraftTiming(),
    mode: 'create-and-start',
    enabled: true,
  }
}

export function emptyScheduleFieldErrors(): ScheduleFieldErrors {
  return { cron: null, runAt: null }
}

export function draftFromSchedule(schedule: TaskSchedule): ScheduleDraft {
  const timing: ScheduleDraftTiming = schedule.timing.type === 'recurring'
    ? {
        ...schedule.timing,
        preset: schedule.timing.preset === 'custom' ? 'daily' : schedule.timing.preset,
        timeOfDay: timeOfDayFromCron(schedule.timing.cron),
        dayOfWeek: schedule.timing.preset === 'weekly' ? dayOfWeekFromCron(schedule.timing.cron) : 1,
        advancedCron: schedule.timing.preset === 'custom',
      }
    : {
        type: 'once',
        runAt: localDateTimeValue(schedule.timing.runAt),
        originalRunAt: schedule.timing.runAt,
      }
  return {
    id: schedule.id,
    title: schedule.title,
    prompt: schedule.prompt,
    timing,
    mode: schedule.mode,
    enabled: schedule.lifecycle.state === 'active' && schedule.lifecycle.enabled,
  }
}

export function draftToPayload(draft: ScheduleDraft): TaskScheduleDraft {
  const { timing } = draft
  const runAt = timing.type !== 'once'
    ? null
    : timing.originalRunAt !== null && timing.runAt === localDateTimeValue(timing.originalRunAt)
      ? timing.originalRunAt
      : new Date(timing.runAt).getTime()
  return {
    id: draft.id,
    title: draft.title,
    prompt: draft.prompt,
    kind: timing.type,
    runAt,
    preset: timing.type === 'recurring' ? (timing.advancedCron ? 'custom' : timing.preset) : null,
    cron: timing.type === 'recurring' && timing.advancedCron ? timing.cron : null,
    timeOfDay: timing.type === 'recurring' && !timing.advancedCron ? timing.timeOfDay : null,
    dayOfWeek: timing.type === 'recurring' && !timing.advancedCron && timing.preset === 'weekly' ? timing.dayOfWeek : null,
    mode: draft.mode,
    enabled: draft.enabled,
  }
}

export function draftCronError(draft: ScheduleDraft, now = Date.now()): string | null {
  const { timing } = draft
  if (timing.type !== 'recurring' || !timing.advancedCron) return null
  if (!validateFiveFieldCron(timing.cron).valid) return CRON_HELP_TEXT
  const cadence = validateCronCadence(timing.cron, now)
  return cadence.valid ? null : cadence.error
}

export function draftRunAtError(draft: ScheduleDraft, now = Date.now()): string | null {
  const { timing } = draft
  if (timing.type !== 'once') return null
  if (!timing.runAt.trim()) return 'Choose when this Task Schedule should run.'
  const runAt = new Date(timing.runAt).getTime()
  if (!Number.isFinite(runAt)) return 'Enter a valid date and time.'
  return runAt > now ? null : 'Choose a date and time in the future.'
}

function localDateTimeValue(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function schedulesWithinOneOffRetention(schedules: TaskSchedule[], now = Date.now()): TaskSchedule[] {
  return schedules.filter((schedule) => {
    if (!isTerminalOneOffTaskSchedule(schedule)) return true
    const terminalAt = schedule.lifecycle.state === 'completed'
      ? schedule.lifecycle.completedAt
      : schedule.lifecycle.cancelledAt
    return now - terminalAt < TERMINAL_ONE_OFF_RETENTION_MS
  })
}

export function isScheduleEnabled(schedule: TaskSchedule): boolean {
  return schedule.lifecycle.state === 'active' && schedule.lifecycle.enabled
}

export function nextScheduleFireAt(schedule: TaskSchedule): number | null {
  return schedule.lifecycle.state === 'active' ? schedule.lifecycle.nextFireAt : null
}

export function visibleSchedules(
  schedules: TaskSchedule[],
  filter: ScheduleFilter,
  sortKey: ScheduleSortKey,
  sortDirection: SortDirection,
): TaskSchedule[] {
  const filtered = schedules.filter((schedule) => {
    if (filter === 'enabled' && !isScheduleEnabled(schedule)) return false
    if (filter === 'paused' && (isTerminalTaskSchedule(schedule) || schedule.lifecycle.enabled)) return false
    return true
  })
  return [...filtered].sort((a, b) => compareSchedules(a, b, sortKey, sortDirection))
}

function compareSchedules(
  a: TaskSchedule,
  b: TaskSchedule,
  sortKey: ScheduleSortKey,
  sortDirection: SortDirection,
): number {
  let comparison = 0
  if (sortKey === 'title') comparison = a.title.localeCompare(b.title)
  else if (sortKey === 'cadence') comparison = cadenceLabel(a).localeCompare(cadenceLabel(b))
  else if (sortKey === 'mode') comparison = a.mode.localeCompare(b.mode)
  else if (sortKey === 'nextFireAt') comparison = (nextScheduleFireAt(a) ?? Number.MAX_SAFE_INTEGER) - (nextScheduleFireAt(b) ?? Number.MAX_SAFE_INTEGER)
  else if (sortKey === 'lastResult') comparison = (a.history.at(-1)?.firedAt ?? 0) - (b.history.at(-1)?.firedAt ?? 0)
  else comparison = Number(isScheduleEnabled(b)) - Number(isScheduleEnabled(a))
  if (comparison === 0) comparison = a.title.localeCompare(b.title)
  return sortDirection === 'ascending' ? comparison : -comparison
}

export function cadenceLabel(schedule: TaskSchedule): string {
  const timing = schedule.timing
  if (timing.type === 'once') return 'One time'
  if (timing.preset === 'custom') return 'Custom'
  const time = timeOfDayFromCron(timing.cron)
  if (timing.preset === 'weekly') {
    const day = DAY_OF_WEEK_OPTIONS.find((option) => option.value === dayOfWeekFromCron(timing.cron))?.label ?? 'Weekly'
    return `${day} · ${time}`
  }
  if (timing.preset === 'monthly') return `Monthly · ${time}`
  return `Daily · ${time}`
}

export function cadenceDescription(schedule: TaskSchedule): string | null {
  if (schedule.timing.type === 'once') return `Runs once on ${formatScheduleDate(schedule.timing.runAt)}`
  return schedule.timing.preset === 'custom' ? describeCronExpression(schedule.timing.cron) : null
}

export function scheduleStatusLabel(schedule: TaskSchedule): 'Enabled' | 'Paused' | 'Completed' | 'Cancelled' {
  if (schedule.lifecycle.state === 'cancelled') return 'Cancelled'
  if (schedule.lifecycle.state === 'completed') return 'Completed'
  return schedule.lifecycle.enabled ? 'Enabled' : 'Paused'
}

export function formatScheduleDate(value: number | null): string {
  if (value === null) return 'Never'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function runStateFromOutcome(scheduleId: string, outcome: ScheduledFireOutcome): ScheduleRunState {
  if (outcome.status === 'failed') return { scheduleId, phase: 'failure', message: outcome.message }
  if (outcome.status === 'skipped') return { scheduleId, phase: 'warning', message: outcome.message }
  if (outcome.status === 'cancelled') return { scheduleId, phase: 'cancelled', message: outcome.message }
  return { scheduleId, phase: 'success', message: outcome.message }
}

export function messageForAsyncError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function isCronError(cause: unknown): boolean {
  const message = messageForAsyncError(cause).toLowerCase()
  return message.includes('cron') || message.includes('schedule preset') || message.includes('field')
}
