import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { TaskSchedule, TaskScheduleBase, TaskScheduleTiming } from '../lib/types'
import { SCHEDULES_STORAGE_KEY } from './schedulePersistence'

export const projectId = 'P-1'

type ScheduleOverrides = Partial<TaskScheduleBase> & {
  timing?: TaskScheduleTiming
  lifecycle?: TaskSchedule['lifecycle']
}

export function makeSchedule(overrides: ScheduleOverrides = {}): TaskSchedule {
  const {
    timing = { type: 'recurring', preset: 'daily', cron: '0 9 * * *' },
    lifecycle = { state: 'active', enabled: true, nextFireAt: Date.UTC(2026, 0, 1, 9) },
    ...baseOverrides
  } = overrides
  return {
    id: 'schedule-1',
    title: 'Daily triage',
    prompt: 'Review incoming dependencies',
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

export async function setStoredSchedules(api: BackendOpenForgeAPI, schedules: TaskSchedule[]) {
  await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as never)
}

