import type {
  TaskSchedule,
  TaskScheduleBase,
  TaskScheduleTiming,
} from '../../../plugins/task-schedules/src/lib/types'

type ScheduleOverrides = Partial<TaskScheduleBase> & {
  timing?: TaskScheduleTiming
  lifecycle?: TaskSchedule['lifecycle']
}

export function createSchedule(overrides: ScheduleOverrides = {}): TaskSchedule {
  const {
    timing = { type: 'recurring', preset: 'daily', cron: '0 9 * * *' },
    lifecycle = {
      state: 'active',
      enabled: true,
      nextFireAt: Date.UTC(2026, 0, 2, 9),
    },
    ...baseOverrides
  } = overrides

  return {
    id: 'schedule-1',
    title: 'Daily dependency triage',
    prompt: 'Review dependency update tasks and create follow-up work.',
    mode: 'create-and-start',
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    lastTaskId: null,
    idempotencyKey: null,
    history: [],
    ...baseOverrides,
    timing,
    lifecycle,
  } as TaskSchedule
}
