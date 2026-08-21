import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { TaskSchedule, TaskScheduleDraft } from '../lib/types'
import { isTerminalOneOff, normalizeScheduleDraft, normalizeStoredSchedule } from './scheduleValidation'

export const SCHEDULES_STORAGE_KEY = 'task-schedules.v1'

export type ProjectRequest = { projectId: string }
export type SaveScheduleRequest = ProjectRequest & { schedule: TaskScheduleDraft }
export type ScheduleIdRequest = ProjectRequest & { scheduleId: string }

export async function listTaskSchedules(openforge: BackendOpenForgeAPI, request: ProjectRequest): Promise<TaskSchedule[]> {
  return readSchedules(openforge, request.projectId)
}

export async function saveTaskSchedule(
  openforge: BackendOpenForgeAPI,
  request: SaveScheduleRequest,
  now = Date.now(),
): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, request.projectId)
  const existing = request.schedule.id ? schedules.find((schedule) => schedule.id === request.schedule.id) ?? null : null
  if (existing && (existing.cancelledAt !== null || isTerminalOneOff(existing))) {
    throw new Error('Completed or cancelled Task Schedules cannot be updated')
  }
  const normalized = normalizeScheduleDraft(request.schedule, existing, now)
  const nextSchedules = existing
    ? schedules.map((schedule) => schedule.id === existing.id ? normalized : schedule)
    : [...schedules, normalized]

  await writeSchedules(openforge, request.projectId, nextSchedules)
  return normalized
}

export async function deleteTaskSchedule(openforge: BackendOpenForgeAPI, request: ScheduleIdRequest): Promise<void> {
  const schedules = await readSchedules(openforge, request.projectId)
  await writeSchedules(openforge, request.projectId, schedules.filter((schedule) => schedule.id !== request.scheduleId))
}

export async function readSchedules(openforge: BackendOpenForgeAPI, projectId: string): Promise<TaskSchedule[]> {
  const value = await openforge.storage.project(projectId).get<JsonValue>(SCHEDULES_STORAGE_KEY)
  if (!Array.isArray(value)) return []
  return (value as unknown[]).flatMap((entry) => {
    const schedule = normalizeStoredSchedule(entry)
    return schedule ? [schedule] : []
  })
}

export async function writeSchedules(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  schedules: TaskSchedule[],
): Promise<void> {
  await openforge.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as JsonValue)
}
