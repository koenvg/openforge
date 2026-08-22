import type { TaskScheduleMode, TaskScheduleTiming } from './types'

export type RecurringScheduleDraftTiming = Extract<TaskScheduleTiming, { type: 'recurring' }> & {
  timeOfDay: string
  dayOfWeek: number
  advancedCron: boolean
}

export type OneOffScheduleDraftTiming = Omit<Extract<TaskScheduleTiming, { type: 'once' }>, 'runAt'> & {
  runAt: string
  originalRunAt: number | null
}

export type ScheduleDraftTiming = RecurringScheduleDraftTiming | OneOffScheduleDraftTiming

export type ScheduleDraft = {
  id: string | null
  title: string
  prompt: string
  timing: ScheduleDraftTiming
  mode: TaskScheduleMode
  enabled: boolean
}

export type ScheduleFieldErrors = {
  cron: string | null
  runAt: string | null
}

export type ScheduleFilter = 'all' | 'enabled' | 'paused'
export type ScheduleSortKey = 'title' | 'cadence' | 'mode' | 'nextFireAt' | 'lastResult' | 'status'
export type SortDirection = 'ascending' | 'descending'

export type RunPhase =
  | 'running'
  | 'cancelling'
  | 'success'
  | 'warning'
  | 'failure'
  | 'cancelled'
  | 'already-running'

export type ScheduleRunState = {
  scheduleId: string
  phase: RunPhase
  message: string
}
