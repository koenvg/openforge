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

export interface TaskScheduleBase {
  id: string
  title: string
  prompt: string
  mode: TaskScheduleMode
  createdAt: number
  updatedAt: number
  lastTaskId: string | null
  idempotencyKey: string | null
  history: ScheduledFireOutcome[]
}

export type TaskScheduleTiming =
  | { type: 'recurring'; preset: SchedulePreset; cron: string }
  | { type: 'once'; runAt: number }

export type ActiveTaskScheduleLifecycle = {
  state: 'active'
  enabled: boolean
  nextFireAt: number
  lastFireAt?: number
}

export type CompletedTaskScheduleLifecycle = {
  state: 'completed'
  completedAt: number
}

export type CancelledTaskScheduleLifecycle = {
  state: 'cancelled'
  cancelledAt: number
  lastFireAt?: number
}

export type ActiveTaskSchedule = TaskScheduleBase & {
  timing: TaskScheduleTiming
  lifecycle: ActiveTaskScheduleLifecycle
}

export type CompletedTaskSchedule = TaskScheduleBase & {
  timing: { type: 'once'; runAt: number }
  lifecycle: CompletedTaskScheduleLifecycle
}

export type CancelledTaskSchedule = TaskScheduleBase & {
  timing: TaskScheduleTiming
  lifecycle: CancelledTaskScheduleLifecycle
}

export type TaskSchedule = ActiveTaskSchedule | CompletedTaskSchedule | CancelledTaskSchedule

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
