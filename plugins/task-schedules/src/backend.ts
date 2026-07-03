import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge/plugin-sdk/backend'
import type { JsonValue, Task } from '@openforge/plugin-sdk'
import { cronForPreset, getNextScheduledFireAt, validateFiveFieldCron } from './lib/cron'
import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft, TaskScheduleMode } from './lib/types'

export const SCHEDULES_STORAGE_KEY = 'task-schedules.v1'
export const LIST_SCHEDULES_METHOD = 'listSchedules'
export const SAVE_SCHEDULE_METHOD = 'saveSchedule'
export const DELETE_SCHEDULE_METHOD = 'deleteSchedule'
export const RUN_NOW_METHOD = 'runNow'

const BACKGROUND_POLL_MS = 60_000
const HISTORY_LIMIT = 5

type ProjectRequest = { projectId: string }
type SaveScheduleRequest = ProjectRequest & { schedule: TaskScheduleDraft }
type ScheduleIdRequest = ProjectRequest & { scheduleId: string }

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod(LIST_SCHEDULES_METHOD, {
      handler: (input: unknown) => listTaskSchedules(openforge, requireProjectRequest(input)),
    }))

    context.subscriptions.add(openforge.backend.registerMethod(SAVE_SCHEDULE_METHOD, {
      handler: (input: unknown) => saveTaskSchedule(openforge, requireSaveScheduleRequest(input)),
    }))

    context.subscriptions.add(openforge.backend.registerMethod(DELETE_SCHEDULE_METHOD, {
      handler: async (input: unknown) => {
        const request = requireScheduleIdRequest(input)
        await deleteTaskSchedule(openforge, request)
        return { deleted: true }
      },
    }))

    context.subscriptions.add(openforge.backend.registerMethod(RUN_NOW_METHOD, {
      handler: (input: unknown) => runScheduleNow(openforge, requireScheduleIdRequest(input)),
    }))

    context.subscriptions.add(openforge.background.register({
      id: 'scheduled-fires',
      scope: 'global',
      async start() {
        await processDueSchedulesForAllProjects(openforge)
        const interval = setInterval(() => {
          void processDueSchedulesForAllProjects(openforge)
        }, BACKGROUND_POLL_MS)
        backgroundInterval = interval
      },
      stop() {
        if (backgroundInterval) clearInterval(backgroundInterval)
        backgroundInterval = null
      },
    }))
  },
})

let backgroundInterval: ReturnType<typeof setInterval> | null = null

export async function listTaskSchedules(openforge: BackendOpenForgeAPI, request: ProjectRequest): Promise<TaskSchedule[]> {
  return readSchedules(openforge, request.projectId)
}

export async function saveTaskSchedule(openforge: BackendOpenForgeAPI, request: SaveScheduleRequest, now = Date.now()): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, request.projectId)
  const existing = request.schedule.id ? schedules.find((schedule) => schedule.id === request.schedule.id) ?? null : null
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

export async function runScheduleNow(openforge: BackendOpenForgeAPI, request: ScheduleIdRequest, now = Date.now()): Promise<ScheduledFireOutcome> {
  const schedules = await readSchedules(openforge, request.projectId)
  const schedule = schedules.find((candidate) => candidate.id === request.scheduleId)
  if (!schedule) {
    throw new Error('Task Schedule not found')
  }

  const { updatedSchedule, outcome } = await performScheduledFire(openforge, request.projectId, schedule, 'manual', now)
  await writeSchedules(openforge, request.projectId, schedules.map((candidate) => candidate.id === schedule.id ? updatedSchedule : candidate))
  return outcome
}

export async function processDueSchedulesForAllProjects(openforge: BackendOpenForgeAPI, now = Date.now()): Promise<ScheduledFireOutcome[]> {
  const projects = await openforge.projects.list()
  const outcomes: ScheduledFireOutcome[] = []
  for (const project of projects) {
    outcomes.push(...await processDueSchedules(openforge, project.id, now))
  }
  return outcomes
}

