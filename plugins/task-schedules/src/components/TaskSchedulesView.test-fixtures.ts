import { fireEvent, render, screen } from '@testing-library/svelte'
import { vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import type { ScheduledFireOutcome, TaskSchedule } from '../lib/types'
import TaskSchedulesView from './TaskSchedulesView.svelte'

export const whenReady = vi.fn()
export const invoke = vi.fn()
export const navigate = vi.fn()

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function makeApi(): FrontendOpenForgeAPI {
  return {
    backend: { whenReady, invoke },
    navigation: { navigate },
  } as unknown as FrontendOpenForgeAPI
}

const context: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.task-schedules',
  projectId: 'project-1',
}

export function makeSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: 'schedule-1',
    title: 'Daily dependency triage',
    prompt: 'Review dependency update tasks and create follow-up work.',
    kind: 'recurring',
    preset: 'daily',
    cron: '0 9 * * *',
    runAt: null,
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 2, 9),
    lastFireAt: null,
    lastTaskId: null,
    cancelledAt: null,
    idempotencyKey: null,
    history: [],
    ...overrides,
  }
}

export const enabledSchedule = makeSchedule()
export const pausedSchedule = makeSchedule({
  id: 'schedule-2',
  title: 'Dormant cleanup review',
  prompt: 'Check stale cleanup tasks but do not run automatically yet.',
  enabled: false,
  nextFireAt: Date.UTC(2026, 0, 3, 9),
})

export function renderView(props: { projectId?: string | null; projectName?: string } = {}) {
  return render(TaskSchedulesView, {
    props: {
      api: makeApi(),
      context,
      projectId: props.projectId === undefined ? 'project-1' : props.projectId,
      projectName: props.projectName ?? 'Project One',
    },
  })
}

export function mockBackend(initialSchedules: TaskSchedule[]) {
  let schedules = initialSchedules
  invoke.mockImplementation(async (method: string, payload?: Record<string, any>) => {
    if (method === 'listSchedules') return schedules
    if (method === 'saveSchedule') {
      const input = payload?.schedule ?? {}
      const existing = schedules.find((schedule) => schedule.id === input.id)
      const saved = makeSchedule({
        ...existing,
        id: input.id ?? 'saved-schedule',
        title: input.title,
        prompt: input.prompt,
        kind: input.kind ?? existing?.kind ?? 'recurring',
        preset: input.preset,
        cron: input.kind === 'once' ? null : input.cron ?? existing?.cron ?? '0 9 * * *',
        runAt: input.runAt ?? existing?.runAt ?? null,
        nextFireAt: input.kind === 'once' ? input.runAt : existing?.nextFireAt ?? Date.UTC(2026, 0, 2, 9),
        mode: input.mode,
        enabled: input.enabled,
      })
      schedules = existing
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      return saved
    }
    if (method === 'runNow') {
      return {
        id: 'fire-1',
        firedAt: Date.UTC(2026, 0, 1, 10),
        trigger: 'manual',
        status: 'started',
        taskId: 'T-1',
        message: 'Created and started scheduled Task T-1',
      } satisfies ScheduledFireOutcome
    }
    if (method === 'cancelRunNow') return { cancelled: true }
    if (method === 'deleteSchedule') {
      schedules = schedules.filter((schedule) => schedule.id !== payload?.scheduleId)
      return { deleted: true }
    }
    throw new Error(`Unexpected backend method: ${method}`)
  })
  return {
    setSchedules(nextSchedules: TaskSchedule[]) {
      schedules = nextSchedules
    },
  }
}

export async function waitForSchedules() {
  await screen.findByRole('button', { name: 'Daily dependency triage' })
  await screen.findByRole('button', { name: 'Dormant cleanup review' })
}

export async function selectSchedule(title = 'Daily dependency triage') {
  await fireEvent.click(await screen.findByRole('button', { name: title }))
  return screen.getByRole('complementary', { name: 'Schedule details' })
}

export async function openNewSchedule() {
  await fireEvent.click(screen.getByRole('button', { name: 'New schedule' }))
  return screen.getByRole('complementary', { name: 'Schedule form' })
}

export function resetTaskSchedulesViewMocks() {
  vi.clearAllMocks()
  whenReady.mockResolvedValue(undefined)
  navigate.mockResolvedValue({})
}
