export type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'custom'
export type TaskScheduleKind = 'recurring' | 'once'
export type TaskScheduleMode = 'create-and-start' | 'create-only'
export type ScheduledFireTrigger = 'scheduled' | 'manual'
export type ScheduledFireStatus = 'started' | 'created' | 'skipped' | 'failed' | 'cancelled'

export interface ScheduledFireOutcome {
  id: string
  firedAt: number
  trigger: ScheduledFireTrigger
  status: ScheduledFireStatus
  taskId?: string
  message: string
}

export interface TaskSchedule {
  id: string
  title: string
  prompt: string
  kind: TaskScheduleKind
  preset: SchedulePreset | null
  cron: string | null
  runAt: number | null
  mode: TaskScheduleMode
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextFireAt: number | null
  lastFireAt: number | null
  lastTaskId: string | null
  cancelledAt: number | null
  idempotencyKey: string | null
  history: ScheduledFireOutcome[]
}

export interface TaskScheduleDraft {
  id?: string | null
  title: string
  prompt: string
  kind?: TaskScheduleKind | null
  preset?: SchedulePreset | null
  cron?: string | null
  runAt?: number | null
  timeOfDay?: string | null
  dayOfWeek?: number | null
  mode?: TaskScheduleMode | null
  enabled?: boolean | null
  idempotencyKey?: string | null
}

export type ScheduleCommandTiming =
  | { type: 'once'; at: string }
  | { type: 'recurring'; cron: string }

export interface ScheduleCommandInput {
  title: string
  prompt: string
  timing: ScheduleCommandTiming
  mode?: TaskScheduleMode
  idempotencyKey?: string
}

export interface UpdateScheduleCommandInput {
  scheduleId: string
  title?: string
  prompt?: string
  timing?: ScheduleCommandTiming
  mode?: TaskScheduleMode
}