export async function processDueSchedules(openforge: BackendOpenForgeAPI, projectId: string, now = Date.now()): Promise<ScheduledFireOutcome[]> {
  const schedules = await readSchedules(openforge, projectId)
  const outcomes: ScheduledFireOutcome[] = []
  let changed = false

  const updatedSchedules: TaskSchedule[] = []
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextFireAt > now) {
      updatedSchedules.push(schedule)
      continue
    }

    const { updatedSchedule, outcome } = await performScheduledFire(openforge, projectId, schedule, 'scheduled', now)
    outcomes.push(outcome)
    updatedSchedules.push({
      ...updatedSchedule,
      lastFireAt: now,
      nextFireAt: getNextScheduledFireAt(updatedSchedule.cron, now),
    })
    changed = true
  }

  if (changed) {
    await writeSchedules(openforge, projectId, updatedSchedules)
  }

  return outcomes
}

async function performScheduledFire(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  schedule: TaskSchedule,
  trigger: ScheduledFireOutcome['trigger'],
  now: number
): Promise<{ updatedSchedule: TaskSchedule; outcome: ScheduledFireOutcome }> {
  const openTask = await getOpenPreviousTask(openforge, schedule)
  if (openTask) {
    const outcome = createOutcome(now, trigger, 'skipped', `Skipped because previous scheduled Task ${openTask.id} is ${openTask.status}`, openTask.id)
    return { updatedSchedule: withOutcome(schedule, outcome), outcome }
  }

  try {
    const task = await openforge.tasks.create({
      initialPrompt: schedule.prompt,
      projectId,
      labelNames: ['scheduled'],
    })

    if (schedule.mode === 'create-only') {
      const outcome = createOutcome(now, trigger, 'created', `Created scheduled Task ${task.id}`, task.id)
      return {
        updatedSchedule: { ...withOutcome(schedule, outcome), lastTaskId: task.id },
        outcome,
      }
    }

    await openforge.tasks.startImplementation({ taskId: task.id })
    const outcome = createOutcome(now, trigger, 'started', `Created and started scheduled Task ${task.id}`, task.id)
    return {
      updatedSchedule: { ...withOutcome(schedule, outcome), lastTaskId: task.id },
      outcome,
    }
  } catch (error) {
    const outcome = createOutcome(now, trigger, 'failed', error instanceof Error ? error.message : String(error))
    return { updatedSchedule: withOutcome(schedule, outcome), outcome }
  }
}

async function getOpenPreviousTask(openforge: BackendOpenForgeAPI, schedule: TaskSchedule): Promise<Task | null> {
  if (!schedule.lastTaskId) return null

  try {
    const task = await openforge.tasks.get(schedule.lastTaskId)
    return task.status === 'done' ? null : task
  } catch {
    // Since AVIV-118, completing a Task deletes it: openforge.tasks.get then
    // rejects with 'task not found'. Treat a missing last Task as closed so the
    // schedule keeps firing instead of skipping forever.
    return null
  }
}

function normalizeScheduleDraft(draft: TaskScheduleDraft, existing: TaskSchedule | null, now: number): TaskSchedule {
  const title = requireTrimmedString(draft.title, 'Task Schedule title is required')
  const prompt = requireTrimmedString(draft.prompt, 'Task Schedule prompt is required')

  const preset = draft.preset
  if (!isSchedulePreset(preset)) {
    throw new Error('Task Schedule preset must be daily, weekly, monthly, or custom')
  }
  const cron = preset === 'custom'
    ? requireTrimmedString(draft.cron, 'Custom Task Schedule cron is required')
    : cronForPreset(preset, draft.timeOfDay ?? '09:00', draft.dayOfWeek ?? 1)
  const validation = validateFiveFieldCron(cron)
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid custom Schedule Preset')
  }

  const mode: TaskScheduleMode = draft.mode ?? 'create-and-start'
  if (mode !== 'create-and-start' && mode !== 'create-only') {
    throw new Error('Task Schedule mode must be create-and-start or create-only')
  }

  return {
    id: existing?.id ?? normalizeNonEmptyString(draft.id) ?? createId('schedule', now),
    title,
    prompt,
    preset,
    cron,
    mode,
    enabled: draft.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? normalizeRestoreTimestamp(draft.createdAt, now),
    updatedAt: now,
    nextFireAt: getNextScheduledFireAt(cron, now),
    lastFireAt: existing?.lastFireAt ?? normalizeOptionalRestoreTimestamp(draft.lastFireAt),
    lastTaskId: existing?.lastTaskId ?? normalizeNonEmptyString(draft.lastTaskId),
    history: existing?.history ?? normalizeRestoredHistory(draft.history),
  }
}

