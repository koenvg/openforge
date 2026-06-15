export type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'custom'
export type TaskScheduleMode = 'create-and-start' | 'create-only'
export type ScheduledFireTrigger = 'scheduled' | 'manual'
export type ScheduledFireStatus = 'started' | 'created' | 'skipped' | 'failed'

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
  preset: SchedulePreset
  cron: string
  mode: TaskScheduleMode
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextFireAt: number
  lastFireAt: number | null
  lastTaskId: string | null
  history: ScheduledFireOutcome[]
}

export interface TaskScheduleDraft {
  id?: string | null
  title: string
  prompt: string
  preset: SchedulePreset
  cron?: string | null
  timeOfDay?: string | null
  mode?: TaskScheduleMode | null
  enabled?: boolean | null
}
