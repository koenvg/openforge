import type { TaskDetail } from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI, BackgroundServiceRegistration } from '@openforge-app/plugin-sdk/backend'
import { getNextScheduledFireAt } from '../lib/cron'
import { isTerminalTaskSchedule } from '../lib/taskScheduleLifecycle'
import type { ActiveTaskSchedule, ScheduledFireOutcome, TaskSchedule } from '../lib/types'
import type { ScheduleIdRequest } from './schedulePersistence'
import { readSchedules, writeSchedules } from './schedulePersistence'
import { createId } from './ids'
import { completeOneOffSchedule } from './scheduleValidation'

const BACKGROUND_POLL_MS = 60_000
const HISTORY_LIMIT = 5

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
  if (isTerminalTaskSchedule(schedule)) throw new Error('Completed or cancelled Task Schedules cannot be run')

  const { updatedSchedule, outcome } = await performScheduledFire(
    openforge,
    request.projectId,
    schedule,
    'manual',
    now,
    isCancellationRequested,
  )
  const savedSchedule = updatedSchedule.timing.type === 'once' && outcome.taskId !== undefined
    ? completeOneOffSchedule(updatedSchedule, now)
    : updatedSchedule
  await writeSchedules(openforge, request.projectId, schedules.map((candidate) => candidate.id === schedule.id ? savedSchedule : candidate))
  return outcome
}

export async function processDueSchedulesForAllProjects(
  openforge: BackendOpenForgeAPI,
  now = Date.now(),
): Promise<ScheduledFireOutcome[]> {
  const projects = await openforge.projects.list()
  const outcomes: ScheduledFireOutcome[] = []
  for (const project of projects) {
    outcomes.push(...await processDueSchedules(openforge, project.id, now))
  }
  return outcomes
}

export async function processDueSchedules(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  now = Date.now(),
): Promise<ScheduledFireOutcome[]> {
  const schedules = await readSchedules(openforge, projectId)
  const outcomes: ScheduledFireOutcome[] = []
  let changed = false

  const updatedSchedules: TaskSchedule[] = []
  for (const schedule of schedules) {
    if (isTerminalTaskSchedule(schedule) || !schedule.lifecycle.enabled || schedule.lifecycle.nextFireAt > now) {
      updatedSchedules.push(schedule)
      continue
    }

    const { updatedSchedule, outcome } = await performScheduledFire(openforge, projectId, schedule, 'scheduled', now)
    outcomes.push(outcome)
    updatedSchedules.push(updatedSchedule.timing.type === 'once'
      ? completeOneOffSchedule(updatedSchedule, now)
      : {
          ...updatedSchedule,
          lifecycle: {
            ...updatedSchedule.lifecycle,
            lastFireAt: now,
            nextFireAt: getNextScheduledFireAt(updatedSchedule.timing.cron, now),
          },
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
  schedule: ActiveTaskSchedule,
  trigger: ScheduledFireOutcome['trigger'],
  now: number,
  isCancellationRequested: () => boolean = () => false,
): Promise<{ updatedSchedule: ActiveTaskSchedule; outcome: ScheduledFireOutcome }> {
  const outcome = await computeFireOutcome(openforge, projectId, schedule, trigger, now, isCancellationRequested)
  return { updatedSchedule: withOutcome(schedule, outcome), outcome }
}

async function computeFireOutcome(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  schedule: ActiveTaskSchedule,
  trigger: ScheduledFireOutcome['trigger'],
  now: number,
  isCancellationRequested: () => boolean,
): Promise<ScheduledFireOutcome> {
  if (isCancellationRequested()) return createOutcome(now, trigger, 'cancelled', 'Run cancelled before creating a Task')
  const block = await getPreviousTaskBlock(openforge, projectId, schedule)
  if (block) return createOutcome(now, trigger, 'skipped', block.message, block.taskId)
  if (isCancellationRequested()) return createOutcome(now, trigger, 'cancelled', 'Run cancelled before creating a Task')

  let task: { id: string }
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

async function getPreviousTaskBlock(
  openforge: BackendOpenForgeAPI,
  projectId: string,
  schedule: TaskSchedule,
): Promise<PreviousTaskBlock | null> {
  if (!schedule.lastTaskId) return null

  let task: TaskDetail | null
  try {
    task = (await openforge.tasks.detail(projectId, schedule.lastTaskId))?.task ?? null
  } catch (error) {
    // A tasks.detail rejection (e.g. a locked database) leaves the last Task's
    // state unknown. Skip this fire rather than risk spawning a duplicate
    // alongside a Task that may still be open; firing resumes at the next
    // scheduled fire.
    return { taskId: schedule.lastTaskId, message: `Skipped because previous scheduled Task ${schedule.lastTaskId} could not be verified: ${errorMessage(error)}` }
  }

  // Since AVIV-118, completing a Task deletes it: openforge.tasks.detail then
  // resolves to null. A missing last Task is closed, so keep firing instead of
  // skipping forever.
  if (!task) return null
  // 'done' is a recognized-but-unreachable status after AVIV-118 (legacy rows
  // only); such a last Task counts as closed and does not block firing.
  if (task.status === 'done') return null
  return { taskId: task.id, message: `Skipped because previous scheduled Task ${task.id} is ${task.status}` }
}

function createOutcome(
  now: number,
  trigger: ScheduledFireOutcome['trigger'],
  status: ScheduledFireOutcome['status'],
  message: string,
  taskId?: string,
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

function withOutcome(schedule: ActiveTaskSchedule, outcome: ScheduledFireOutcome): ActiveTaskSchedule {
  return {
    ...schedule,
    // A fire that touched a Task (created/started, or created-then-failed-to-start)
    // becomes the last Task; a fire that created none leaves the pointer intact.
    // This keeps the de-dup guard fed even when starting the Task failed.
    lastTaskId: outcome.taskId ?? schedule.lastTaskId,
    history: [...schedule.history, outcome].slice(-HISTORY_LIMIT),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

