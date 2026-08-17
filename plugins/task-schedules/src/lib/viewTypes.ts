import type { SchedulePreset, TaskScheduleMode } from './types'

export type ScheduleDraft = {
  id: string | null
  title: string
  prompt: string
  preset: SchedulePreset
  cron: string
  timeOfDay: string
  dayOfWeek: number
  advancedCron: boolean
  mode: TaskScheduleMode
  enabled: boolean
}

export type ScheduleFieldErrors = {
  cron: string | null
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
