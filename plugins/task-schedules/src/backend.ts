import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI, BackgroundServiceRegistration } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue, Task } from '@openforge-app/plugin-sdk'
import { cronForPreset, getNextScheduledFireAt, validateCronCadence, validateFiveFieldCron } from './lib/cron'
import {
  cancelScheduleCommandInputSchema,
  listSchedulesCommandOutputSchema,
  scheduleCommandInputSchema,
  taskScheduleOutputSchema,
  updateScheduleCommandInputSchema,
} from './agentCommandSchemas'
import type { ScheduleCommandInput, ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft, TaskScheduleMode, UpdateScheduleCommandInput } from './lib/types'

export const SCHEDULES_STORAGE_KEY = 'task-schedules.v1'
export const LIST_SCHEDULES_METHOD = 'listSchedules'
export const SAVE_SCHEDULE_METHOD = 'saveSchedule'
export const DELETE_SCHEDULE_METHOD = 'deleteSchedule'
export const RUN_NOW_METHOD = 'runNow'
export const CANCEL_RUN_NOW_METHOD = 'cancelRunNow'
export const SCHEDULE_COMMAND = 'schedule'
export const LIST_SCHEDULES_COMMAND = 'list-schedules'
export const UPDATE_SCHEDULE_COMMAND = 'update-schedule'
export const CANCEL_SCHEDULE_COMMAND = 'cancel-schedule'

const BACKGROUND_POLL_MS = 60_000
const HISTORY_LIMIT = 5

type ProjectRequest = { projectId: string }
type SaveScheduleRequest = ProjectRequest & { schedule: TaskScheduleDraft }
type ScheduleIdRequest = ProjectRequest & { scheduleId: string }

export default defineBackendPlugin({
  activate(openforge, context) {
    const manualRunner = createManualScheduleRunner(openforge)
    const agentScheduleRunner = createAgentScheduleRunner(openforge)

    context.subscriptions.add(openforge.commands.register({
      id: SCHEDULE_COMMAND,
      title: 'Schedule task automation',
      discoverable: false,
      agent: {
        description: 'Create a one-off or recurring Task Schedule for the current project.',
        examples: [
          { title: 'Resume dependency upgrade', prompt: 'Retry the dependency upgrade after its release-age gate.', timing: { type: 'once', at: '2026-08-26T13:46:00Z' } },
          { title: 'Weekly dependency review', prompt: 'Review eligible dependency updates.', timing: { type: 'recurring', cron: '0 9 * * 1' } },
        ],
      },
      input: scheduleCommandInputSchema,
      output: taskScheduleOutputSchema,
      handler: (input: unknown, invocation) => agentScheduleRunner.schedule(
        requireInvocationProjectId(invocation.projectId),
        requireScheduleCommandInput(input),
      ),
    }))
    context.subscriptions.add(openforge.commands.register({
      id: LIST_SCHEDULES_COMMAND,
      title: 'List task schedules',
      discoverable: false,
      agent: { description: 'List Task Schedules for the current project.' },
      output: listSchedulesCommandOutputSchema,
      handler: (_input: unknown, invocation) => listTaskSchedules(openforge, {
        projectId: requireInvocationProjectId(invocation.projectId),
      }),
    }))
    context.subscriptions.add(openforge.commands.register({
      id: UPDATE_SCHEDULE_COMMAND,
      title: 'Update task schedule',
      discoverable: false,
      agent: { description: 'Update an active Task Schedule in the current project.' },
      input: updateScheduleCommandInputSchema,
      output: taskScheduleOutputSchema,
      handler: (input: unknown, invocation) => updateScheduleFromCommand(
        openforge,
        requireInvocationProjectId(invocation.projectId),
        requireUpdateScheduleCommandInput(input),
      ),
    }))
    context.subscriptions.add(openforge.commands.register({
      id: CANCEL_SCHEDULE_COMMAND,
      title: 'Cancel task schedule',
      discoverable: false,
      agent: { description: 'Cancel a Task Schedule in the current project without deleting its record.' },
      input: cancelScheduleCommandInputSchema,
      output: taskScheduleOutputSchema,
      handler: (input: unknown, invocation) => cancelScheduleFromCommand(
        openforge,
        requireInvocationProjectId(invocation.projectId),
        requireCommandScheduleId(input),
      ),
    }))
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
      handler: (input: unknown) => manualRunner.run(requireScheduleIdRequest(input)),
    }))

    context.subscriptions.add(openforge.backend.registerMethod(CANCEL_RUN_NOW_METHOD, {
      handler: (input: unknown) => manualRunner.cancel(requireScheduleIdRequest(input)),
    }))

    context.subscriptions.add(openforge.background.register(createScheduledFiresService(openforge)))
  },
})

