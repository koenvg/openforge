import type {
  ActiveTaskSchedule,
  CancelledTaskSchedule,
  CompletedTaskSchedule,
  TaskSchedule,
  TaskScheduleTiming,
} from './types'

export type TerminalTaskSchedule = Exclude<TaskSchedule, ActiveTaskSchedule>
export type TerminalOneOffTaskSchedule = (CompletedTaskSchedule | CancelledTaskSchedule) & {
  timing: Extract<TaskScheduleTiming, { type: 'once' }>
}

export function isTerminalTaskSchedule(schedule: TaskSchedule): schedule is TerminalTaskSchedule {
  return schedule.lifecycle.state !== 'active'
}

export function isTerminalOneOffTaskSchedule(schedule: TaskSchedule): schedule is TerminalOneOffTaskSchedule {
  return schedule.timing.type === 'once' && isTerminalTaskSchedule(schedule)
}