function isSchedulePreset(value: unknown): value is TaskSchedule['preset'] {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom'
}

function requireTrimmedString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeRestoreTimestamp(value: unknown, fallback: number): number {
  return isValidRestoreTimestamp(value) ? value : fallback
}

function normalizeOptionalRestoreTimestamp(value: unknown): number | null {
  return isValidRestoreTimestamp(value) ? value : null
}

function isValidRestoreTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeRestoredHistory(value: unknown): ScheduledFireOutcome[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((outcome) => {
    const normalized = normalizeScheduledFireOutcome(outcome)
    return normalized ? [normalized] : []
  }).slice(-HISTORY_LIMIT)
}

function normalizeScheduledFireOutcome(value: unknown): ScheduledFireOutcome | null {
  if (!value || typeof value !== 'object') return null
  const outcome = value as Partial<ScheduledFireOutcome>
  const id = normalizeNonEmptyString(outcome.id)
  if (!id) return null
  if (!isValidRestoreTimestamp(outcome.firedAt)) return null
  if (outcome.trigger !== 'scheduled' && outcome.trigger !== 'manual') return null
  if (outcome.status !== 'started' && outcome.status !== 'created' && outcome.status !== 'skipped' && outcome.status !== 'failed') return null
  if (typeof outcome.message !== 'string') return null
  const taskId = 'taskId' in outcome ? normalizeNonEmptyString(outcome.taskId) : null
  if ('taskId' in outcome && outcome.taskId !== undefined && !taskId) return null
  return {
    id,
    firedAt: outcome.firedAt,
    trigger: outcome.trigger,
    status: outcome.status,
    ...(taskId ? { taskId } : {}),
    message: outcome.message,
  }
}

function createOutcome(
  now: number,
  trigger: ScheduledFireOutcome['trigger'],
  status: ScheduledFireOutcome['status'],
  message: string,
  taskId?: string
): ScheduledFireOutcome {
  return {
    id: createId('fire', now),
    firedAt: now,
    trigger,
    status,
    taskId,
    message,
  }
}

function withOutcome(schedule: TaskSchedule, outcome: ScheduledFireOutcome): TaskSchedule {
  return {
    ...schedule,
    history: [...schedule.history, outcome].slice(-HISTORY_LIMIT),
  }
}

async function readSchedules(openforge: BackendOpenForgeAPI, projectId: string): Promise<TaskSchedule[]> {
  const value = await openforge.storage.project(projectId).get<JsonValue>(SCHEDULES_STORAGE_KEY)
  if (!Array.isArray(value)) return []
  return (value as unknown[]).filter(isTaskSchedule)
}

async function writeSchedules(openforge: BackendOpenForgeAPI, projectId: string, schedules: TaskSchedule[]): Promise<void> {
  await openforge.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as JsonValue)
}

function isTaskSchedule(value: unknown): value is TaskSchedule {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Partial<TaskSchedule>
  return typeof schedule.id === 'string' &&
    typeof schedule.title === 'string' &&
    typeof schedule.prompt === 'string' &&
    typeof schedule.cron === 'string' &&
    typeof schedule.nextFireAt === 'number' &&
    Array.isArray(schedule.history)
}

function requireProjectRequest(input: unknown): ProjectRequest {
  if (!input || typeof input !== 'object' || typeof (input as ProjectRequest).projectId !== 'string') {
    throw new Error('projectId is required')
  }
  return { projectId: (input as ProjectRequest).projectId }
}

function requireSaveScheduleRequest(input: unknown): SaveScheduleRequest {
  const project = requireProjectRequest(input)
  const schedule = (input as { schedule?: unknown }).schedule
  if (!schedule || typeof schedule !== 'object') {
    throw new Error('Task Schedule payload is required')
  }
  return { ...project, schedule: schedule as TaskScheduleDraft }
}

function requireScheduleIdRequest(input: unknown): ScheduleIdRequest {
  const project = requireProjectRequest(input)
  const scheduleId = (input as { scheduleId?: unknown }).scheduleId
  if (typeof scheduleId !== 'string' || scheduleId.trim().length === 0) {
    throw new Error('scheduleId is required')
  }
  return { ...project, scheduleId }
}

function createId(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