// Each registration owns its own interval handle via closure state. A
// module-level handle would let a second activation clobber the first's timer
// (leaking a poller that never stops) and let stop() clear the wrong interval.
export function createScheduledFiresService(openforge: BackendOpenForgeAPI): BackgroundServiceRegistration {
  const runPoll = createGuardedPoll(() => processDueSchedulesForAllProjects(openforge))
  let interval: ReturnType<typeof setInterval> | null = null
  return {
    id: 'scheduled-fires',
    scope: 'global',
    async start() {
      await runPoll()
      interval = setInterval(() => {
        void runPoll()
      }, BACKGROUND_POLL_MS)
    },
    stop() {
      if (interval) clearInterval(interval)
      interval = null
    },
  }
}

// Drops overlapping runs: two concurrent polls would read the same pre-write
// schedules and both fire, creating duplicate Tasks.
export function createGuardedPoll(run: () => Promise<unknown>): () => Promise<void> {
  let inFlight = false
  return async () => {
    if (inFlight) return
    inFlight = true
    try {
      await run()
    } finally {
      inFlight = false
    }
  }
}

export async function listTaskSchedules(openforge: BackendOpenForgeAPI, request: ProjectRequest): Promise<TaskSchedule[]> {
  return readSchedules(openforge, request.projectId)
}

function createAgentScheduleRunner(openforge: BackendOpenForgeAPI) {
  const pendingByIdempotencyKey = new Map<string, Promise<TaskSchedule>>()
  return {
    schedule(projectId: string, input: ScheduleCommandInput, now = Date.now()): Promise<TaskSchedule> {
      const idempotencyKey = optionalTrimmedString(input.idempotencyKey, 'idempotencyKey must be a non-empty string')
      if (!idempotencyKey) return scheduleTaskFromCommand(openforge, projectId, input, now)

      const key = `${projectId}:${idempotencyKey}`
      const pending = pendingByIdempotencyKey.get(key)
      if (pending) return pending

      const scheduled = scheduleTaskFromCommand(openforge, projectId, input, now)
      pendingByIdempotencyKey.set(key, scheduled)
      const clear = () => {
        if (pendingByIdempotencyKey.get(key) === scheduled) pendingByIdempotencyKey.delete(key)
      }
      void scheduled.then(clear, clear)
      return scheduled
    },
  }
}

export async function scheduleTaskFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  input: ScheduleCommandInput,
  now = Date.now(),
): Promise<TaskSchedule> {
  const idempotencyKey = optionalTrimmedString(input.idempotencyKey, 'idempotencyKey must be a non-empty string')
  if (idempotencyKey) {
    const existing = (await readSchedules(openforge, projectId))
      .find((schedule) => schedule.idempotencyKey === idempotencyKey)
    if (existing) return existing
  }

  const timing = input.timing
  if (timing.type === 'once') {
    return saveTaskSchedule(openforge, {
      projectId,
      schedule: {
        title: input.title,
        prompt: input.prompt,
        kind: 'once',
        runAt: parseFutureRunAt(timing.at, now),
        mode: input.mode,
        idempotencyKey,
      },
    }, now)
  }

  return saveTaskSchedule(openforge, {
    projectId,
    schedule: {
      title: input.title,
      prompt: input.prompt,
      kind: 'recurring',
      preset: 'custom',
      cron: timing.cron,
      mode: input.mode,
      idempotencyKey,
    },
  }, now)
}

