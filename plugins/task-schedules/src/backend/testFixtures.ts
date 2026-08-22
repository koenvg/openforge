import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { TaskSchedule } from '../lib/types'
import { SCHEDULES_STORAGE_KEY } from './schedulePersistence'

export const projectId = 'P-1'

export function makeSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: 'schedule-1',
    title: 'Daily triage',
    prompt: 'Review incoming dependencies',
    kind: 'recurring',
    preset: 'daily',
    cron: '0 9 * * *',
    runAt: null,
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 1, 9),
    lastFireAt: null,
    lastTaskId: null,
    cancelledAt: null,
    idempotencyKey: null,
    history: [],
    ...overrides,
  }
}

export async function setStoredSchedules(api: BackendOpenForgeAPI, schedules: TaskSchedule[]) {
  await api.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as never)
}

