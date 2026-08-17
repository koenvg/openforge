import { dayOfWeekFromCron, describeCronExpression, timeOfDayFromCron, validateCronCadence, validateFiveFieldCron } from './cron'
import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft } from './types'
import type { ScheduleDraft, ScheduleFilter, ScheduleRunState, ScheduleSortKey, SortDirection } from './viewTypes'

export const CRON_HELP_TEXT = 'Use five fields: minute hour day-of-month month day-of-week. Runs at most once every 5 minutes.'

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

export function emptyScheduleDraft(): ScheduleDraft {
  return {
    id: null,
    title: '',
    prompt: '',
    preset: 'daily',
    cron: '0 9 * * *',
    timeOfDay: '09:00',
    dayOfWeek: 1,
    advancedCron: false,
    mode: 'create-and-start',
    enabled: true,
  }
}

export function draftFromSchedule(schedule: TaskSchedule): ScheduleDraft {
  return {
    id: schedule.id,
    title: schedule.title,
    prompt: schedule.prompt,
    preset: schedule.preset === 'custom' ? 'daily' : schedule.preset,
    cron: schedule.cron,
    timeOfDay: timeOfDayFromCron(schedule.cron),
    dayOfWeek: schedule.preset === 'weekly' ? dayOfWeekFromCron(schedule.cron) : 1,
    advancedCron: schedule.preset === 'custom',
    mode: schedule.mode,
    enabled: schedule.enabled,
  }
}

export function draftToPayload(draft: ScheduleDraft): TaskScheduleDraft {
  return {
    id: draft.id,
    title: draft.title,
    prompt: draft.prompt,
    preset: draft.advancedCron ? 'custom' : draft.preset,
    cron: draft.advancedCron ? draft.cron : null,
    timeOfDay: draft.advancedCron ? null : draft.timeOfDay,
    dayOfWeek: !draft.advancedCron && draft.preset === 'weekly' ? draft.dayOfWeek : null,
    mode: draft.mode,
    enabled: draft.enabled,
  }
}

export function draftCronError(draft: ScheduleDraft, now = Date.now()): string | null {
  if (!draft.advancedCron) return null
  if (!validateFiveFieldCron(draft.cron).valid) return CRON_HELP_TEXT
  const cadence = validateCronCadence(draft.cron, now)
  return cadence.valid ? null : cadence.error
}

export function visibleSchedules(
  schedules: TaskSchedule[],
  filter: ScheduleFilter,
  sortKey: ScheduleSortKey,
  sortDirection: SortDirection,
): TaskSchedule[] {
  const filtered = schedules.filter((schedule) => {
    if (filter === 'enabled' && !schedule.enabled) return false
    if (filter === 'paused' && schedule.enabled) return false
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
  else if (sortKey === 'nextFireAt') comparison = a.nextFireAt - b.nextFireAt
  else if (sortKey === 'lastResult') comparison = (a.history.at(-1)?.firedAt ?? 0) - (b.history.at(-1)?.firedAt ?? 0)
  else comparison = Number(b.enabled) - Number(a.enabled)
  if (comparison === 0) comparison = a.title.localeCompare(b.title)
  return sortDirection === 'ascending' ? comparison : -comparison
}

export function cadenceLabel(schedule: TaskSchedule): string {
  if (schedule.preset === 'custom') return 'Custom'
  const time = timeOfDayFromCron(schedule.cron)
  if (schedule.preset === 'weekly') {
    const day = DAY_OF_WEEK_OPTIONS.find((option) => option.value === dayOfWeekFromCron(schedule.cron))?.label ?? 'Weekly'
    return `${day} · ${time}`
  }
  if (schedule.preset === 'monthly') return `Monthly · ${time}`
  return `Daily · ${time}`
}

export function cadenceDescription(schedule: TaskSchedule): string | null {
  return schedule.preset === 'custom' ? describeCronExpression(schedule.cron) : null
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