export async function updateScheduleFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  input: UpdateScheduleCommandInput,
  now = Date.now(),
): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, projectId)
  const existing = schedules.find((schedule) => schedule.id === input.scheduleId)
  if (!existing) throw new Error('Task Schedule not found')
  if (existing.cancelledAt !== null || (existing.kind === 'once' && existing.lastFireAt !== null)) {
    throw new Error('Completed or cancelled Task Schedules cannot be updated')
  }
  if (input.timing && input.timing.type !== existing.kind) {
    throw new Error('Task Schedule timing type cannot be changed')
  }

  const draft: TaskScheduleDraft = {
    id: existing.id,
    title: input.title ?? existing.title,
    prompt: input.prompt ?? existing.prompt,
    kind: existing.kind,
    preset: existing.preset,
    cron: existing.cron,
    runAt: existing.runAt,
    mode: input.mode ?? existing.mode,
    enabled: existing.enabled,
    idempotencyKey: existing.idempotencyKey,
  }
  if (input.timing?.type === 'once') draft.runAt = parseFutureRunAt(input.timing.at, now)
  if (input.timing?.type === 'recurring') {
    draft.preset = 'custom'
    draft.cron = input.timing.cron
  }
  return saveTaskSchedule(openforge, { projectId, schedule: draft }, now)
}

export async function cancelScheduleFromCommand(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  scheduleId: string,
  now = Date.now(),
): Promise<TaskSchedule> {
  const schedules = await readSchedules(openforge, projectId)
  const existing = schedules.find((schedule) => schedule.id === scheduleId)
  if (!existing) throw new Error('Task Schedule not found')
  if (existing.kind === 'once' && existing.lastFireAt !== null) return existing
  if (existing.cancelledAt !== null) return existing
  const cancelled = { ...existing, enabled: false, updatedAt: now, cancelledAt: now }
  await writeSchedules(openforge, projectId, schedules.map((schedule) => schedule.id === scheduleId ? cancelled : schedule))
  return cancelled
}

