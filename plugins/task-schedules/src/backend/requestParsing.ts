import type { ScheduleCommandInput, TaskScheduleDraft, UpdateScheduleCommandInput } from '../lib/types'
import type { ProjectRequest, SaveScheduleRequest, ScheduleIdRequest } from './schedulePersistence'
import { requireTrimmedString } from './scheduleValidation'

export function requireInvocationProjectId(projectId: string | null): string {
  if (!projectId) throw new Error('This scheduling command requires Project context')
  return projectId
}

export function requireScheduleCommandInput(input: unknown): ScheduleCommandInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Schedule command input must be an object')
  }
  const candidate = input as Partial<ScheduleCommandInput>
  const timing = candidate.timing
  if (!timing || typeof timing !== 'object' || Array.isArray(timing)) {
    throw new Error('Schedule command timing is required')
  }
  if (timing.type === 'once') {
    if (typeof timing.at !== 'string') throw new Error('One-off timing.at must be an RFC 3339 timestamp')
  } else if (timing.type === 'recurring') {
    if (typeof timing.cron !== 'string') throw new Error('Recurring timing.cron is required')
  } else {
    throw new Error('Schedule command timing.type must be once or recurring')
  }
  return candidate as ScheduleCommandInput
}

export function requireUpdateScheduleCommandInput(input: unknown): UpdateScheduleCommandInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Update Schedule command input must be an object')
  }
  const candidate = input as Partial<UpdateScheduleCommandInput>
  candidate.scheduleId = requireTrimmedString(candidate.scheduleId, 'scheduleId is required')
  if (candidate.title === undefined && candidate.prompt === undefined && candidate.timing === undefined && candidate.mode === undefined) {
    throw new Error('Update Schedule command requires at least one change')
  }
  const timing = candidate.timing
  if (timing?.type === 'once' && typeof timing.at !== 'string') {
    throw new Error('One-off timing.at must be an RFC 3339 timestamp')
  }
  if (timing?.type === 'recurring' && typeof timing.cron !== 'string') {
    throw new Error('Recurring timing.cron is required')
  }
  if (timing !== undefined && timing.type !== 'once' && timing.type !== 'recurring') {
    throw new Error('Schedule command timing.type must be once or recurring')
  }
  return candidate as UpdateScheduleCommandInput
}

export function requireCommandScheduleId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Cancel Schedule command input must be an object')
  }
  return requireTrimmedString((input as { scheduleId?: unknown }).scheduleId, 'scheduleId is required')
}

export function requireProjectRequest(input: unknown): ProjectRequest {
  if (!input || typeof input !== 'object' || typeof (input as ProjectRequest).projectId !== 'string') {
    throw new Error('projectId is required')
  }
  return { projectId: (input as ProjectRequest).projectId }
}

export function requireSaveScheduleRequest(input: unknown): SaveScheduleRequest {
  const project = requireProjectRequest(input)
  const schedule = (input as { schedule?: unknown }).schedule
  if (!schedule || typeof schedule !== 'object') {
    throw new Error('Task Schedule payload is required')
  }
  return { ...project, schedule: schedule as TaskScheduleDraft }
}

export function requireScheduleIdRequest(input: unknown): ScheduleIdRequest {
  const project = requireProjectRequest(input)
  const scheduleId = (input as { scheduleId?: unknown }).scheduleId
  if (typeof scheduleId !== 'string' || scheduleId.trim().length === 0) {
    throw new Error('scheduleId is required')
  }
  return { ...project, scheduleId }
}
