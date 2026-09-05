import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import { createSchedule } from '../../../../storybook/shared/fixtures/scheduleFixtures'
import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleTiming } from '../lib/types'
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

export const makeSchedule = createSchedule

export const enabledSchedule = makeSchedule()
export const pausedSchedule = makeSchedule({
  id: 'schedule-2',
  title: 'Dormant cleanup review',
  prompt: 'Check stale cleanup tasks but do not run automatically yet.',
  lifecycle: { state: 'active', enabled: false, nextFireAt: Date.UTC(2026, 0, 3, 9) },
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

type ProjectSchedules = TaskSchedule[] | Promise<TaskSchedule[]>

type ProjectSwitchOptions = {
  projectASchedules?: ProjectSchedules
  projectBSchedules?: ProjectSchedules
  backendResponses?: Record<string, unknown>
}

export const projectA = {
  id: 'project-a',
  name: 'Project A',
  scheduleTitle: 'Project A schedule',
} as const

export const projectB = {
  id: 'project-b',
  name: 'Project B',
  scheduleTitle: 'Project B schedule',
} as const

export function renderProjectSwitchView(options: ProjectSwitchOptions = {}) {
  const projectASchedules = options.projectASchedules ?? [makeSchedule({ title: projectA.scheduleTitle })]
  const projectBSchedules = options.projectBSchedules ?? [makeSchedule({ id: 'schedule-b', title: projectB.scheduleTitle })]
  const backendResponses = options.backendResponses ?? {}
  invoke.mockImplementation((method: string, payload?: Record<string, unknown>) => {
    if (method === 'listSchedules') {
      return Promise.resolve(payload?.projectId === projectB.id ? projectBSchedules : projectASchedules)
    }
    if (Object.hasOwn(backendResponses, method)) return backendResponses[method]
    throw new Error(`Unexpected backend method: ${method}`)
  })

  const view = renderView({ projectId: projectA.id, projectName: projectA.name })
  return {
    ...view,
    switchToProjectB: () => view.rerender({ projectId: projectB.id, projectName: projectB.name }),
  }
}

export async function settleAsyncWork(completion: Promise<unknown>) {
  await completion
  await tick()
}

export async function settleRejectedAsyncWork(completion: Promise<unknown>) {
  await completion.catch(() => undefined)
  await tick()
}

export function mockBackend(initialSchedules: TaskSchedule[]) {
  let schedules = initialSchedules
  invoke.mockImplementation(async (method: string, payload?: Record<string, any>) => {
    if (method === 'listSchedules') return schedules
    if (method === 'saveSchedule') {
      const input = payload?.schedule ?? {}
      const existing = schedules.find((schedule) => schedule.id === input.id)
      const kind = input.kind ?? existing?.timing.type ?? 'recurring'
      const existingCron = existing?.timing.type === 'recurring' ? existing.timing.cron : '0 9 * * *'
      const runAt = input.runAt ?? (existing?.timing.type === 'once' ? existing.timing.runAt : null)
      const nextFireAt = kind === 'once'
        ? runAt
        : existing?.lifecycle.state === 'active'
          ? existing.lifecycle.nextFireAt
          : Date.UTC(2026, 0, 2, 9)
      const timing: TaskScheduleTiming = kind === 'once'
        ? { type: 'once', runAt }
        : { type: 'recurring', preset: input.preset, cron: input.cron ?? existingCron }
      const saved = makeSchedule({
        ...existing,
        id: input.id ?? 'saved-schedule',
        title: input.title,
        prompt: input.prompt,
        timing,
        mode: input.mode,
        lifecycle: { state: 'active', enabled: input.enabled, nextFireAt },
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
  return screen.getByRole('complementary', { name: 'Task Schedule details' })
}

export async function openNewSchedule() {
  await fireEvent.click(screen.getByRole('button', { name: 'New Task Schedule' }))
  return screen.getByRole('complementary', { name: 'Task Schedule form' })
}

export function resetTaskSchedulesViewMocks() {
  vi.clearAllMocks()
  whenReady.mockResolvedValue(undefined)
  navigate.mockResolvedValue({})
}