export async function saveTaskSchedule(openforge: BackendOpenForgeAPI, request: SaveScheduleRequest, now = Date.now()): Promise<TaskSchedule> {
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

export type ManualScheduleRunner = {
  run: (request: ScheduleIdRequest, now?: number) => Promise<ScheduledFireOutcome>
  cancel: (request: ScheduleIdRequest) => { cancelled: boolean }
}

export function createManualScheduleRunner(openforge: BackendOpenForgeAPI): ManualScheduleRunner {
  const activeRuns = new Map<string, { cancelRequested: boolean }>()
  const keyFor = (request: ScheduleIdRequest) => `${request.projectId}:${request.scheduleId}`

  return {
    async run(request, now = Date.now()) {
      const key = keyFor(request)
      if (activeRuns.has(key)) throw new Error('This Task Schedule is already running')
      const activeRun = { cancelRequested: false }
      activeRuns.set(key, activeRun)
      try {
        return await runScheduleNow(openforge, request, now, () => activeRun.cancelRequested)
      } finally {
        activeRuns.delete(key)
      }
    },
    cancel(request) {
      const activeRun = activeRuns.get(keyFor(request))
      if (!activeRun) return { cancelled: false }
      activeRun.cancelRequested = true
      return { cancelled: true }
    },
  }
}

export async function runScheduleNow(
  openforge: BackendOpenForgeAPI,
  request: ScheduleIdRequest,
  now = Date.now(),
  isCancellationRequested: () => boolean = () => false,
): Promise<ScheduledFireOutcome> {
  const schedules = await readSchedules(openforge, request.projectId)
  const schedule = schedules.find((candidate) => candidate.id === request.scheduleId)
  if (!schedule) throw new Error('Task Schedule not found')
  if (isTerminalOneOff(schedule)) throw new Error('Completed or cancelled one-off Task Schedules cannot be run')

  const { updatedSchedule, outcome } = await performScheduledFire(
    openforge,
    request.projectId,
    schedule,
    'manual',
    now,
    isCancellationRequested,
  )
  const savedSchedule = updatedSchedule.kind === 'once' && outcome.taskId !== undefined
    ? { ...updatedSchedule, enabled: false, lastFireAt: now, nextFireAt: null }
    : updatedSchedule
  await writeSchedules(openforge, request.projectId, schedules.map((candidate) => candidate.id === schedule.id ? savedSchedule : candidate))
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
    if (!schedule.enabled || schedule.nextFireAt === null || schedule.nextFireAt > now) {
      updatedSchedules.push(schedule)
      continue
    }

    const { updatedSchedule, outcome } = await performScheduledFire(openforge, projectId, schedule, 'scheduled', now)
    outcomes.push(outcome)
    updatedSchedules.push(updatedSchedule.kind === 'once'
      ? {
          ...updatedSchedule,
          enabled: false,
          lastFireAt: now,
          nextFireAt: null,
        }
      : {
          ...updatedSchedule,
          lastFireAt: now,
          nextFireAt: getNextScheduledFireAt(requireRecurringCron(updatedSchedule), now),
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
  now: number,
  isCancellationRequested: () => boolean = () => false,
): Promise<{ updatedSchedule: TaskSchedule; outcome: ScheduledFireOutcome }> {
  const outcome = await computeFireOutcome(openforge, projectId, schedule, trigger, now, isCancellationRequested)
  return { updatedSchedule: withOutcome(schedule, outcome), outcome }
}

async function computeFireOutcome(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  schedule: TaskSchedule,
  trigger: ScheduledFireOutcome['trigger'],
  now: number,
  isCancellationRequested: () => boolean,
): Promise<ScheduledFireOutcome> {
  if (isCancellationRequested()) return createOutcome(now, trigger, 'cancelled', 'Run cancelled before creating a Task')
  const block = await getPreviousTaskBlock(openforge, schedule)
  if (block) return createOutcome(now, trigger, 'skipped', block.message, block.taskId)
  if (isCancellationRequested()) return createOutcome(now, trigger, 'cancelled', 'Run cancelled before creating a Task')

  let task: Task
  try {
    task = await openforge.tasks.create({ initialPrompt: schedule.prompt, projectId, labelNames: ['scheduled'] })
  } catch (error) {
    return createOutcome(now, trigger, 'failed', errorMessage(error))
  }

  if (isCancellationRequested()) {
    return createOutcome(now, trigger, 'cancelled', `Created scheduled Task ${task.id} but cancelled before starting implementation`, task.id)
  }

  if (schedule.mode === 'create-only') {
    return createOutcome(now, trigger, 'created', `Created scheduled Task ${task.id}`, task.id)
  }

  try {
    await openforge.tasks.startImplementation({ taskId: task.id })
    return createOutcome(now, trigger, 'started', `Created and started scheduled Task ${task.id}`, task.id)
  } catch (error) {
    return createOutcome(now, trigger, 'failed', `Created scheduled Task ${task.id} but failed to start it: ${errorMessage(error)}`, task.id)
  }
}

type PreviousTaskBlock = { taskId: string; message: string }

async function getPreviousTaskBlock(openforge: BackendOpenForgeAPI, schedule: TaskSchedule): Promise<PreviousTaskBlock | null> {
  if (!schedule.lastTaskId) return null

  let task: Task | null
  try {
    task = await openforge.tasks.get(schedule.lastTaskId)
  } catch (error) {
    // A tasks.get rejection (e.g. a locked database) leaves the last Task's
    // state unknown. Skip this fire rather than risk spawning a duplicate
    // alongside a Task that may still be open; firing resumes at the next
    // scheduled fire.
    return { taskId: schedule.lastTaskId, message: `Skipped because previous scheduled Task ${schedule.lastTaskId} could not be verified: ${errorMessage(error)}` }
  }

  // Since AVIV-118, completing a Task deletes it: openforge.tasks.get then
  // resolves to null. A missing last Task is closed, so keep firing instead of
  // skipping forever.
  if (!task) return null
  // 'done' is a recognized-but-unreachable status after AVIV-118 (legacy rows
  // only); such a last Task counts as closed and does not block firing.
  if (task.status === 'done') return null
  return { taskId: task.id, message: `Skipped because previous scheduled Task ${task.id} is ${task.status}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeScheduleDraft(draft: TaskScheduleDraft, existing: TaskSchedule | null, now: number): TaskSchedule {
  const title = requireTrimmedString(draft.title, 'Task Schedule title is required')
  const prompt = requireTrimmedString(draft.prompt, 'Task Schedule prompt is required')
  const kind = draft.kind ?? existing?.kind ?? 'recurring'
  if (kind !== 'recurring' && kind !== 'once') {
    throw new Error('Task Schedule kind must be recurring or once')
  }

  let preset: TaskSchedule['preset'] = null
  let cron: string | null = null
  let runAt: number | null = null
  let nextFireAt: number
  if (kind === 'once') {
    runAt = draft.runAt ?? (existing?.kind === 'once' ? existing.runAt : null)
    if (typeof runAt !== 'number' || !Number.isFinite(runAt)) {
      throw new Error('One-off Task Schedule time is required')
    }
    if (runAt <= now) throw new Error('One-off Task Schedule time must be in the future')
    nextFireAt = runAt
  } else {
    preset = draft.preset ?? (existing?.kind === 'recurring' ? existing.preset : null) ?? 'daily'
    if (!isSchedulePreset(preset)) {
      throw new Error('Task Schedule preset must be daily, weekly, monthly, or custom')
    }
    cron = preset === 'custom'
      ? requireTrimmedString(draft.cron ?? existing?.cron, 'Custom Task Schedule cron is required')
      : cronForPreset(preset, draft.timeOfDay ?? '09:00', draft.dayOfWeek ?? 1)
    const validation = validateFiveFieldCron(cron)
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid custom Schedule Preset')
    }
    const cadence = validateCronCadence(cron, now)
    if (!cadence.valid) {
      throw new Error(cadence.error ?? 'Task Schedule cadence is too frequent')
    }
    nextFireAt = getNextScheduledFireAt(cron, now)
  }

  const mode: TaskScheduleMode = draft.mode ?? 'create-and-start'
  if (mode !== 'create-and-start' && mode !== 'create-only') {
    throw new Error('Task Schedule mode must be create-and-start or create-only')
  }
  const enabled = draft.enabled ?? existing?.enabled ?? true

  return {
    id: existing?.id ?? createId('schedule', now),
    title,
    prompt,
    kind,
    preset,
    cron,
    runAt,
    mode,
    enabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextFireAt,
    lastFireAt: existing?.lastFireAt ?? null,
    lastTaskId: existing?.lastTaskId ?? null,
    cancelledAt: enabled ? null : existing?.cancelledAt ?? null,
    idempotencyKey: draft.idempotencyKey ?? existing?.idempotencyKey ?? null,
    history: existing?.history ?? [],
  }
}

function isSchedulePreset(value: unknown): value is TaskSchedule['preset'] {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom'
}

function requireRecurringCron(schedule: TaskSchedule): string {
  if (schedule.kind !== 'recurring' || !schedule.cron) {
    throw new Error('Recurring Task Schedule cron is required')
  }
  return schedule.cron
}

function isTerminalOneOff(schedule: TaskSchedule): boolean {
  return schedule.kind === 'once' && (schedule.lastFireAt !== null || schedule.cancelledAt !== null)
}

function requireTrimmedString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function optionalTrimmedString(value: unknown, message: string): string | null {
  if (value === undefined || value === null) return null
  return requireTrimmedString(value, message)
}

function parseFutureRunAt(value: unknown, now: number): number {
  const timestamp = requireTrimmedString(value, 'One-off timing.at must be an RFC 3339 timestamp')
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(timestamp)
  if (!match) throw new Error('One-off timing.at must be an RFC 3339 timestamp with a timezone')

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', , offsetSign, offsetHourText = '0', offsetMinuteText = '0'] = match
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ].map(Number)
  const millisecond = Number(fraction.padEnd(3, '0').slice(0, 3))
  const calendarSecond = second === 60 ? 59 : second
  const calendarTime = Date.UTC(year, month - 1, day, hour, minute, calendarSecond, millisecond)
  const localDate = new Date(calendarTime)
  const calendarIsValid = localDate.getUTCFullYear() === year &&
    localDate.getUTCMonth() === month - 1 &&
    localDate.getUTCDate() === day &&
    localDate.getUTCHours() === hour &&
    localDate.getUTCMinutes() === minute &&
    localDate.getUTCSeconds() === calendarSecond &&
    second <= 60 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  const localTime = calendarTime + (second === 60 ? 1_000 : 0)
  if (!calendarIsValid) throw new Error('One-off timing.at must be a valid RFC 3339 timestamp')

  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (offsetSign === '-' ? -1 : 1)
  const runAt = localTime - offset
  if (runAt <= now) throw new Error('One-off timing.at must be in the future')
  return runAt
}

function requireInvocationProjectId(projectId: string | null): string {
  if (!projectId) throw new Error('This scheduling command requires Project context')
  return projectId
}

function requireScheduleCommandInput(input: unknown): ScheduleCommandInput {
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

function requireUpdateScheduleCommandInput(input: unknown): UpdateScheduleCommandInput {
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

function requireCommandScheduleId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Cancel Schedule command input must be an object')
  }
  return requireTrimmedString((input as { scheduleId?: unknown }).scheduleId, 'scheduleId is required')
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
    // A fire that touched a Task (created/started, or created-then-failed-to-start)
    // becomes the last Task; a fire that created none leaves the pointer intact.
    // This keeps the de-dup guard fed even when starting the Task failed.
    lastTaskId: outcome.taskId ?? schedule.lastTaskId,
    history: [...schedule.history, outcome].slice(-HISTORY_LIMIT),
  }
}

async function readSchedules(openforge: BackendOpenForgeAPI, projectId: string): Promise<TaskSchedule[]> {
  const value = await openforge.storage.project(projectId).get<JsonValue>(SCHEDULES_STORAGE_KEY)
  if (!Array.isArray(value)) return []
  return (value as unknown[]).flatMap((entry) => {
    const schedule = normalizeStoredSchedule(entry)
    return schedule ? [schedule] : []
  })
}

async function writeSchedules(openforge: BackendOpenForgeAPI, projectId: string, schedules: TaskSchedule[]): Promise<void> {
  await openforge.storage.project(projectId).set(SCHEDULES_STORAGE_KEY, schedules as unknown as JsonValue)
}

function normalizeStoredSchedule(value: unknown): TaskSchedule | null {
  if (!value || typeof value !== 'object') return null
  const schedule = value as Partial<TaskSchedule>
  if (typeof schedule.id !== 'string' ||
    typeof schedule.title !== 'string' ||
    typeof schedule.prompt !== 'string' ||
    !Array.isArray(schedule.history)) return null

  const kind = schedule.kind === 'once' ? 'once' : 'recurring'
  const cron = typeof schedule.cron === 'string' ? schedule.cron : null
  const runAt = typeof schedule.runAt === 'number' ? schedule.runAt : null
  const nextFireAt = typeof schedule.nextFireAt === 'number' ? schedule.nextFireAt : null
  if (kind === 'once' && (runAt === null || (nextFireAt === null && schedule.lastFireAt == null))) return null
  if (kind === 'recurring' && (cron === null || nextFireAt === null)) return null

  return {
    ...schedule,
    kind,
    preset: kind === 'recurring' && isSchedulePreset(schedule.preset) ? schedule.preset : kind === 'recurring' ? 'custom' : null,
    cron,
    runAt,
    nextFireAt,
    cancelledAt: typeof schedule.cancelledAt === 'number' ? schedule.cancelledAt : null,
    idempotencyKey: typeof schedule.idempotencyKey === 'string' ? schedule.idempotencyKey : null,
  } as TaskSchedule
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
